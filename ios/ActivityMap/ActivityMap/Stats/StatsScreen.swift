import SwiftUI
import UIKit
import Observation

struct StatsScreen: View {
    @Environment(\.locale) private var locale
    @Bindable var store: ActivityStore
    var sync: SyncController? = nil
    var refresh: () async -> Void = {}
    @State var dashboard = StatsDashboardState()
    @Environment(\.statsShellNavigation) private var shellNavigation
    @Environment(\.statsDetailPresentation) private var detailPresentation
    @Environment(\.localStore) private var localStore
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var presentation: StatsPresentation {
        if let sync { return StatsPresentation(store: store, sync: sync) }
        return StatsPresentation(store: store, preparing: localStore != nil)
    }
    private var source: StatsDashboardSource { StatsDashboardSource(store) }
    private var request: StatsDashboardRequest {
        .init(source: source, choices: dashboard.choices,
              canLoad: store.selectedTab == .stats && presentation.hasContent)
    }

    /// Every width focuses a chart on its own full-width page; only explicit
    /// inline hosts expand within the dashboard. A side pane would show the
    /// chart narrower than the tile that opened it.
    private var usesDetailNavigation: Bool { detailPresentation != .inline }

    private var detailSelection: Binding<StatsTileID?> {
        Binding(get: { usesDetailNavigation ? dashboard.expandedTile : nil },
                set: { dashboard.expandedTile = $0 })
    }

    var body: some View {
        screenContent
        // Dashboard and destination own demand for the same state and cache.
        .task(id: request) { await dashboard.load(store: store, request: request) }
        .onChange(of: source.scope) { _, _ in
            dashboard.inspectedActivityID = nil
            dashboard.resetInspection()
        }

    }

    @ViewBuilder private var screenContent: some View {
        if let shellNavigation {
            dashboardContent.onAppear {
                if shellNavigation.dashboard !== dashboard { shellNavigation.dashboard = dashboard }
            }
        } else {
            NavigationStack {
                dashboardContent
                    .navigationTitle("Stats")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationDestination(item: detailSelection) { id in
                        if let definition = StatsDashboard.tiles.first(where: { $0.id == id }) {
                            detail(definition)
                        }
                    }
            }
        }
    }

    private var dashboardContent: some View {
        GeometryReader { geometry in
            let detailLimit = detailHeightLimit(viewport: geometry.size.height)
            StatsActivityInspection(store: store, dashboard: dashboard,
                                    active: detailPresentation == .inline || dashboard.expandedTile == nil,
                                    registersNavigation: detailPresentation == .inline,
                                    backLabel: "Back to Stats dashboard") {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: AppTheme.Spacing.section) {
                        if presentation.hasContent {
                            ForEach(StatsTileGroup.allCases, id: \.self) { group in
                                VStack(alignment: .leading, spacing: AppTheme.Spacing.small) {
                                    Text(group.titleResource(locale: locale)).font(.title2.weight(.semibold))
                                        .accessibilityAddTraits(.isHeader)
                                    let columns = !typeSize.isAccessibilitySize
                                        && geometry.size.width >= (detailLimit != nil ? 640 : 760) ? 2 : 1
                                    StatsAnimatedSection(tiles: StatsDashboard.tiles.filter { $0.group == group },
                                                         expandedTile: detailPresentation == .inline ? dashboard.expandedTile : nil,
                                                         columns: columns) { definition in
                                        tile(definition)
                                    }
                                }
                            }
                        } else if let empty = presentation.empty {
                            BrowsingEmptyView(state: empty, recover: { recovery in
                                if recovery == .clearFilters { store.resetStatsActivityFilters() }
                            }, scrolls: false)
                        }
                    }
                    .padding(12)
                }
                .environment(\.statsDetailHeightLimit, detailLimit)
                .environment(\.statsAvailableWidth, geometry.size.width)
                // Only inline expansion needs to observe this selection.
                // On iPhone, that dependency needlessly invalidated the
                // compact dashboard before UIKit could push the detail page.
                .onChange(of: detailPresentation == .inline ? dashboard.expandedTile : nil) { _, id in
                    guard detailPresentation == .inline, detailLimit != nil, let id else { return }
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                        proxy.scrollTo(id, anchor: .top)
                    }
                }
            }
            .background(AppTheme.contentBackground)
            .accessibilityIdentifier("stats-dashboard")
            }
        }
    }

    private func detailContent(_ tile: StatsTileDefinition) -> some View {
        StatsDetailScreen(store: store, dashboard: dashboard, tile: tile, sync: sync)
    }

    @ViewBuilder private func detail(_ tile: StatsTileDefinition) -> some View {
        if reduceMotion, #available(iOS 27.0, *) {
            detailContent(tile).navigationTransition(.crossFade)
        } else {
            // The focus page grows its own card out of the dashboard; Reduce
            // Motion uses standard navigation on iOS 26.
            detailContent(tile)
        }
    }

    @ViewBuilder private func tile(_ tile: StatsTileDefinition) -> some View {
        let content = dashboardTile(tile, expanded: detailPresentation == .inline && dashboard.expandedTile == tile.id)
            .id(tile.id)
        if usesDetailNavigation, !reduceMotion, StatsDashboard.expandable(tile.id) {
            content.onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame in
                dashboard.tileFrames[tile.id] = frame
            }
        } else {
            content
        }
    }

    private func dashboardTile(_ tile: StatsTileDefinition, expanded: Bool) -> some View {
        StatsDashboardTile(tile: tile, store: store, dashboard: dashboard, expanded: expanded,
                           toggleExpansion: {
            if usesDetailNavigation { openFocus(tile.id) }
            else {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) { dashboard.toggleExpansion(tile.id) }
            }
        }, openActivity: { dashboard.inspectedActivityID = $0 })
    }

    /// Pushes without animation over a still of the dashboard, from which the
    /// focus page grows the card. Without a known frame it opens directly.
    private func openFocus(_ id: StatsTileID) {
        guard !reduceMotion, dashboard.expandedTile == nil, let frame = dashboard.tileFrames[id] else {
            dashboard.toggleExpansion(id)
            return
        }
        dashboard.focusEntrance = StatsFocusEntrance.capture(tile: id, source: frame, dashboardSource: source)
        // SwiftUI ignores disablesAnimations for destination pushes. UIKit's
        // push uses UIView animations; without them it lands in one frame.
        UIView.setAnimationsEnabled(false)
        dashboard.toggleExpansion(id)
        DispatchQueue.main.async { UIView.setAnimationsEnabled(true) }
    }

    /// Short viewports (iPhone landscape) get dense tile headers and a cap on
    /// expanded visuals: the room left once that header, the tile's own
    /// controls and the scroll padding are on screen. Taller viewports keep
    /// each tile's natural detail height.
    ///
    /// Only while Stats is shown: restructuring the hidden dashboard during a
    /// rotation can swallow Mapbox's resize completion, leaving the retained
    /// map at its interim size so later fits land off-centre.
    private func detailHeightLimit(viewport: CGFloat) -> Double? {
        guard store.selectedTab == .stats, viewport < 480, !typeSize.isAccessibilitySize else { return nil }
        return Double(viewport) - 170
    }

}

/// Keep the blue chrome outside UIKit's rounded, shadowed page transition.
/// Regular shell-hosted pages use the stationary shell header. Compact and
/// standalone pages use the native navigation bar.
private struct StatsDetailDestination<Content: View>: View {
    let title: String
    var backLabel = "Back to Stats dashboard"
    var usesShellHeader = false
    var toolbarTrailing = AnyView(EmptyView())
    var closeInspection: (() -> Bool)? = nil
    var collapse: (() -> Bool)? = nil
    @ViewBuilder let content: () -> Content
    @Environment(\.dismiss) private var dismiss
    @AppToolbarEnvironment private var toolbarLayout

    var body: some View {
        // The regular workspace already owns stationary chrome. A single
        // modifier chain preserves the destination identity during resizing;
        // visible=false suppresses both native and safe-area detail bars.
        page.appNavigationBar(AppToolbar(
            leading: AnyView(AppToolbarBackButton(label: backLabel, identifier: "stats-detail-back", action: goBack)),
            principal: AnyView(Text(title).font(.headline).foregroundStyle(.white)
                .lineLimit(toolbarLayout.isCompact ? 1 : nil)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("stats-detail-title")),
            trailing: toolbarTrailing), visible: !usesShellHeader)
    }
    private var page: some View {
        content()
            .background(AppTheme.contentBackground)
            .navigationTitle(title)
            .navigationBarBackButtonHidden()
            .environment(\.statsDetailBackAction, goBack)
            .background(DetailBackGesture())
            .accessibilityAction(.escape) { goBack() }
    }
    private func goBack() {
        if closeInspection?() == true || collapse?() == true { return }
        dismiss()
    }
}

/// The shell and standalone hosts push the same complete page. Values remain
/// observed so changing a metric refreshes the visible destination.
struct StatsDetailScreen: View {
    let store: ActivityStore
    let dashboard: StatsDashboardState
    let tile: StatsTileDefinition
    var sync: SyncController? = nil
    var usesShellHeader = false
    var toolbarTrailing = AnyView(EmptyView())
    @State private var exit = StatsFocusExit()

    private var backLabel: String {
        dashboard.inspectedActivityID != nil ? "Back to \(tile.title)" : "Back to Stats dashboard"
    }
    var body: some View {
        StatsDetailDestination(title: tile.title,
                               backLabel: backLabel,
                               usesShellHeader: usesShellHeader, toolbarTrailing: toolbarTrailing, closeInspection: {
            guard dashboard.inspectedActivityID != nil else { return false }
            dashboard.inspectedActivityID = nil
            return true
        }, collapse: { exit.collapse?() ?? false }) {
            StatsDetailContent(store: store, dashboard: dashboard, tile: tile, sync: sync, exit: exit,
                               showsContentHeading: usesShellHeader, backLabel: backLabel)
        }
    }
}

/// Charts, controls and activity inspection for the pushed focus page.
private struct StatsDetailContent: View {
    @Bindable var store: ActivityStore
    let dashboard: StatsDashboardState
    let tile: StatsTileDefinition
    var sync: SyncController? = nil
    let exit: StatsFocusExit
    var showsContentHeading = false
    var backLabel = "Back to Stats dashboard"
    @Environment(\.statsDetailBackAction) private var goBack
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss
    /// 0 while the card sits in its dashboard slot, 1 at rest on the page.
    @State private var entranceProgress: Double
    /// Retained after opening, so Back can collapse into the same still.
    @State private var entrance: StatsFocusEntrance?
    @State private var scrollOffset: CGFloat = 0
    @State private var collapseScroll: CGFloat = 0

    init(store: ActivityStore, dashboard: StatsDashboardState, tile: StatsTileDefinition,
         sync: SyncController? = nil, exit: StatsFocusExit,
         showsContentHeading: Bool = false, backLabel: String = "Back to Stats dashboard") {
        self.store = store
        self.dashboard = dashboard
        self.tile = tile
        self.sync = sync
        self.exit = exit
        self.showsContentHeading = showsContentHeading
        self.backLabel = backLabel
        let entrance = dashboard.focusEntrance?.tile == tile.id ? dashboard.focusEntrance : nil
        _entrance = State(initialValue: entrance)
        _entranceProgress = State(initialValue: entrance == nil ? 1 : 0)
    }

    private var presentation: StatsPresentation {
        sync.map { StatsPresentation(store: store, sync: $0) }
            ?? StatsPresentation(store: store, preparing: false)
    }

    private var request: StatsDashboardRequest {
        .init(source: StatsDashboardSource(store), choices: dashboard.choices,
              canLoad: store.selectedTab == .stats && presentation.hasContent)
    }

    private var emptyTitle: String? {
        // A completed, authorized cache can also have no matches while offline
        // or after a failed refresh. Neither case has a calculation to await.
        guard presentation.historyComplete, !presentation.hasContent,
              presentation.state != .unavailable else { return nil }
        return store.activities.isEmpty ? "No activity history" : "No matching activities"
    }

    private func grow() {
        exit.collapse = collapse
        guard entrance != nil, entranceProgress < 1 else { return }
        dashboard.focusEntrance = nil
        withAnimation(.smooth(duration: 0.45)) { entranceProgress = 1 }
    }

    /// Shrinks the card back into its slot, then pops without animation onto
    /// the identical dashboard. A changed dashboard pops normally instead.
    private func collapse() -> Bool {
        guard let entrance, !reduceMotion, entranceProgress == 1,
              entrance.dashboardSource == StatsDashboardSource(store),
              dashboard.tileFrames[tile.id] == entrance.source else { return false }
        collapseScroll = scrollOffset
        withAnimation(.smooth(duration: 0.4)) { entranceProgress = 0 } completion: {
            UIView.setAnimationsEnabled(false)
            dismiss()
            DispatchQueue.main.async { UIView.setAnimationsEnabled(true) }
        }
        return true
    }

    /// Wide, tall pages give the chart about half the height, leaving the
    /// header, controls and legend on screen. Phones keep their sizes.
    private func focusChartHeight(_ size: CGSize) -> Double? {
        guard size.width >= BrowsePaneLayout.minimumDetailWidth, size.height >= 480,
              !typeSize.isAccessibilitySize else { return nil }
        return min(520, Double(size.height) * 0.45)
    }

    var body: some View {
        StatsActivityInspection(store: store, dashboard: dashboard, backLabel: "Back to \(tile.title)") {
            GeometryReader { geometry in
                ZStack(alignment: .topLeading) {
                    if let entrance, entranceProgress < 1 {
                        // Gone before the card turns transparent over it.
                        StatsFocusBackdrop(entrance: entrance, page: geometry.frame(in: .global))
                            .opacity(1 - min(1, entranceProgress / 0.6))
                    }
                    ScrollView {
                        if let emptyTitle {
                            VStack(alignment: .leading, spacing: 0) {
                                if showsContentHeading { contentHeading }
                                ContentUnavailableView(emptyTitle, systemImage: "chart.bar")
                            }
                        } else {
                            StatsFocusEntranceTile(progress: entranceProgress, source: entrance?.source,
                                                   page: geometry.frame(in: .global), scroll: collapseScroll) { progress in
                                VStack(alignment: .leading, spacing: 0) {
                                    if showsContentHeading {
                                        // The heading is part of the same card morph. At the
                                        // source it takes no space, so the card still starts
                                        // exactly in its dashboard slot; at rest it scrolls.
                                        StatsExpansionReveal(expanded: progress > 0.5) { contentHeading }
                                    }
                                    // Dashboard wording and control placement until the
                                    // midpoint, so both ends match the card exactly.
                                    StatsDashboardTile(tile: tile, store: store, dashboard: dashboard,
                                                       expanded: progress > 0.5, detailScreen: true,
                                                       toggleExpansion: {}, openActivity: { dashboard.inspectedActivityID = $0 })
                                        .environment(\.statsDetailHeightLimit,
                                                     geometry.size.height < 480 && !typeSize.isAccessibilitySize
                                                     ? Double(geometry.size.height) - 170 : nil)
                                        .environment(\.statsFocusChartHeight, focusChartHeight(geometry.size))
                                        // Controls that change rows at the midpoint glide
                                        // there instead of jumping a line.
                                        .animation(entranceProgress < 1 ? .smooth(duration: 0.2) : nil, value: progress > 0.5)
                                }
                            }
                        }
                    }
                    .scrollDisabled(entranceProgress < 1)
                    .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, offset in
                        if entranceProgress == 1 { scrollOffset = offset }
                    }
                    .accessibilityIdentifier("stats-detail-\(tile.id.rawValue)")
                }
            }
        }
        .onAppear(perform: grow)
        // The shell's pushed root is inactive. The visible destination must
        // own demand when its metric changes; the shared cache reuses values.
        .task(id: request) { await dashboard.load(store: store, request: request) }
    }

    private var contentHeading: some View {
        HStack(alignment: .center, spacing: AppTheme.Spacing.small) {
            Button { goBack?() } label: {
                BrowseActionIcon(.back)
                    .font(.system(size: 20, weight: .medium))
                    .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(AppTheme.accent)
            .accessibilityLabel(backLabel)
            .accessibilityIdentifier("stats-detail-back")
            Text(tile.id.titleResource(locale: locale))
                .font(.title2.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("stats-detail-title")
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.top, AppTheme.Spacing.small)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("stats-detail-content-heading")
    }
}

extension EnvironmentValues {
    @Entry var statsDetailBackAction: (() -> Void)? = nil
}

/// Share the dashboard reference, not a second selection. UIKit's destination
/// binding owns pop/cancellation and writes back to the retained Stats state.
@MainActor @Observable final class StatsShellNavigation {
    var dashboard: StatsDashboardState?
}

struct StatsRecovery {
    var refresh: () async -> Void = {}
}
private struct StatsRecoveryKey: EnvironmentKey {
    static let defaultValue = StatsRecovery()
}
extension EnvironmentValues {
    var statsRecovery: StatsRecovery {
        get { self[StatsRecoveryKey.self] }
        set { self[StatsRecoveryKey.self] = newValue }
    }
}
private struct StatsDashboardDestination: View {
    let store: ActivityStore
    let sync: SyncController?
    @Environment(\.statsRecovery) private var recovery
    var body: some View {
        StatsScreen(store: store, sync: sync, refresh: recovery.refresh)
    }
}
extension BrowseStatsDestination {
    static var dashboard: Self {
        .init { store, sync in AnyView(StatsDashboardDestination(store: store, sync: sync)) }
    }
}

/// Expanded tiles and unpaired compact tiles own a full row. Keeping the
/// children outside row containers preserves their SwiftUI identity on reflow.
struct StatsSectionLayout: Layout {
    var columns: Int
    var spacing: CGFloat = 12
    var expansion: StatsExpansionWeights

    private func frames(width: CGFloat, subviews: Subviews) -> [CGRect] {
        let compact = frames(width: width, subviews: subviews, expanded: nil)
        var result = compact
        for index in subviews.indices where expansion[index] > 0 {
            let expanded = frames(width: width, subviews: subviews, expanded: index)
            let fraction = expansion[index]
            for tile in result.indices {
                result[tile].origin.x += (expanded[tile].minX - compact[tile].minX) * fraction
                result[tile].origin.y += (expanded[tile].minY - compact[tile].minY) * fraction
                result[tile].size.width += (expanded[tile].width - compact[tile].width) * fraction
                result[tile].size.height += (expanded[tile].height - compact[tile].height) * fraction
            }
        }
        return result
    }

    private func frames(width: CGFloat, subviews: Subviews, expanded: Int?) -> [CGRect] {
        // Like the web, expansion replaces the selected tile's original row.
        // Its compact row-mate flows below, without growing or jumping above it.
        var order = Array(subviews.indices)
        if columns > 1, let expanded {
            order.remove(at: expanded)
            order.insert(expanded, at: expanded / 2 * 2)
        }
        var result = Array(repeating: CGRect.zero, count: subviews.count)
        var index = 0
        var y: CGFloat = 0
        while index < order.count {
            let paired = columns > 1 && order[index] != expanded
                && index + 1 < order.count && order[index + 1] != expanded
            let count = paired ? 2 : 1
            let tileWidth = paired ? max(0, (width - spacing) / 2) : width
            let row = Array(order[index..<(index + count)])
            let rowHeight = row.map {
                subviews[$0].sizeThatFits(.init(width: tileWidth, height: nil)).height
            }.max() ?? 0
            for (column, tile) in row.enumerated() {
                result[tile] = CGRect(x: CGFloat(column) * (tileWidth + spacing), y: y,
                                      width: tileWidth, height: rowHeight)
            }
            y += rowHeight + spacing
            index += count
        }
        return result
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = max(0, proposal.width ?? 0)
        let frames = frames(width: width, subviews: subviews)
        return CGSize(width: width, height: frames.map(\.maxY).max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (subview, frame) in zip(subviews, frames(width: bounds.width, subviews: subviews)) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                          anchor: .topLeading, proposal: .init(width: frame.width, height: frame.height))
        }
    }
}

/// One interpolated value drives layout proposals and the content of every tile.
/// Disable implicit descendant animations: Charts must lay out at each presented
/// size, rather than jump to the destination inside a separately animated frame.
struct StatsAnimatedSection<Content: View>: View, Animatable {
    let tiles: [StatsTileDefinition]
    var columns: Int
    var weights: StatsExpansionWeights
    @ViewBuilder let content: (StatsTileDefinition) -> Content

    init(tiles: [StatsTileDefinition], expandedTile: StatsTileID?, columns: Int,
         @ViewBuilder content: @escaping (StatsTileDefinition) -> Content) {
        self.tiles = tiles
        self.columns = columns
        weights = StatsExpansionWeights(values: tiles.map { $0.id == expandedTile ? 1 : 0 })
        self.content = content
    }
    var animatableData: StatsExpansionWeights {
        get { weights }
        set { weights = newValue }
    }
    var body: some View {
        StatsSectionLayout(columns: columns, expansion: weights) {
            ForEach(Array(tiles.enumerated()), id: \.element.id) { index, tile in
                content(tile)
                    .environment(\.statsExpansionProgress, weights[index])
            }
        }
        .transaction { $0.animation = nil }
    }
}

nonisolated struct StatsExpansionWeights: VectorArithmetic {
    var values: [Double]
    static var zero: Self { .init(values: []) }
    subscript(index: Int) -> Double { values.indices.contains(index) ? values[index] : 0 }
    static func + (lhs: Self, rhs: Self) -> Self {
        .init(values: (0..<max(lhs.values.count, rhs.values.count)).map { lhs[$0] + rhs[$0] })
    }
    static func - (lhs: Self, rhs: Self) -> Self {
        .init(values: (0..<max(lhs.values.count, rhs.values.count)).map { lhs[$0] - rhs[$0] })
    }
    mutating func scale(by rhs: Double) { values = values.map { $0 * rhs } }
    var magnitudeSquared: Double { values.reduce(0) { $0 + $1 * $1 } }
}

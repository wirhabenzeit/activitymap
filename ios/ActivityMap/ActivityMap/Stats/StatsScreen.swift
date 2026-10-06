import SwiftUI

struct StatsScreen: View {
    @Bindable var store: ActivityStore
    var sync: SyncController? = nil
    var refresh: () async -> Void = {}
    @State private var inspectedActivityID: Int?
    @State var dashboard = StatsDashboardState()
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

    var body: some View {
        GeometryReader { geometry in
            let detailLimit = detailHeightLimit(viewport: geometry.size.height)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: AppTheme.Spacing.section) {
                        scopeSummary
                        if let message = presentation.message {
                            status(message)
                        }
                        if presentation.hasContent {
                            ForEach(StatsTileGroup.allCases, id: \.self) { group in
                                VStack(alignment: .leading, spacing: AppTheme.Spacing.small) {
                                    Text(group.title).font(.title2.weight(.semibold))
                                        .accessibilityAddTraits(.isHeader)
                                    // iPhone landscape pairs tiles too: half its width is a phone card.
                                    let columns = !typeSize.isAccessibilitySize
                                        && geometry.size.width >= (detailLimit != nil ? 640 : 760) ? 2 : 1
                                    // A flat, stable child list keeps local picker/day state
                                    // alive when expansion changes row placement.
                                    StatsAnimatedSection(tiles: StatsDashboard.tiles.filter { $0.group == group },
                                                         expandedTile: dashboard.expandedTile, columns: columns) { definition in
                                        tile(definition)
                                    }
                                }
                            }
                        }
                    }
                    .padding(12)
                }
                .environment(\.statsDetailHeightLimit, detailLimit)
                .onChange(of: dashboard.expandedTile) { _, id in
                    // A short viewport shows little more than the expanded tile.
                    // Start it at the top rather than leaving its chart off-screen.
                    guard detailLimit != nil, let id else { return }
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                        proxy.scrollTo(id, anchor: .top)
                    }
                }
            }
            .background(AppTheme.contentBackground)
            .accessibilityIdentifier("stats-dashboard")
            .task(id: request) { await dashboard.load(store: store, request: request) }
            .onChange(of: source.scope) { _, _ in inspectedActivityID = nil }
            .sheet(isPresented: Binding(get: { inspectedActivityID != nil }, set: { if !$0 { inspectedActivityID = nil } })) {
                if let id = inspectedActivityID {
                    NavigationStack {
                        ActivityDetailPanel(store: store, activityID: id, showOnMap: { activityID in
                            inspectedActivityID = nil
                            store.showOnMap(activityID)
                        })
                            .navigationTitle("Activity").navigationBarTitleDisplayMode(.inline)
                            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { inspectedActivityID = nil } } }
                    }.presentationDetents([.large]).presentationDragIndicator(.visible)
                }
            }
        }
    }

    private func tile(_ tile: StatsTileDefinition) -> some View {
        StatsDashboardTile(tile: tile, option: Binding(
            get: { dashboard.option(tile.id) },
            set: { if let value = $0 { dashboard.select(value, for: tile) } }
        ), displayed: dashboard.face(tile.id, source: source), today: source.today,
           expanded: dashboard.expandedTile == tile.id, filtered: store.activeStatsFilterCount > 0,
           toggleExpansion: {
               withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                   dashboard.toggleExpansion(tile.id)
               }
           }, openActivity: { inspectedActivityID = $0 })
        .id(tile.id)
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

    @ViewBuilder private var scopeSummary: some View {
        if store.activeStatsFilterCount > 0 {
            VStack(alignment: .leading, spacing: 8) {
                Text("Filtered activities")
                    .font(.subheadline.weight(.semibold))
                Button("Reset activity filters") { store.resetStatsActivityFilters() }
                    .frame(minHeight: 44).accessibilityIdentifier("stats-reset-filters")
            }
        }
    }

    private func status(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if presentation.state == .loading { ProgressView().accessibilityLabel("Loading activity history") }
            Text(message).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            if presentation.historyComplete && !presentation.hasContent,
               ![.noHistory, .noMatches, .unavailable].contains(presentation.state) {
                Text(store.activities.isEmpty ? "No activity history" : "No matching activities")
                    .font(.subheadline)
            }
            // Signed out, expired or disconnected: the shell's overlay offers
            // the connection (#304), so Stats only states why it is empty.
            if presentation.state != .unavailable && presentation.retryAllowed && [.error, .cached].contains(presentation.state) {
                Button("Retry sync") { Task { await refresh() } }.frame(minHeight: 44)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityIdentifier("stats-status-\(presentation.state)")
    }
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

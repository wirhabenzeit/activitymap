import SwiftUI
import UIKit

struct AppShell: View {
    @State private var store = ActivityStore()
    @State private var auth = AuthController()
    @State private var sync: SyncController?
    @Environment(\.localStore) private var localStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var sheets: BrowseSheetPresentation
    @State private var statsNavigation = StatsShellNavigation()
    @State private var listNavigation = ListShellNavigation()
    @Namespace private var statsTransitionNamespace
    @Environment(\.statsDetailPresentation) private var statsDetailPresentation
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shellSize: CGSize = .zero
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    // Retained for review captures: the gallery stages map results inside the
    // production shell.
    private let mapPicker: RoutePicker?
    // Real dashboard content stays mounted with Map/List through switches.
    private let statsContent: BrowseStatsDestination?

    init(activities: [Activity] = []) {
        self.init(store: ActivityStore(activities: activities))
    }

    init(store: ActivityStore, mapPicker: RoutePicker? = nil, sheets: BrowseSheetPresentation = BrowseSheetPresentation(),
         statsContent: BrowseStatsDestination? = .dashboard) {
        _sheets = State(initialValue: sheets)
        _store = State(initialValue: store)
        self.mapPicker = mapPicker
        self.statsContent = statsContent
    }

    private var usesStatsNavigation: Bool {
        guard statsContent != nil else { return false }
        // Chart navigation belongs to the content column at every width.
        return statsDetailPresentation != .inline
    }

    private var statsDetailSelection: Binding<StatsTileID?> {
        Binding(get: { statsNavigation.dashboard?.expandedTile },
                set: { statsNavigation.dashboard?.expandedTile = $0 })
    }

    private var nativeStatsHeader: Bool { usesStatsNavigation && sizeClass == .compact }

    var body: some View {
        Group {
            if usesStatsNavigation {
                shellContent
                    .environment(\.statsShellNavigation, statsNavigation)
                    .environment(\.statsTransitionNamespace, statsTransitionNamespace)
            } else {
                shellContent
            }
        }
        .environment(\.listShellNavigation, listNavigation)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { old, new in
            shellSize = new
            // A resize that switches between sheet and sidebar closes the old
            // host rather than reopening filters in the other one. The first
            // layout (from zero) keeps filters as requested.
            if old.width > 0, filterSidebarAvailable(width: old.width) != filterSidebarAvailable(width: new.width) {
                sheets.showsFilters = false
            }
        }
        .overlay {
            if let connectPrompt { StravaConnectOverlay(prompt: connectPrompt).transition(.opacity) }
        }
        .animation(.easeInOut(duration: 0.2), value: connectPrompt)
        .environment(\.stravaConnect, stravaConnect)
        .task {
            guard let localStore else { return } // Xcode previews stay offline.
            if sync == nil {
                sync = SyncController(activities: store, invalidate: { auth.invalidateSession(token: $0) })
            }
            sync?.setSession(auth.syncSession, storage: localStore)
            await refresh()
        }
        .onChange(of: auth.syncSession) { _, session in
            if let localStore { sync?.setSession(session, storage: localStore) }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { sync?.pause(); return }
            store.stats.refreshToday()
            if sync != nil { await refresh() }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                store.stats.refreshToday()
                await refresh()
            }
        }
        // The presenter belongs to the stationary shell, so Settings can
        // open from either the dashboard or a focused chart.
        .sheet(item: Binding(
            get: { usesStatsNavigation && shellSize.width > 0 && !sheets.mapResultsPresented ? shellRequest(sidebarAvailable: filterSidebarAvailable) : nil },
            set: { if usesStatsNavigation && !sheets.mapResultsPresented && $0 == nil { clearShellRequest() } }
        ), onDismiss: { sheets.shellSheetPresented = false }) { destination in
            shellSheet(destination).onAppear { sheets.shellSheetPresented = true }
        }
        // Inspecting a List activity collapses the expanded panel to the rail
        // when list and detail would not fit beside it. Closing the detail
        // leaves the rail as it is rather than restoring the panel.
        .onChange(of: store.inspectedActivityID) { old, id in
            // Judged by the layout before inspection: the panel was a column.
            if old == nil, id != nil, store.selectedTab == .list, panelTight, sheets.showsFilters {
                setFiltersExpanded(false)
            }
        }
        // Destinations never change filter visibility (#354).
        .onChange(of: store.selectedTab) { _, tab in
            if tab != .stats { statsNavigation.dashboard?.expandedTile = nil }
        }
        .onChange(of: store.mapContext.scopeRevision) { _, _ in
            statsNavigation.dashboard?.resetInspection()
        }
    }

    @ViewBuilder private func statsFocusPage(_ tile: StatsTileDefinition, dashboard: StatsDashboardState) -> some View {
        let content = VStack(spacing: 0) {
            if !nativeStatsHeader {
                HStack(spacing: 8) {
                    Button { dashboard.expandedTile = nil } label: {
                        Image(systemName: "chevron.left").frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Back to Stats")
                    .accessibilityIdentifier("stats-detail-back")
                    Text(tile.title).font(.title2.weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("stats-detail-title")
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .background(AppTheme.contentBackground)
            }
            StatsDetailScreen(store: store, dashboard: dashboard, tile: tile, sync: sync,
                              usesShellHeader: !nativeStatsHeader)
                .toolbar {
                    if nativeStatsHeader {
                        ToolbarItemGroup(placement: .topBarTrailing) {
                            filterButton(sidebarAvailable: false)
                        }.sharedBackgroundVisibility(.hidden)
                    }
                }
        }
            .tint(AppTheme.accent)
        // Every width zooms the tile into its focus page; Reduce Motion cross-fades.
        if reduceMotion { content.navigationTransition(.crossFade) }
        else { content.navigationTransition(.zoom(sourceID: tile.id, in: statsTransitionNamespace)) }
    }

    private var shellContent: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                let sidebarAvailable = filterSidebarAvailable(width: geometry.size.width)
                // Rotation must choose the filter host and content width from
                // the same geometry pass, before shellSize's callback arrives.
                let panelTight = panelTight(width: geometry.size.width)
                let panelFloats = panelTight && store.selectedTab == .list && store.inspectedActivityID != nil
                let filterWidth = sidebarAvailable
                    ? (sheets.showsFilters && !panelFloats ? BrowsePaneLayout.filterWidth : FilterRail.width) + 1 : 0
                let contentWidth = max(0, geometry.size.width - filterWidth)
                let nativeListHeader = listNavigation.detailPresented || sizeClass != .regular
                    || contentWidth < BrowsePaneLayout.minimumDetailWidth || typeSize.isAccessibilitySize
                VStack(spacing: 0) {
                    if !(store.selectedTab == .list && nativeListHeader)
                        && !(store.selectedTab == .stats && nativeStatsHeader) {
                        shellHeader(sidebarAvailable: sidebarAvailable).zIndex(1)
                    }
                    filterWorkspace(sidebarAvailable: sidebarAvailable, panelFloats: panelFloats) {
                        navigableContent(nativeListHeader: nativeListHeader, sidebarAvailable: sidebarAvailable)
                            .environment(\.browsePaneWidth, contentWidth)
                            .environment(\.listRootToolbar, usesStatsNavigation ? nil : browseRootToolbar(sidebarAvailable: sidebarAvailable))
                            .environment(\.filtersCollapseForDetail, panelTight && sheets.showsFilters && !panelFloats)
                            // Filters and Settings stack over the map's results sheet
                            // instead of waiting for it to dismiss first.
                            .environment(\.mapResultsSheetSuspended, sheets.shellSheetPresented)
                            .environment(\.mapResultsPresentationChanged, { sheets.mapResultsPresented = $0 })
                            .environment(\.stackedShellSheet, StackedShellSheet(
                                request: Binding(get: { shellRequest(sidebarAvailable: sidebarAvailable) },
                                                 set: { if $0 == nil { clearShellRequest() } }),
                                content: { AnyView(shellSheet($0)) }))
                    }
                }
                // While the map's results sheet is up, it presents these itself.
                .sheet(item: Binding(
                    get: { usesStatsNavigation || sheets.mapResultsPresented ? nil : shellRequest(sidebarAvailable: sidebarAvailable) },
                    set: { value in
                        guard !usesStatsNavigation, !sheets.mapResultsPresented, value == nil else { return }
                        clearShellRequest()
                    }
                ), onDismiss: { sheets.shellSheetPresented = false }) { destination in
                    shellSheet(destination)
                        .onAppear { sheets.shellSheetPresented = true }
                }
            }
        }
    }

    /// Stats focus animates only this column, with its header and filters
    /// outside the moving page. Compact List and Stats share native toolbars.
    @ViewBuilder private func navigableContent(nativeListHeader: Bool, sidebarAvailable: Bool) -> some View {
        if usesStatsNavigation {
            NavigationStack {
                content
                    .toolbar((store.selectedTab == .list && nativeListHeader)
                             || (store.selectedTab == .stats && nativeStatsHeader) ? .visible : .hidden, for: .navigationBar)
                    .toolbarBackground(AppTheme.navigationBlue, for: .navigationBar)
                    .toolbarBackgroundVisibility(.visible, for: .navigationBar)
                    .toolbarColorScheme(.dark, for: .navigationBar)
                    .toolbar {
                        if (store.selectedTab == .list && nativeListHeader)
                            || (store.selectedTab == .stats && nativeStatsHeader) {
                            browseRootToolbar(sidebarAvailable: sidebarAvailable)
                        }
                    }
                    .navigationDestination(item: statsDetailSelection) { id in
                        if let dashboard = statsNavigation.dashboard,
                           let tile = StatsDashboard.tiles.first(where: { $0.id == id }) {
                            statsFocusPage(tile, dashboard: dashboard)
                        }
                    }
            }
        } else {
            content
        }
    }

    /// The filter host persists beside the dashboard and focused charts.
    private func filterWorkspace<Content: View>(sidebarAvailable: Bool, panelFloats: Bool,
                                                @ViewBuilder content: () -> Content) -> some View {
        let expanded = sidebarAvailable && sheets.showsFilters
        return HStack(spacing: 0) {
            if expanded && !panelFloats {
                filterPanel(floating: false)
                Divider().ignoresSafeArea(edges: .bottom)
            } else if sidebarAvailable {
                FilterRail(store: store, scope: filterScope)
                Divider().ignoresSafeArea(edges: .bottom)
            }
            content()
        }
        .overlay(alignment: .leading) {
            if expanded && panelFloats {
                ZStack(alignment: .leading) {
                    Color.black.opacity(0.12)
                        .contentShape(Rectangle())
                        .onTapGesture { setFiltersExpanded(false) }
                        .accessibilityHidden(true)
                        .transition(.opacity)
                    filterPanel(floating: true)
                        .overlay(alignment: .trailing) { Divider() }
                        .shadow(color: .black.opacity(0.15), radius: 8, x: 3)
                        .transition(.move(edge: .leading))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func shellRequest(sidebarAvailable: Bool) -> ShellSheet? {
        sheets.showsFilters && !sidebarAvailable ? .filters : sheets.accountDestination.map(ShellSheet.account)
    }

    private var filterSidebarAvailable: Bool { filterSidebarAvailable(width: shellSize.width) }

    private func filterSidebarAvailable(width: CGFloat) -> Bool {
        BrowsePaneLayout.filtersUseSidebar(width: width, regular: sizeClass == .regular,
                                           accessibilityText: typeSize.isAccessibilitySize)
    }

    /// The full panel leaves no room for List and its adjacent detail, but
    /// the rail does (11-inch portrait).
    private var panelTight: Bool {
        panelTight(width: shellSize.width)
    }

    private func panelTight(width: CGFloat) -> Bool {
        BrowsePaneLayout.panelSqueezesDetail(width: width) && filterSidebarAvailable(width: width)
    }

    private func setFiltersExpanded(_ expanded: Bool) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { sheets.showsFilters = expanded }
    }

    private func filterPanel(floating: Bool) -> some View {
        FilterPanel(store: store, scope: filterScope)
            .frame(width: BrowsePaneLayout.filterWidth)
            .frame(maxHeight: .infinity)
            .background(Color(uiColor: .secondarySystemBackground))
            // The shell's white bar tint must not reach the panel's controls.
            .tint(AppTheme.accent)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Filters")
            .accessibilityAddTraits(floating ? .isModal : [])
            // Tapping outside or the filter button closes the floating panel;
            // VoiceOver users dismiss it with the escape gesture.
            .accessibilityAction(.escape) { if floating { setFiltersExpanded(false) } }
            .accessibilityIdentifier("filter-sidebar")
    }

    private func clearShellRequest() {
        sheets.showsFilters = false
        sheets.accountDestination = nil
    }

    @ViewBuilder private func shellSheet(_ destination: ShellSheet) -> some View {
        switch destination {
        case .filters:
            NavigationStack {
                FilterPanel(store: store, scope: filterScope)
                    .navigationTitle("Filters")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { sheets.showsFilters = false }
                                .accessibilityIdentifier("filters-done")
                        }
                    }
            }
            .presentationDetents(verticalSizeClass == .compact || typeSize.isAccessibilitySize ? [.large] : [.medium, .large])
            .presentationDragIndicator(.visible)
        case .account(let account):
            AccountSheet(destination: account, auth: auth, sync: sync, refresh: refresh)
        }
    }

    /// Signed out, expired or disconnected: one prompt over the whole shell.
    private var connectPrompt: StravaConnectPrompt? {
        StravaConnectPrompt(status: sync?.status, authStatus: auth.status)
    }

    /// The single connection flow every entry point uses (#304). Starting it
    /// in place keeps the person on the tab and context they started from.
    private var stravaConnect: StravaConnect {
        StravaConnect(start: { Task { await auth.signIn() } },
                      isConnecting: auth.status == .signingIn,
                      failed: auth.signInFailed,
                      restoreSession: { await auth.restoreSession() },
                      isVerifyingSession: auth.isRestoringSession,
                      restoreRetryAt: auth.restoreRetryAt)
    }

    /// iPhone landscape: a slimmer bar that also carries the List's status row (#315).
    private var compactBar: Bool { verticalSizeClass == .compact }
    private var syncing: Bool { sync?.status.showsLoadingIndicator == true }

    private func browseRootToolbar(sidebarAvailable: Bool) -> BrowseRootToolbar {
        BrowseRootToolbar(leading: AnyView(HStack(spacing: 8) {
            filterButton(sidebarAvailable: sidebarAvailable)
            if compactBar && store.selectedTab == .list { SelectionBar(store: store, includesTotal: true, onNavigationBar: true) }
        }), principal: AnyView(destinationPicker), trailing: AnyView(HStack(spacing: 8) {
            if compactBar && store.selectedTab == .list { ListControls(presentation: store.listPresentation, iconOnly: true, onNavigationBar: true) }
            accountButton
        }))
    }

    // Global destinations stay outside the List's native navigation stack.
    private func shellHeader(sidebarAvailable: Bool) -> some View {
        HStack(spacing: 8) {
            // Equal flexible sides keep the destination picker centred.
            HStack(spacing: 8) {
                filterButton(sidebarAvailable: sidebarAvailable)
                if compactBar && store.selectedTab == .list {
                    SelectionBar(store: store, includesTotal: true, onNavigationBar: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            destinationPicker
            // Measured before the sides, so the full picker wins when it fits.
            .layoutPriority(1)
            HStack(spacing: 8) {
                if compactBar && store.selectedTab == .list {
                    ListControls(presentation: store.listPresentation, iconOnly: true, onNavigationBar: true)
                }
                accountButton
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .frame(height: compactBar ? 44 : 54)
        // Controls stay inside the safe area; only the colour reaches the edges.
        .background(AppTheme.navigationBlue.ignoresSafeArea(edges: [.top, .horizontal]))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("browse-header")
    }

    private func filterButton(sidebarAvailable: Bool) -> some View {
        // Expands the rail into the full panel (or opens the sheet) and back.
        let open = sheets.showsFilters
        return Button {
            if sidebarAvailable { setFiltersExpanded(!open) }
            else { sheets.showsFilters.toggle() }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.body.weight(.semibold))
                .frame(width: 44, height: 44)
                .background(open ? Color.white.opacity(0.2) : .clear,
                            in: RoundedRectangle(cornerRadius: 12))
                .overlay(alignment: .topTrailing) {
                    if activeFilterCount > 0 { FilterCountBadge(count: activeFilterCount) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .frame(width: 44, height: 44)
        .accessibilityLabel(filterButtonLabel)
        .accessibilityIdentifier("browse-filters")
        .accessibilityValue(open ? "Expanded" : "Collapsed")
        .accessibilityAddTraits(open ? .isSelected : [])
    }

    private var destinationPicker: some View {
        ViewThatFits(in: .horizontal) {
            modePicker.fixedSize(horizontal: true, vertical: false)
            Menu {
                ForEach(AppTab.available(stats: statsContent != nil), id: \.self) { tab in
                    Button(tab.title) { store.selectedTab = tab }
                }
            } label: {
                Label(store.selectedTab.title, systemImage: "chevron.down")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white).frame(minHeight: 44)
            }
            .accessibilityLabel("View: \(store.selectedTab.title)")
            .accessibilityIdentifier("browse-destination-menu")
        }
    }

    private var accountButton: some View {
        Button {
            sheets.accountDestination = .settings
        } label: {
            AsyncImage(url: auth.currentUser?.image.flatMap(URL.init(string:))) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                        .frame(width: 32, height: 32)
                        .clipShape(Circle())
                        .overlay { Circle().strokeBorder(.white.opacity(0.65), lineWidth: 1) }
                } else {
                    Image(systemName: "person.crop.circle")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 44, height: 44)
            // Quiet activity-loading indicator (#309); sync detail lives in Settings.
            .overlay { AvatarSyncIndicator(busy: syncing) }
            .contentShape(Rectangle())
            .accessibilityHidden(true)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
        .accessibilityValue(syncing ? "Syncing activities" : "")
        .accessibilityIdentifier("open-settings")
    }

    private var content: some View {
        BrowseContent(store: store, refresh: refresh, sync: sync, isSigningIn: auth.status == .signingIn,
                      mapPicker: mapPicker)
            .environment(\.browseStatsDestination, statsContent)
            .environment(\.statsRecovery, StatsRecovery(refresh: refresh))
            .tint(AppTheme.accent)
    }

    private func refresh() async {
        guard let localStore else { return }
        if let sync, let retry = sync.retryNotBefore, retry > Date() {
            // The controller still applies expiry/disconnection cleanup during
            // a server wait, without issuing another session/sync request.
            await sync.refresh()
            return
        }
        await auth.restoreSession()
        sync?.setSession(auth.syncSession, storage: localStore)
        await sync?.refresh()
    }

    private var filterButtonLabel: String { FilterCountBadge.label(count: activeFilterCount) }

    private var filterScope: FilterScope { store.selectedTab == .stats ? .stats : .browsing }
    private var activeFilterCount: Int { filterScope == .stats ? store.activeStatsFilterCount : store.activeFilterCount }

    private var modePicker: some View {
        HStack(spacing: 2) {
            ForEach(AppTab.available(stats: statsContent != nil), id: \.self) { tab in
                Button {
                    store.selectedTab = tab
                } label: {
                    Text(tab.title)
                        .font(.subheadline)
                        .fontWeight(store.selectedTab == tab ? .semibold : .regular)
                        .foregroundStyle(Color.white)
                        .frame(minWidth: 54)
                        .padding(.horizontal, 8)
                        .frame(minHeight: compactBar ? 36 : 44)
                        .background(
                            store.selectedTab == tab ? Color.white.opacity(0.22) : .clear,
                            in: Capsule()
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(store.selectedTab == tab ? .isSelected : [])
                .accessibilityIdentifier("browse-destination-\(tab.title.lowercased())")
            }
        }
        .padding(compactBar ? 2 : 3)
        .background(Color.white.opacity(0.08), in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("View")
    }
}

enum AccountDestination: String, Identifiable {
    case profile
    case settings
    case about

    var id: String { rawValue }
}

#Preview {
    AppShell(activities: SampleData.activities)
}

enum ShellSheet: Identifiable {
    case filters
    case account(AccountDestination)
    var id: String {
        switch self {
        case .filters: "filters"
        case .account(let destination): "account-\(destination.rawValue)"
        }
    }
}

/// The active-filter count on the shell's filter button, shared by iPhone and iPad.
struct FilterCountBadge: View {
    let count: Int

    /// VoiceOver reads the count with the button, e.g. "Filters, 3 active".
    static func label(count: Int) -> String { count == 0 ? "Filters" : "Filters, \(count) active" }

    var body: some View {
        Text("\(count)")
            .font(.caption2.weight(.bold)).monospacedDigit()
            .foregroundStyle(AppTheme.navigationBlue)
            .padding(.horizontal, 4)
            .frame(minWidth: 17, minHeight: 17)
            .background(.white, in: Capsule())
            .offset(x: -1, y: 3)
            .accessibilityHidden(true)
    }
}

/// Separate requests from completed presentations so sheets never compete.
@MainActor @Observable
final class BrowseSheetPresentation {
    /// Filters are open: the sheet on narrow windows, the overlay sidebar on wide ones.
    var showsFilters = false
    var accountDestination: AccountDestination?
    var mapResultsPresented = false
    var shellSheetPresented = false
}

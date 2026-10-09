import SwiftUI

struct BrowseContent: View {
    @Bindable var store: ActivityStore
    var refresh: () async -> Void = {}
    var sync: SyncController? = nil
    var isSigningIn = false
    var mapPicker: RoutePicker? = nil
    @Environment(\.browseStatsDestination) private var statsDestination
    @Environment(\.stravaConnect) private var stravaConnect

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Retaining this native List preserves the exact scroll offset,
                // including partially visible rows. No reconstructed anchor jump.
                NavigationStack {
                    ListScreen(store: store, emptyState: presentation.empty, recover: recover)
                        // Establish the detail bar's inline metrics before the
                        // first push, even while the root bar is hidden.
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar(.hidden, for: .navigationBar)
                }
                    .id(store.mapContext.scopeRevision)
                    .refreshable {
                        guard sync?.canRefresh ?? true else { return }
                        await refresh()
                    }
                    .opacity(store.selectedTab == .list ? 1 : 0)
                    .allowsHitTesting(store.selectedTab == .list)
                    .accessibilityHidden(store.selectedTab != .list)
                // Keep the loaded style, GeoJSON source and rendered route tiles
                // alive too; saving only the camera causes routes to pop in later.
                MapScreen(store: store, topOcclusion: geometry.safeAreaInsets.top, picker: mapPicker)
                    .id(store.mapContext.scopeRevision)
                    .ignoresSafeArea(edges: .top)
                    .opacity(store.selectedTab == .map ? 1 : 0)
                    .allowsHitTesting(store.selectedTab == .map)
                    .accessibilityHidden(store.selectedTab != .map)
                if store.selectedTab == .map, let empty = mapEmptyState {
                    BrowsingEmptyView(state: empty, recover: recover, scrolls: false)
                        .frame(maxWidth: min(560, max(0, geometry.size.width - 32)))
                        .padding(.horizontal, 16)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .padding(.top, 16)
                }

                if let statsDestination {
                    statsDestination.content(store, sync)
                        .id(store.mapContext.scopeRevision)
                        .opacity(store.selectedTab == .stats ? 1 : 0)
                        .allowsHitTesting(store.selectedTab == .stats)
                        .accessibilityHidden(store.selectedTab != .stats)
                }

            }
        }
        .confirmationDialog("This activity is hidden by filters", isPresented: Binding(
            get: { store.mapContext.hiddenTargetID != nil },
            set: { if !$0 { store.mapContext.hiddenTargetID = nil } }
        ), titleVisibility: .visible) {
            if let id = store.mapContext.hiddenTargetID {
                Button("Clear filters and show on map") { store.clearFiltersAndShowOnMap(id) }
            }
            Button("Cancel", role: .cancel) { store.mapContext.hiddenTargetID = nil }
        }
        .alert("Map camera", isPresented: Binding(
            get: { store.mapContext.navigationError != nil },
            set: { if !$0 { store.mapContext.navigationError = nil } }
        )) {
            Button("OK", role: .cancel) { store.mapContext.navigationError = nil }
        } message: {
            Text(store.mapContext.navigationError ?? "")
        }
    }

    // Sync/loading/auth information belongs in Settings, and the Strava
    // connection in the shell's overlay (#304). Only map-specific filtering
    // and missing-route context uses an inline, content-sized notice.
    private var mapEmptyState: BrowsingPresentation.EmptyState? {
        guard let empty = presentation.empty,
              empty.kind == .noMatches || empty.kind == .noRoutes else { return nil }
        return empty
    }

    private var presentation: BrowsingPresentation {
        BrowsingPresentation(store: store, sync: sync, isSigningIn: isSigningIn)
    }

    private func recover(_ action: BrowsingPresentation.Recovery) {
        switch action {
        case .clearFilters: store.resetFilters()
        case .retry:
            guard sync?.canRefresh == true else { return }
            Task { await refresh() }
        case .account: stravaConnect.start()
        case .showList: store.selectedTab = .list
        case .cancelSync: sync?.pause()
        }
    }
}

/// A real Stats screen registers once at the shell boundary, retaining its
/// scroll/metric/history state. It uses the shared store and StatsController,
/// and receives SyncController for truthful history/loading presentation.
struct BrowseStatsDestination {
    let content: @MainActor (ActivityStore, SyncController?) -> AnyView
}

private struct BrowseStatsDestinationKey: EnvironmentKey {
    static let defaultValue: BrowseStatsDestination? = nil
}
extension EnvironmentValues {
    /// The shell's target column width, independent of a retained native
    /// navigation root's temporarily stale frame during destination switches.
    @Entry var browsePaneWidth: CGFloat? = nil

    /// The expanded filter panel collapses to its rail as List inspection
    /// starts, so List waits for that width instead of pushing its detail.
    @Entry var filtersCollapseForDetail = false

    var browseStatsDestination: BrowseStatsDestination? {
        get { self[BrowseStatsDestinationKey.self] }
        set { self[BrowseStatsDestinationKey.self] = newValue }
    }
}

enum BrowsePaneLayout {
    static let filterWidth: CGFloat = 320
    static let minimumDetailWidth: CGFloat = 760

    /// Wide regular windows keep the filter rail beside the content; narrower
    /// ones and accessibility text use the phone's filter sheet.
    static func filtersUseSidebar(width: CGFloat, regular: Bool, accessibilityText: Bool) -> Bool {
        regular && width >= minimumDetailWidth && !accessibilityText
    }

    /// The full panel leaves no room for List and its adjacent detail, but the
    /// collapsed rail does, as in 11-inch portrait (#354).
    static func panelSqueezesDetail(width: CGFloat) -> Bool {
        width - filterWidth - 1 < minimumDetailWidth && width - FilterRail.width - 1 >= minimumDetailWidth
    }
}

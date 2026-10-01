import SwiftUI

struct BrowseContent: View {
    @Bindable var store: ActivityStore
    var refresh: () async -> Void = {}
    var sync: SyncController? = nil
    var isSigningIn = false
    var openAccount: () -> Void = {}

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Retaining this native List preserves the exact scroll offset,
                // including partially visible rows. No reconstructed anchor jump.
                ListScreen(store: store, emptyState: presentation.empty, recover: recover)
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
                MapScreen(store: store, topOcclusion: geometry.safeAreaInsets.top)
                    .id(store.mapContext.scopeRevision)
                    .ignoresSafeArea(edges: .top)
                    .opacity(store.selectedTab == .map ? 1 : 0)
                    .allowsHitTesting(store.selectedTab == .map)
                    .accessibilityHidden(store.selectedTab != .map)
                if store.selectedTab == .map, let empty = presentation.empty {
                    BrowsingEmptyView(state: empty, recover: recover)
                        .frame(maxWidth: min(560, max(0, geometry.size.width - 32)))
                        .frame(maxHeight: max(0, min(480, geometry.size.height - 196)))
                        .padding(.horizontal, 16)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .padding(.top, 16)
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

    private var presentation: BrowsingPresentation {
        BrowsingPresentation(store: store, sync: sync, isSigningIn: isSigningIn)
    }

    private func recover(_ action: BrowsingPresentation.Recovery) {
        switch action {
        case .clearFilters: store.resetFilters()
        case .retry:
            guard sync?.canRefresh == true else { return }
            Task { await refresh() }
        case .account: openAccount()
        case .showList: store.selectedTab = .list
        case .cancelSync: sync?.pause()
        }
    }
}

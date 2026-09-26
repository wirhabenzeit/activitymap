import SwiftUI

struct BrowseContent: View {
    @Bindable var store: ActivityStore
    var refresh: () async -> Void = {}

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Retaining this native List preserves the exact scroll offset,
                // including partially visible rows. No reconstructed anchor jump.
                ListScreen(store: store)
                    .id(store.mapContext.scopeRevision)
                    .refreshable { await refresh() }
                    .opacity(store.selectedTab == .list ? 1 : 0)
                    .allowsHitTesting(store.selectedTab == .list)
                    .accessibilityHidden(store.selectedTab != .list)
                if store.selectedTab == .map {
                    MapScreen(store: store, topOcclusion: geometry.safeAreaInsets.top)
                        .ignoresSafeArea(edges: .top)
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
}

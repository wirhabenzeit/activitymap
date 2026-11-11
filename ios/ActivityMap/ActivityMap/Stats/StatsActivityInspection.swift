import SwiftUI

/// Shared presentation, independent Stats inspection and selection ownership.
struct StatsActivityInspection<Content: View>: View {
    let store: ActivityStore
    let dashboard: StatsDashboardState
    var active = true
    var registersNavigation = true
    let backLabel: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        AdaptiveActivityInspection(selection: Binding(get: { dashboard.inspectedActivityID },
                                                       set: { dashboard.inspectedActivityID = $0 }),
            active: active, registersNavigation: registersNavigation,
            closeIdentifier: "stats-activity-close", panelIdentifier: "stats-activity-panel") { layout in
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .environment(\.statsAvailableWidth, layout.width)
                .environment(\.statsInspectedActivityID, active ? dashboard.inspectedActivityID : nil)
        } panel: { id in
            ActivityDetailPanel(store: store, activityID: id, headerTrailingInset: AppTheme.minimumTarget,
                                hostTab: .stats, showOnMap: { id in
                if store.showOnMap(id) == .shown { dashboard.inspectedActivityID = nil }
            })
        } destination: { id in
            ActivityDetailView(store: store, activityID: id, backLabel: backLabel,
                               backIdentifier: "stats-activity-back", onMapShown: {
                dashboard.inspectedActivityID = nil
            }, hostTab: .stats)
        }
        // Only the visible surface presents; the dashboard stays mounted
        // beneath a focus page.
        .sheet(item: Binding(get: { active ? dashboard.inspectedPlaceID.map(StatsPlaceSelection.init) : nil },
                             set: { dashboard.inspectedPlaceID = $0?.id })) { selection in
            NavigationStack {
                if let place = store.placeLibrary.byID[selection.id] {
                    PlaceDetailView(item: place) { destination in
                        dashboard.inspectedPlaceID = nil
                        store.show(place, in: destination)
                    }
                } else { Text("No activities for this place.").padding() }
            }
        }
    }
}

private struct StatsPlaceSelection: Identifiable {
    let id: String
}

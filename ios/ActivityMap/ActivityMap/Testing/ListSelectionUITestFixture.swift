#if DEBUG
import MapboxMaps
import SwiftUI

/// Offline browsing fixture for real accessibility/rotation tests. No local
/// store is attached, so the shell never starts authentication or sync work.
struct ListSelectionUITestFixture: View {
    @State private var store: ActivityStore
    let standalone: Bool

    init(standalone: Bool) {
        self.standalone = standalone
        MapboxOptions.accessToken = "pk.offline-test"
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let activities = (1...4).map { id in
            Activity(id: id, name: "Activity \(id)", sportType: .ride, startDate: date,
                     startDateLocal: date, timezone: "UTC", distance: 1000, movingTime: 600,
                     elapsedTime: 600, totalElevationGain: 10, averageSpeed: 2, commute: false,
                     coordinates: [.init(latitude: 46, longitude: 8), .init(latitude: 46.01, longitude: 8.01)])
        }
        let store = ActivityStore(activities: activities, listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        store.replaceSelection(with: [2, 4])
        store.setCombine(true)
        _store = State(initialValue: store)
    }

    var body: some View {
        Group {
            if standalone { BrowseContent(store: store) }
            else { AppShell(store: store) }
        }
        .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))
    }
}
#endif

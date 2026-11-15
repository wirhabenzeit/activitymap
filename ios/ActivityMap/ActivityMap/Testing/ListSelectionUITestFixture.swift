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
        let summaryLayout = ProcessInfo.processInfo.arguments.contains("--summary-layout-ui-testing")
        var activities = (1...(summaryLayout ? 4634 : 4)).map { id in
            var activity = Activity(id: id, name: "Activity \(id)", sportType: .ride, startDate: date,
                     startDateLocal: date, timezone: "UTC", distance: 1000, movingTime: 600,
                     elapsedTime: 600, totalElevationGain: 10, averageSpeed: 2, commute: false,
                     coordinates: [.init(latitude: 46, longitude: 8), .init(latitude: 46.01, longitude: 8.01)])
            if id == 2 {
                // Representative recorded details make the inspection scroll,
                // while the selection and four browsing rows stay unchanged.
                activity.elevLow = 680
                activity.elevHigh = 1420
                activity.maxSpeed = 14.2
                activity.averageHeartrate = 142
                activity.maxHeartrate = 176
                activity.averageWatts = 185
                activity.maxWatts = 620
                activity.weightedAverageWatts = 198
                activity.calories = 680
                activity.kilojoules = 720
                activity.kudosCount = 12
                activity.achievementCount = 3
                activity.commentCount = 2
                activity.isPrivate = false
                activity.flagged = false
                activity.trainer = false
                activity.manual = false
            }
            return activity
        }
        if summaryLayout {
            for index in activities.indices {
                activities[index].distance = nil; activities[index].elapsedTime = nil
                activities[index].movingTime = nil; activities[index].totalElevationGain = nil
                activities[index].averageSpeed = nil; activities[index].elevLow = nil; activities[index].elevHigh = nil
                activities[index].averageWatts = nil; activities[index].weightedAverageWatts = nil
                activities[index].maxWatts = nil; activities[index].averageHeartrate = nil; activities[index].maxHeartrate = nil
            }
            activities[0].distance = 104_582_000; activities[0].elapsedTime = 351 * 86400
            activities[0].movingTime = 278 * 86400 + 19 * 3600
            activities[0].totalElevationGain = 2_273_157; activities[0].averageSpeed = 5
            activities[0].elevLow = -4755; activities[0].elevHigh = 8395
            activities[0].averageWatts = 205; activities[0].weightedAverageWatts = 295; activities[0].maxWatts = 2309
            activities[0].averageHeartrate = 128; activities[0].maxHeartrate = 227
        }
        let store = ActivityStore(activities: activities, listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        if summaryLayout { store.listPresentation.settings.summaryMode = .filtered }
        else { store.replaceSelection(with: [2, 4]) }
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

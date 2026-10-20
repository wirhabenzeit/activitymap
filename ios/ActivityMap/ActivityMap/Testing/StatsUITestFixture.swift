#if DEBUG
import MapboxMaps
import SwiftUI

/// Real Stats navigation with a private, offline library. No LocalStore is
/// injected, so AppShell cannot restore a session or start network sync.
struct StatsUITestFixture: View {
    @State private var store: ActivityStore
    @State private var preferences = DisplayPreferences(defaults: nil)
    private let largeText = ProcessInfo.processInfo.arguments.contains("--stats-ui-scenario=large-text")

    init() {
        MapboxOptions.accessToken = "pk.offline-test"
        PerfProbe.install()
        let today = StatsDates.localToday()
        let sports: [SportType] = [.ride, .run, .hike, .swim]
        // Relative dates remain representative when the suite runs after the
        // original regression date; AppShell owns the production day refresh.
        var activities = stride(from: today - 6 * 365, through: today - 1, by: 11).enumerated().map { index, day in
            Self.activity(id: index + 1, day: day, sport: sports[index % sports.count])
        }
        // Selecting the latest calendar day exposes enough real rows to scroll
        // on iPad as well as iPhone, without artificial fixture-only padding.
        activities += (1...24).map { index in
            Self.activity(id: 9000 + index, day: today, sport: sports[index % sports.count])
        }
        let store = ActivityStore(activities: activities, listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .stats
        _store = State(initialValue: store)
    }

    var body: some View {
        AppShell(store: store)
            .environment(preferences)
            .environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))
    }

    private static func activity(id: Int, day: Int, sport: SportType) -> Activity {
        let date = StatsDates.date(day).addingTimeInterval(12 * 3600)
        return Activity(id: id, name: "Stats activity \(id)", sportType: sport,
            startDate: date, startDateLocal: date, timezone: "UTC", distance: 12_000,
            movingTime: 3600, elapsedTime: 3900, totalElevationGain: 240, averageSpeed: 3.3,
            commute: false, coordinates: [])
    }
}
#endif

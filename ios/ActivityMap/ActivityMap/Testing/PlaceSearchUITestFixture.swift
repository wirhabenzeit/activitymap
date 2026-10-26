#if DEBUG
import SwiftUI
import MapboxMaps

/// Synthetic synced-library host; all search, filtering and detail UI is production.
struct PlaceSearchUITestFixture: View {
    @State private var store = ActivityStore()
    @State private var preferences = DisplayPreferences(defaults: nil)
    @State private var error = ""
    @State private var sheets = BrowseSheetPresentation()
    private let sheetTest = ProcessInfo.processInfo.arguments.contains("--place-search-sheet-ui-testing")
    var body: some View {
        Group {
            if sheetTest {
                AppShell(store: store, sheets: sheets)
                    .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))
            } else {
                inlinePanel
            }
        }
        .environment(preferences)
        .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("--place-search-dark-ui-testing") ? .dark : nil)
        .task {
            do {
                let version = String(repeating: "a", count: 64)
                let peak: [String: Any] = ["id": "00000000-0000-4000-8000-000000000001", "name": "Pilátus", "kinds": ["peak"], "latitude": 46.98, "longitude": 8.25, "elevationM": 2128, "visits": [["distanceM": 10], ["distanceM": 20]]]
                var duplicate = peak; duplicate["id"] = "00000000-0000-4000-8000-000000000002"; duplicate["longitude"] = 9.25
                var western = peak
                western["id"] = "00000000-0000-4000-8000-000000000003"
                western["name"] = "Pilatus West with a very long mountain name"
                western["elevationM"] = 2050
                let activities = try (1...3).map { id in
                    let result: [String: Any] = ["userId": "place-search", "activityId": String(id), "status": "complete", "streamGeneration": "g", "streamRevision": "1", "catalogueSnapshotId": "fixture", "matcherVersion": "fixture", "matchingVersion": version, "places": id == 3 ? [duplicate, western] : [peak]]
                    let fields: [String: Any] = ["id": String(id), "athlete": "42", "name": id == 1 ? "Morning ridge" : "Evening outing", "sport_type": id == 2 ? "Ride" : "Hike", "start_date": "2026-05-01T12:00:00Z", "start_date_local": id == 1 ? "2025-05-01T12:00:00Z" : "2026-05-01T12:00:00Z", "timezone": "Europe/Zurich", "geometry_state": "summary", "placeMatches": result]
                    return try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.Activity.self, from: JSONSerialization.data(withJSONObject: fields))
                }
                let checkpoint = SyncCheckpoint(bootstrapComplete: true, lastSyncAt: .now, freshness: .init(lastSummaryReconciledAt: nil, placeMatchingVersion: version))
                try store.replaceSyncedActivities(StoreSnapshot(activities: activities, photos: [], checkpoint: checkpoint), scope: StoreScope(deployment: URL(string: "https://example.test")!, userID: "place-search"))
                if sheetTest { store.selectedTab = .list; sheets.showsFilters = true }
            } catch { self.error = error.localizedDescription }
        }
    }

    private var inlinePanel: some View {
        NavigationStack {
            VStack(spacing: 0) {
                FilterPanel(store: store)
                Text("Visible: \(store.filteredActivities.map { String($0.id) }.joined(separator: ","))")
                    .accessibilityIdentifier("place-search-visible")
                Text("Stats: \(store.statsActivities.map { String($0.id) }.joined(separator: ","))")
                    .accessibilityIdentifier("place-search-stats")
                Text(error).accessibilityIdentifier("place-search-error")
            }
            .navigationTitle("Place search")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("2026 only") {
                        store.dateDayRange = ActivityDayRange(start: "2026-01-01", end: "2026-12-31")
                    }
                }
            }
        }
    }

}
#endif

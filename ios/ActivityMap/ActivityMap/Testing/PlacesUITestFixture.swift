#if DEBUG
import MapboxMaps
import SwiftUI

/// Offline synthetic host using production map, profile, loaders and SwiftData.
struct PlacesUITestFixture: View {
    @State private var store = ActivityStore()
    @State private var preferences = DisplayPreferences(defaults: nil)
    @State private var picker = RoutePicker()
    @State private var ready = false
    @State private var error = ""
    @State private var dark = false
    @State private var scopeStep = 0
    @State private var storage: LocalStore?
    private let places = ActivityPlacesLoader(source: { _ in PlacesFixtureOfflineSource() })
    private let summaries = StreamSummaryLoader(source: { _ in PlacesFixtureOfflineSource() })
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Change style") { dark.toggle() }.accessibilityIdentifier("places-change-style")
                Button("Clear selection") { store.clearSelection() }.accessibilityIdentifier("places-clear-selection")
                Button("Scope") {
                    switch scopeStep {
                    case 0: store.toggleActive(1); picker.showResults()
                    case 1: store.setCombine(true)
                    case 2: store.setCombine(false)
                    default: picker.showDetail(1, store: store)
                    }
                    scopeStep += 1
                }.font(.caption).accessibilityIdentifier("places-route-scope")
            }.buttonStyle(.bordered)
            Text("Selected routes: \(store.selectedActivityIDs.count)").accessibilityIdentifier("places-selection-count")
            if ready {
                MapScreen(store: store, picker: picker)
                    .environment(\.mapStyleOverride, MapStyle(json: dark
                        ? ##"{"version":8,"sources":{},"layers":[{"id":"bg","type":"background","paint":{"background-color":"#23313a"}}]}"##
                        : ##"{"version":8,"sources":{},"layers":[{"id":"bg","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))
            } else { Text(error.isEmpty ? "Preparing places fixture" : error) }
        }
        .environment(preferences)
        .environment(\.locale, Locale(identifier: "en_US"))
        .preferredColorScheme(dark ? .dark : .light)
        .task {
            guard !ready else { return }
            do {
                let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
                self.storage = storage
                let session = SyncSession(user: .init(id: "places-fixture", name: nil, email: nil, image: nil,
                    athleteID: "42", stravaConnected: true, stravaPermissions: nil,
                    authentication: .init(method: .bearer, sessionExpiresAt: .now.addingTimeInterval(86400))),
                    token: "synthetic-offline", deployment: URL(string: "https://example.test")!, verified: false)
                let fields: [String: Any] = ["id": "1", "athlete": "42", "name": "Alpine loop", "sport_type": "Hike",
                    "start_date": "2026-10-23T09:00:00Z", "start_date_local": "2026-10-23T11:00:00Z", "timezone": "Europe/Zurich",
                    "geometry_state": "summary", "photos_state": "current", "distance": 1000]
                let dto = try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.Activity.self, from: JSONSerialization.data(withJSONObject: fields))
                try await storage.apply([.upsertActivity(dto)], scope: session.scope)
                let metadata = ActivityMapAPI.StreamMetadata(generation: "g", revision: "1", state: .current,
                    fetchStatus: .succeeded, availableTypes: [.distance, .latlng, .altitude], fetchedAt: .now, expiresAt: nil)
                let summary = ActivityMapAPI.StreamSummary(version: 1, basis: .distance, time: nil,
                    distance: [100, 350, 600, 850, 1100], latlng: [[47, 8], [47.001, 8.001], [47.002, 8.002], [47.003, 8.003], [47.004, 8.004]],
                    altitude: [400, 500, 600, 500, 400], watts: nil, heartrate: nil)
                let compact = ActivityMapAPI.ActivityCompactStreamSummary(activityID: "1", metadata: metadata,
                    summary: try CompactStreamCodec.encode(summary), lastError: nil, nextRetryAt: nil)
                let fence = await storage.streamFence()
                _ = try await storage.saveStreamSummary(compact, scope: session.scope, fence: fence)
                let hut = ActivityMapAPI.MatchedPlace(id: "hut", name: "Alpine hut", kinds: [.hut], longitude: 8.001, latitude: 47.001,
                    elevationM: 500, visits: [.init(distanceM: 350), .init(distanceM: 850)])
                let peak = ActivityMapAPI.MatchedPlace(id: "peak", name: "Test summit", kinds: [.peak], longitude: 8.002, latitude: 47.002,
                    elevationM: 600, visits: [.init(distanceM: 600)])
                let pass = ActivityMapAPI.MatchedPlace(id: "pass", name: "Test pass", kinds: [.pass], longitude: 8.0035, latitude: 47.0025,
                    elevationM: 550, visits: [.init(distanceM: 725)])
                let result = ActivityMapAPI.ActivityPlaces(userID: session.scope.userID, activityID: "1", status: .complete,
                    streamGeneration: "g", streamRevision: "1", catalogueSnapshotID: "synthetic", matcherVersion: "synthetic", matchingVersion: nil, resultRevision: nil,
                    places: [hut, peak, pass])
                _ = try await storage.saveActivityPlaces(result, scope: session.scope, fence: fence, now: .now)
                await places.configure(session, storage: storage)
                await summaries.configure(session, storage: storage)
                var activity = Activity(id: 1, name: "Alpine loop", sportType: .hike, startDate: .now, startDateLocal: .now,
                    timezone: "Europe/Zurich", distance: 1000, movingTime: 900, elapsedTime: 1000,
                    totalElevationGain: 200, averageSpeed: 1, commute: false,
                    coordinates: [.init(latitude: 47, longitude: 8), .init(latitude: 47.004, longitude: 8.004)])
                activity.streams = metadata
                store.activities = [activity]; store.selectedTab = .map; store.replaceSelection(with: [1])
                store.activityPlaces = places; store.streamSummaries = summaries
                picker.detailID = 1; picker.isPresented = true; picker.detent = .medium
                store.mapContext.record(CameraState(center: .init(latitude: 47.002, longitude: 8.002), padding: UIEdgeInsets(top: 0, left: 0, bottom: 400, right: 0), zoom: 15, bearing: 0, pitch: 0))
                ready = true
            } catch { self.error = String(describing: error) }
        }
    }
}
private actor PlacesFixtureOfflineSource: ActivityPlacesSource, CompactSummarySource {
    func places(activityID: String) throws -> ActivityMapAPI.ActivityPlaces { throw APIClient.RequestError.transport("Offline fixture requested places") }
    func summary(activityID: String, mode: StreamFetchMode) throws -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummary> {
        throw APIClient.RequestError.transport("Offline fixture requested streams")
    }
}
#endif

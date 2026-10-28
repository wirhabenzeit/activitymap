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
    private let overviewTest = ProcessInfo.processInfo.arguments.contains("--places-overview-ui-testing")
    private let markerStyleTest = ProcessInfo.processInfo.arguments.contains("--places-marker-style-ui-testing")
    private var chooserTest: Bool { overviewTest || ProcessInfo.processInfo.arguments.contains("--places-chooser-ui-testing") }
    private let places = ActivityPlacesLoader()
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
                .accessibilityValue("Active route: \(store.activeActivityID.map(String.init) ?? "none")")
            if overviewTest {
                HStack {
                    Button("Inspect first") { store.replaceSelection(with: [1]); picker.showDetail(1, store: store) }
                        .accessibilityIdentifier("places-inspect-first")
                    Button("Hide second route") { store.activeSportTypes.remove(.ride) }
                        .accessibilityIdentifier("places-hide-second")
                    Text("Detail: \(picker.detailID.map(String.init) ?? "none")").accessibilityIdentifier("places-detail-state")
                }.font(.caption).buttonStyle(.bordered)
            }
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
                var dtos = [dto]
                if chooserTest {
                    var secondFields = fields
                    secondFields["id"] = "2"; secondFields["name"] = "Second alpine loop"
                    dtos.append(try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.Activity.self,
                        from: JSONSerialization.data(withJSONObject: secondFields)))
                }
                try await storage.apply(dtos.map { .upsertActivity($0) }, scope: session.scope)
                let metadata = ActivityMapAPI.StreamMetadata(generation: "g", revision: "1", state: .current,
                    fetchStatus: .succeeded, availableTypes: [.distance, .latlng, .altitude], fetchedAt: .now, expiresAt: nil)
                let summary = ActivityMapAPI.StreamSummary(version: 1, basis: .distance, time: nil,
                    distance: [100, 350, 600, 850, 1100], latlng: [[47, 8], [47.001, 8.001], [47.002, 8.002], [47.003, 8.003], [47.004, 8.004]],
                    altitude: [400, 500, 600, 500, 400], watts: nil, heartrate: nil)
                let compact = ActivityMapAPI.ActivityCompactStreamSummary(activityID: "1", metadata: metadata,
                    summary: try CompactStreamCodec.encode(summary), lastError: nil, nextRetryAt: nil)
                let fence = await storage.streamFence()
                _ = try await storage.saveStreamSummary(compact, scope: session.scope, fence: fence)
                let hut = ActivityMapAPI.MatchedPlace(id: "hut", name: "Alpine hut", kinds: [.hut], longitude: overviewTest ? 8.002 : 8.001, latitude: overviewTest ? 47.002 : 47.001,
                    elevationM: 500, visits: [.init(distanceM: 350), .init(distanceM: 850), .init(distanceM: 1105)])
                let peak = ActivityMapAPI.MatchedPlace(id: "peak", name: "Test summit", kinds: [.peak], longitude: 8.002, latitude: 47.002,
                    elevationM: 600, visits: [.init(distanceM: 600)])
                let pass = ActivityMapAPI.MatchedPlace(id: "pass", name: "Test pass", kinds: [.pass], longitude: overviewTest ? 8.002 : 8.0035, latitude: overviewTest ? 47.002 : 47.0025,
                    elevationM: 550, visits: [.init(distanceM: 725)])
                let result = ActivityMapAPI.ActivityPlaces(userID: session.scope.userID, activityID: "1", status: .complete,
                    streamGeneration: "g", streamRevision: "1", catalogueSnapshotID: "synthetic", matcherVersion: "synthetic", matchingVersion: nil, resultRevision: nil,
                    places: [hut, peak, pass])
                var synced = [try Self.synced(dto, places: result)]
                if chooserTest {
                    let secondSummary = ActivityMapAPI.ActivityCompactStreamSummary(activityID: "2", metadata: metadata,
                        summary: try CompactStreamCodec.encode(summary), lastError: nil, nextRetryAt: nil)
                    _ = try await storage.saveStreamSummary(secondSummary, scope: session.scope, fence: fence)
                    let secondHut = ActivityMapAPI.MatchedPlace(id: "second-hut", name: "Second route hut", kinds: [.hut],
                        longitude: overviewTest ? 8.002 : 8.003, latitude: overviewTest ? 47.002 : 47.003, elevationM: 500, visits: [.init(distanceM: 850)])
                    let secondResult = ActivityMapAPI.ActivityPlaces(userID: session.scope.userID, activityID: "2", status: .complete,
                        streamGeneration: "g", streamRevision: "1", catalogueSnapshotID: "synthetic", matcherVersion: "synthetic",
                        matchingVersion: nil, resultRevision: nil, places: [peak, secondHut])
                    synced.append(try Self.synced(dtos[1], places: secondResult))
                }
                // Places arrive only through library sync, as from backend matching.
                try await storage.apply(synced.map { .upsertActivity($0) }, scope: session.scope)
                await places.configure(session, storage: storage)
                await summaries.configure(session, storage: storage)
                var activity = Activity(id: 1, name: "Alpine loop", sportType: .hike, startDate: .now, startDateLocal: .now,
                    timezone: "Europe/Zurich", distance: 1000, movingTime: 900, elapsedTime: 1000,
                    totalElevationGain: 200, averageSpeed: 1, commute: false,
                    coordinates: [.init(latitude: 47, longitude: 8), .init(latitude: 47.004, longitude: 8.004)])
                activity.streams = metadata
                var activities = [activity]
                if chooserTest {
                    var second = Activity(id: 2, name: "Second alpine loop", sportType: overviewTest ? .ride : .hike, startDate: .now, startDateLocal: .now,
                        timezone: "Europe/Zurich", distance: 1000, movingTime: 900, elapsedTime: 1000,
                        totalElevationGain: 200, averageSpeed: 1, commute: false, coordinates: activity.coordinates)
                    second.streams = metadata
                    activities.append(second)
                }
                store.activities = activities; store.selectedTab = .map
                store.replaceSelection(with: chooserTest ? [] : [1])
                store.activityPlaces = places; store.streamSummaries = summaries
                if markerStyleTest {
                    let location = CLLocationCoordinate2D(latitude: 47.002, longitude: 8.06)
                    store.photos = ["marker-photo-a", "marker-photo-b"].map {
                        Photo(id: $0, activityID: "1", caption: nil, urls: [:], location: location, createdAt: nil)
                    }
                    store.mapContext.showPhotos = true
                }
                picker.detailID = chooserTest ? nil : 1; picker.isPresented = !chooserTest; picker.detent = .medium
                // Keep overview anchors in the real viewport in short landscape
                // layouts too. The legacy profile fixture reserves its tall sheet.
                store.mapContext.record(CameraState(center: .init(latitude: 47.002, longitude: 8.002), padding: UIEdgeInsets(top: 0, left: 0, bottom: overviewTest ? 200 : 400, right: 0), zoom: markerStyleTest ? 11 : overviewTest ? 12 : 15, bearing: 0, pitch: 0))
                ready = true
            } catch { self.error = String(describing: error) }
        }
    }
    private static func synced(_ dto: ActivityMapAPI.Activity, places: ActivityMapAPI.ActivityPlaces) throws -> ActivityMapAPI.Activity {
        let encoder = ActivityMapAPI.makeEncoder()
        guard var fields = try JSONSerialization.jsonObject(with: encoder.encode(dto)) as? [String: Any] else { throw CocoaError(.coderInvalidValue) }
        fields["placeMatches"] = try JSONSerialization.jsonObject(with: encoder.encode(places))
        return try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.Activity.self, from: JSONSerialization.data(withJSONObject: fields))
    }
}
private actor PlacesFixtureOfflineSource: CompactSummarySource {
    func summary(activityID: String, mode: StreamFetchMode) throws -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummary> {
        throw APIClient.RequestError.transport("Offline fixture requested streams")
    }
}
#endif

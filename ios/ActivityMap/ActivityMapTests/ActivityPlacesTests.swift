import Foundation
import SwiftData
import Testing
@testable import ActivityMap

nonisolated private final class PlacesSaveFailure: @unchecked Sendable {
    enum DiskError: Error { case full }
    private let lock = NSLock()
    private var pending = false
    func failNextSave() { lock.lock(); defer { lock.unlock() }; pending = true }
    func consumeFailure() -> Bool {
        lock.lock(); defer { lock.unlock() }
        defer { pending = false }
        return pending
    }
}

@Suite(.serialized)
@MainActor struct ActivityPlacesTests {
    private let scope = Fixtures.scope
    private let id = "9007199254740993"
    private func result(status: ActivityMapAPI.ActivityPlacesStatus = .complete, places: [ActivityMapAPI.MatchedPlace] = []) -> ActivityMapAPI.ActivityPlaces {
        .init(userID: scope.userID, activityID: id, status: status, streamGeneration: "g1", streamRevision: "1",
              catalogueSnapshotID: "snapshot", matcherVersion: "v1", matchingVersion: nil, resultRevision: nil, places: places)
    }
    private func activity(revision: String = "1") throws -> ActivityMapAPI.Activity {
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON(generation: "g1", revision: revision).utf8))
        return try Fixtures.activity(["id": id, "streams": metadata])
    }
    private func until(_ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(5)
        while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(5)) }
    }
    private func syncedActivity(version: String, empty: Bool = false, userID: String? = nil, status: String = "complete",
                                revision: String = "1") throws -> ActivityMapAPI.Activity {
        let places: [[String: Any]] = empty || status != "complete" ? [] : [["id": "00000000-0000-4000-8000-000000000001", "name": "Summit", "kinds": ["peak"],
            "longitude": 8, "latitude": 46, "elevationM": 2000, "visits": [["distanceM": 100]]]]
        let matches: [String: Any] = ["userId": userID ?? scope.userID, "activityId": id, "status": status,
            "streamGeneration": "g1", "streamRevision": revision, "catalogueSnapshotId": "catalogue", "matcherVersion": "v5",
            "matchingVersion": version, "resultRevision": UUID().uuidString, "places": places]
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON(generation: "g1", revision: revision).utf8))
        return try Fixtures.activity(["id": id, "streams": metadata, "placeMatches": matches])
    }
    private func placesCheckpoint(version: String, cursor: String = "cursor-1") -> SyncCheckpoint {
        var checkpoint = Fixtures.checkpoint
        checkpoint.placesSyncReady = true
        checkpoint.changesCursor = cursor
        checkpoint.freshness = .init(lastSummaryReconciledAt: nil, placeMatchingVersion: version)
        return checkpoint
    }
    @Test func mapOverviewReadsInBatchWithoutRequestsAndTracksZeroVersionAndAccountChanges() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        let original = try syncedActivity(version: version)
        try await storage.apply([.upsertActivity(original), .upsertActivity(try Fixtures.activity(["id": "2"]))],
            checkpoint: placesCheckpoint(version: version), scope: scope)
        let loader = ActivityPlacesLoader()
        await loader.configure(SyncFixtures.session(), storage: storage)
        let owner = UUID()
        loader.demand([], owner: owner, cachedOnly: [id, "2", "missing"])
        let readDeadline = Date().addingTimeInterval(5)
        while loader.overviewLoading, Date() < readDeadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(!loader.overviewLoading)
        #expect(loader.result(id)?.places.count == 1)
        #expect(loader.result("2") == nil)
        loader.focus = .init(activityID: id, placeID: original.placeMatches!.places[0].id)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version, empty: true))],
            checkpoint: placesCheckpoint(version: version, cursor: "overview-zero"), scope: scope)
        let deadline = Date().addingTimeInterval(5)
        while loader.result(id)?.places.isEmpty != true, Date() < deadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(loader.result(id)?.places.isEmpty == true)
        #expect(loader.focus == nil)
        try await storage.apply([], checkpoint: placesCheckpoint(version: String(repeating: "b", count: 64)), scope: scope)
        let invalidationDeadline = Date().addingTimeInterval(5)
        while loader.result(id) != nil, Date() < invalidationDeadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(loader.result(id) == nil)
        await loader.configure(SyncFixtures.session(id: "bob"), storage: storage)
        loader.demand([], owner: owner, cachedOnly: [id])
        let accountDeadline = Date().addingTimeInterval(5)
        while loader.overviewLoading, Date() < accountDeadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(!loader.overviewLoading)
        #expect(loader.overviewResults.isEmpty)
        #expect(loader.result(id) == nil)
        loader.reset()
    }
    @Test func mapOverviewRejectsPlacesSupersededByAStoredSummary() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version))],
            checkpoint: placesCheckpoint(version: version), scope: scope)
        #expect(try await storage.cachedMapPlaces(activityIDs: [id], scope: scope)[id]?.places.count == 1)
        let fence = await storage.streamFence()
        #expect(try await storage.saveStreamSummary(summaryResponse(revision: "2").payload,
            scope: scope, fence: fence) == .stored)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
        #expect(try await storage.cachedMapPlaces(activityIDs: [id], scope: scope).isEmpty)
    }
    private func summaryResponse(revision: String, activityID: String? = nil) throws -> SummarySourceProbe.Response {
        let body = StreamFixtures.envelope(StreamFixtures.summaryJSON(id: activityID ?? id, revision: revision))
        let payload = try ActivityMapAPI.makeDecoder().decode(
            ActivityMapAPI.Envelope<ActivityMapAPI.ActivityCompactStreamSummary>.self, from: body).data
        return .init(payload: payload, statusCode: 200, retryAfter: nil, requestID: "places-regression", body: body)
    }
    @Test(arguments: ["bundle", "manifest"], [false, true])
    func placeOnlyChangesPreserveForegroundSummaryRequests(change: String, refresh: Bool) async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        let original = try syncedActivity(version: version)
        try await storage.apply([.upsertActivity(original)], checkpoint: placesCheckpoint(version: version), scope: scope)
        // An independently observed summary provides a FIFO observer barrier:
        // seeing its later publication proves preceding change events retired.
        let barrierID = "2"
        try await storage.apply([.upsertActivity(try Fixtures.activity(["id": barrierID]))], scope: scope)
        let barrierFence = await storage.streamFence()
        #expect(try await storage.saveStreamSummary(summaryResponse(revision: "1", activityID: barrierID).payload,
            scope: scope, fence: barrierFence) == .stored)
        if refresh {
            let fence = await storage.streamFence()
            #expect(try await storage.saveStreamSummary(summaryResponse(revision: "1").payload,
                scope: scope, fence: fence) == .stored)
        }
        let probe = SummarySourceProbe([], hold: true)
        let loader = StreamSummaryLoader(source: { _ in probe })
        await loader.configure(SyncFixtures.session(), storage: storage)
        defer { loader.reset() }
        await loader.load(activityID: barrierID)
        let request = Task { await loader.load(activityID: id, refresh: refresh) }
        let deadline = Date().addingTimeInterval(5)
        while await probe.calls == 0, Date() < deadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(await probe.calls == 1)
        // This also represents a stored-only summary request already in flight.
        let summaryFence = await storage.streamFence()
        if change == "bundle" {
            try await storage.apply([.upsertActivity(try syncedActivity(version: version, empty: true))],
                checkpoint: placesCheckpoint(version: version, cursor: "replacement"), scope: scope)
            #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.places.isEmpty == true)
        } else {
            try await storage.apply([], checkpoint: placesCheckpoint(version: String(repeating: "b", count: 64)), scope: scope)
            #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
        }
        #expect(await storage.summaryFenceIsCurrent(summaryFence, activityID: id, scope: scope),
            "Matching changes must not invalidate elevation writes")
        let publicationFence = await storage.streamFence()
        #expect(try await storage.saveStreamSummary(summaryResponse(revision: "2", activityID: barrierID).payload,
            scope: scope, fence: publicationFence) == .stored)
        let observerDeadline = Date().addingTimeInterval(5)
        while loader.currentSummary(for: barrierID)?.metadata.revision != "2", Date() < observerDeadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        #expect(loader.currentSummary(for: barrierID)?.metadata.revision == "2")
        await probe.resolve(try summaryResponse(revision: "2"))
        await request.value
        #expect(await probe.calls == 1)
        #expect(loader.currentSummary(for: id)?.metadata.revision == "2",
            "The original foreground load or refresh must finish without new demand")
        #expect(try await storage.cachedStreamSummary(activityID: id, scope: scope)?.metadata.revision == "2")
    }
    @Test(arguments: ["bundle", "manifest"])
    func failedPlaceChangePreservesVisitsAndSummaryFence(change: String) async throws {
        let failure = PlacesSaveFailure()
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true), save: { context in
            if failure.consumeFailure() { throw PlacesSaveFailure.DiskError.full }
            try context.save()
        })
        let version = String(repeating: "a", count: 64)
        let original = try syncedActivity(version: version)
        let checkpoint = placesCheckpoint(version: version)
        try await storage.apply([.upsertActivity(original)], checkpoint: checkpoint, scope: scope)
        let pending = await storage.streamFence()
        let mutations: [StoreMutation] = change == "bundle"
            ? [.upsertActivity(try syncedActivity(version: version, empty: true))] : []
        let replacementVersion = change == "manifest" ? String(repeating: "b", count: 64) : version
        failure.failNextSave()
        await #expect(throws: PlacesSaveFailure.DiskError.self) {
            try await storage.apply(mutations,
                checkpoint: self.placesCheckpoint(version: replacementVersion, cursor: "uncommitted"), scope: self.scope)
        }
        #expect(try await storage.snapshot(scope: scope).checkpoint == checkpoint)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.places.count == 1)
        #expect(await storage.summaryFenceIsCurrent(pending, activityID: id, scope: scope))
        #expect(try await storage.saveStreamSummary(summaryResponse(revision: "2").payload,
            scope: scope, fence: pending) == .stored)
    }
    @Test func syncedVisitsLoadOfflineWithoutRequestsAndZeroReplacementRemovesThem() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        let original = try syncedActivity(version: version)
        try await storage.apply([.upsertActivity(original)], checkpoint: placesCheckpoint(version: version), scope: scope)
        let loader = ActivityPlacesLoader()
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        loader.demand([id], owner: UUID())
        try await until { loader.result(id) != nil }
        #expect(loader.result(id)?.places.count == 1)
        let zero = try syncedActivity(version: version, empty: true)
        try await storage.apply([.upsertActivity(zero)], checkpoint: placesCheckpoint(version: version, cursor: "zero"), scope: scope)
        try await until { loader.result(id)?.places.isEmpty == true }
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.places.isEmpty == true)
        #expect(loader.result(id)?.places.isEmpty == true)
        loader.reset()
    }
    @Test func emptySyncPageInvalidatesGlobalVersion() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        let original = try syncedActivity(version: version)
        try await storage.apply([.upsertActivity(original)], checkpoint: placesCheckpoint(version: version), scope: scope)
        try await storage.apply([], checkpoint: placesCheckpoint(version: String(repeating: "b", count: 64)), scope: scope)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
        #expect(try await storage.snapshot(scope: scope).activities.first?.placeMatches?.places.count == 1)
    }
    @Test func failedSaveRollsBackVisitReplacementAndItsCheckpoint() async throws {
        enum DiskError: Error { case full }
        let container = try LocalStore.makeContainer(inMemory: true)
        let storage = LocalStore(container: container)
        let version = String(repeating: "a", count: 64)
        let checkpoint = placesCheckpoint(version: version)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version))], checkpoint: checkpoint, scope: scope)
        let failing = LocalStore(container: container, save: { _ in throw DiskError.full })
        let zero = try syncedActivity(version: version, empty: true)
        await #expect(throws: DiskError.self) {
            try await failing.apply([.upsertActivity(zero)], checkpoint: self.placesCheckpoint(version: version, cursor: "uncommitted"), scope: self.scope)
        }
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.places.count == 1)
        #expect(try await storage.snapshot(scope: scope).checkpoint == checkpoint)
    }
    @Test func crossAccountSyncedBundleCannotBeSavedOrAcknowledged() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        let wrong = try syncedActivity(version: version, userID: "other")
        await #expect(throws: LocalStore.PlacesSyncError.self) {
            try await storage.apply([.upsertActivity(wrong)], checkpoint: self.placesCheckpoint(version: version), scope: self.scope)
        }
        #expect(try await storage.snapshot(scope: scope).activities.isEmpty)
        #expect(try await storage.snapshot(scope: scope).checkpoint == nil)
    }
    @Test func legacyCacheStagesOnePlaceBootstrapAndKeepsOldDataIfItFails() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let old = try activity()
        _ = try await SyncEngine(source: SyncFixtures.complete([old]), store: storage, scope: scope).run()
        let oldCheckpoint = try #require(await storage.snapshot(scope: scope).checkpoint)
        let oldCursor = try #require(oldCheckpoint.changesCursor)
        #expect(oldCheckpoint.placesSyncReady != true)
        let version = String(repeating: "a", count: 64)
        let freshness = ActivityMapAPI.SyncFreshnessMeta(lastSummaryReconciledAt: nil, placeMatchingVersion: version)
        let failure = ScriptedSyncSource([
            .changes(oldCursor, .success(SyncFixtures.changes(next: oldCursor, freshness: freshness))),
            .bootstrap(.activities, nil, .failure(.transport("offline"))),
        ])
        await #expect(throws: APIClient.RequestError.self) {
            try await SyncEngine(source: failure, store: storage, scope: self.scope).run()
        }
        #expect(try await storage.snapshot(scope: scope).activities == [old])
        #expect(try await storage.snapshot(scope: scope).checkpoint == oldCheckpoint)
        let updated = try syncedActivity(version: version)
        let source = ScriptedSyncSource([
            .changes(oldCursor, .success(SyncFixtures.changes(next: oldCursor, freshness: freshness))),
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([updated], freshness: freshness))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos(freshness: freshness))),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot", freshness: freshness))),
        ])
        let checkpoint = try await SyncEngine(source: source, store: storage, scope: scope).run()
        #expect(checkpoint.placesSyncReady == true)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.places.count == 1)
        #expect(await source.steps.isEmpty)
    }
    @Test func mapPlacesIncludeAllVisibleSelectedRoutesRegardlessOfActiveRouteOrCombine() {
        let store = ActivityStore(activities: (1...100).map { ActivityStoreSelectionTests.activity($0) })
        let picker = RoutePicker()
        picker.apply(ids: Array(1...100), adding: false, request: picker.invalidateQuery(), store: store)
        #expect(picker.candidateIDs.count == 100)
        #expect(store.activeActivityID == nil)
        #expect(store.mapPlacesActivityIDs == Set(1...100))
        picker.showDetail(42, store: store)
        #expect(store.activeActivityID == 42)
        #expect(store.mapPlacesActivityIDs == Set(1...100))
        picker.showDetail(99, store: store)
        #expect(store.activeActivityID == 99)
        #expect(store.mapPlacesActivityIDs == Set(1...100))
        store.toggleActive(99)
        #expect(store.activeActivityID == nil)
        #expect(store.mapPlacesActivityIDs == Set(1...100))
        store.setCombine(true)
        #expect(store.mapPlacesActivityIDs == Set(1...100))
        store.removeFromSelection(3...100)
        #expect(store.mapPlacesActivityIDs == [1, 2])
        store.setCombine(false)
        #expect(store.mapPlacesActivityIDs == [1, 2])
        store.activate(1)
        #expect(store.mapPlacesActivityIDs == [1, 2])
        store.activeSportTypes.remove(.run)
        #expect(store.mapPlacesActivityIDs.isEmpty)
        store.setCombine(true)
        #expect(store.mapPlacesActivityIDs.isEmpty)
        #expect(store.selectedActivityIDs == [1, 2])
        store.clearSelection()
        #expect(store.mapPlacesActivityIDs.isEmpty)
    }
    @Test func pendingBundleStaysPendingUntilSyncDeliversTheBackendResult() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version, status: "pending"))],
            checkpoint: placesCheckpoint(version: version), scope: scope)
        let loader = ActivityPlacesLoader()
        await loader.configure(SyncFixtures.session(), storage: storage)
        let owner = UUID()
        loader.demand([id], owner: owner, cachedOnly: [id])
        try await until { loader.result(id) != nil }
        #expect(loader.result(id)?.status == .pending, "Pending must not read as a completed empty result")
        #expect(try await storage.cachedMapPlaces(activityIDs: [id], scope: scope).isEmpty)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version))],
            checkpoint: placesCheckpoint(version: version, cursor: "matched"), scope: scope)
        try await until { loader.result(id)?.status == .complete }
        #expect(loader.result(id)?.places.count == 1)
        loader.release(owner)
        try await until { loader.result(id) == nil }
        #expect(loader.result(id) == nil)
        loader.reset()
    }
    @Test func sharedDemandReopenAndOfflineRelaunchReuseSynchronizedZero() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version, empty: true))],
            checkpoint: placesCheckpoint(version: version), scope: scope)
        let loader = ActivityPlacesLoader()
        await loader.configure(SyncFixtures.session(), storage: storage)
        let a = UUID(), b = UUID()
        loader.demand([id], owner: a); loader.demand([id], owner: b)
        loader.release(a)
        try await until { loader.result(id) != nil }
        #expect(loader.result(id)?.status == .complete)
        #expect(loader.result(id)?.places.isEmpty == true)
        loader.reset()
        let relaunched = ActivityPlacesLoader()
        await relaunched.configure(SyncFixtures.session(verified: false), storage: storage)
        relaunched.demand([id], owner: UUID())
        try await until { relaunched.result(id) != nil }
        #expect(relaunched.result(id)?.status == .complete)
        relaunched.reset()
    }
    @Test func changedStreamAndDeletionHideSynchronizedVisits() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version))],
            checkpoint: placesCheckpoint(version: version), scope: scope)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.places.count == 1)
        try await storage.apply([.upsertActivity(try activity(revision: "2"))], scope: scope)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version, revision: "2"))], scope: scope)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.places.count == 1)
        try await storage.apply([.deleteActivity(id)], scope: scope)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
    }
    @Test func scopeCleanupRemovesMatchingIdentity() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version))],
            checkpoint: placesCheckpoint(version: version), scope: scope)
        #expect(try await storage.cachedPlacesContext(scope: scope) != nil)
        try await storage.clear(scope: scope)
        #expect(try await storage.cachedPlacesContext(scope: scope) == nil)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
    }
    @Test func diskUpgradeReopenAndAccountIsolation() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // SwiftData may retain SQLite handles beyond the actor lifetime; let the
        // simulator temporary-directory lifecycle clean up this isolated store.
        let url = directory.appending(path: "places.store")
        // Create a genuine pre-places schema before opening the upgraded store.
        do {
            let schema = Schema([StoredActivity.self, StoredPhoto.self, SyncState.self, StoredStreamSummary.self])
            let container = try ModelContainer(for: schema, configurations: [ModelConfiguration(schema: schema, url: url, cloudKitDatabase: .none)])
            let context = ModelContext(container)
            context.insert(try StoredActivity(scope: scope.key, dto: activity()))
            try context.save()
        }
        try await writeDisk(url)
        let reopened = try LocalStore(container: LocalStore.makeContainer(url: url))
        #expect(try await reopened.cachedActivityPlaces(activityID: id, scope: scope)?.status == .complete)
        let other = StoreScope(deployment: scope.deployment, userID: "bob")
        #expect(try await reopened.cachedActivityPlaces(activityID: id, scope: other) == nil)
        try await reopened.clearExcept(scope: other)
        #expect(try await reopened.cachedActivityPlaces(activityID: id, scope: scope) == nil)
    }
    private func writeDisk(_ url: URL) async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(url: url))
        let version = String(repeating: "a", count: 64)
        try await storage.apply([.upsertActivity(try syncedActivity(version: version))],
            checkpoint: placesCheckpoint(version: version), scope: scope)
    }
    @Test func projectionPreservesDistanceOffsetRepeatedVisitsAndStreamAlignment() throws {
        let summary = ActivityMapAPI.StreamSummary(version: 1, basis: .distance, time: nil,
            distance: [100, 200, 300], latlng: nil, altitude: [400, 500, 400], watts: nil, heartrate: nil)
        let profile = try #require(ElevationProfile.make(summary))
        let place = ActivityMapAPI.MatchedPlace(id: "hut", name: "Alpine hut", kinds: [.hut], longitude: 8, latitude: 47,
            elevationM: 9000, visits: [.init(distanceM: 150), .init(distanceM: 250), .init(distanceM: nil), .init(distanceM: 50)])
        let dto = result(places: [place])
        let metadata = try #require(activity().streams)
        let projected = ProfilePlace.project(dto, onto: profile, metadata: metadata)
        #expect(projected.map(\.distance) == [50, 150, 0])
        #expect(projected.map(\.altitude) == [450, 450, 400])
        #expect(Set(projected.map(\.id)).count == 3)
        #expect(ProfilePlace.project(dto, onto: profile, metadata: try #require(activity(revision: "2").streams)).isEmpty)
        let ambiguous = ActivityMapAPI.StreamSummary(version: 1, basis: .distance, time: nil,
            distance: [100, 200, 200, 300], latlng: nil, altitude: [400, 500, 550, 400], watts: nil, heartrate: nil)
        let exact = ActivityMapAPI.MatchedPlace(id: "p", name: "Pass", kinds: [.pass], longitude: 8, latitude: 47,
            elevationM: nil, visits: [.init(distanceM: 200)])
        #expect(ProfilePlace.project(result(places: [exact]), onto: try #require(ElevationProfile.make(ambiguous)), metadata: metadata).isEmpty)
    }
    @Test func endpointVisitsSurviveAveragedSummaryBounds() throws {
        let summary = ActivityMapAPI.StreamSummary(version: 1, basis: .distance, time: nil,
            distance: [10, 90], latlng: nil, altitude: [100, 200], watts: nil, heartrate: nil)
        let profile = try #require(ElevationProfile.make(summary))
        let hut = ActivityMapAPI.MatchedPlace(id: "hut", name: "Endpoint hut", kinds: [.hut], longitude: 8, latitude: 47,
            elevationM: 9999, visits: [.init(distanceM: 0), .init(distanceM: 100)])
        let projected = ProfilePlace.project(result(places: [hut]), onto: profile, metadata: try #require(activity().streams))
        #expect(projected.map(\.distance) == [0, 80])
        #expect(projected.map(\.altitude) == [100, 200])
        #expect(projected.map(\.id) == ["hut:0", "hut:1"])
    }
    @Test func sharedMapPlacesCountRoutesRatherThanVisits() {
        let place = ActivityMapAPI.MatchedPlace(id: "hut", name: "Hut", kinds: [.hut], longitude: 8, latitude: 47, elevationM: nil,
            visits: [.init(distanceM: 10), .init(distanceM: 20)])
        let first = result(places: [place])
        let second = ActivityMapAPI.ActivityPlaces(userID: first.userID, activityID: "2", status: .complete,
            streamGeneration: "g", streamRevision: "1", catalogueSnapshotID: first.catalogueSnapshotID,
            matcherVersion: first.matcherVersion, matchingVersion: nil, resultRevision: nil, places: [place])
        let mapped = DisplayMatchedPlace.aggregate([first, first, second])
        #expect(mapped.count == 1)
        #expect(mapped.first?.activityIDs.count == 2)
    }
}

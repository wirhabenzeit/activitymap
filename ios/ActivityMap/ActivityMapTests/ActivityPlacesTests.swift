import Foundation
import SwiftData
import Testing
@testable import ActivityMap

private actor PlacesProbe: ActivityPlacesSource {
    let dto: ActivityMapAPI.ActivityPlaces
    private(set) var calls = 0
    init(_ dto: ActivityMapAPI.ActivityPlaces) { self.dto = dto }
    func places(activityID: String) async -> ActivityMapAPI.ActivityPlaces { calls += 1; return dto }
}

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
    private func wait(_ loader: ActivityPlacesLoader) async throws {
        let deadline = Date().addingTimeInterval(5)
        while !loader.loading.isEmpty, Date() < deadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(loader.loading.isEmpty)
    }
    private func syncedActivity(version: String, empty: Bool = false, userID: String? = nil) throws -> ActivityMapAPI.Activity {
        let places: [[String: Any]] = empty ? [] : [["id": "00000000-0000-4000-8000-000000000001", "name": "Summit", "kinds": ["peak"],
            "longitude": 8, "latitude": 46, "elevationM": 2000, "visits": [["distanceM": 100]]]]
        let matches: [String: Any] = ["userId": userID ?? scope.userID, "activityId": id, "status": "complete",
            "streamGeneration": "g1", "streamRevision": "1", "catalogueSnapshotId": "catalogue", "matcherVersion": "v5",
            "matchingVersion": version, "resultRevision": UUID().uuidString, "places": places]
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON(generation: "g1", revision: "1").utf8))
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
        let probe = PlacesProbe(result())
        let loader = ActivityPlacesLoader(source: { _ in probe })
        await loader.configure(SyncFixtures.session(), storage: storage)
        let owner = UUID()
        loader.demand([], owner: owner, cachedOnly: [id, "2", "missing"])
        let readDeadline = Date().addingTimeInterval(5)
        while loader.overviewLoading, Date() < readDeadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(!loader.overviewLoading)
        #expect(loader.result(id)?.places.count == 1)
        #expect(loader.result("2") == nil)
        #expect(await probe.calls == 0)
        #expect(loader.loading.isEmpty)
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
        #expect(await probe.calls == 0)
        await loader.configure(SyncFixtures.session(id: "bob"), storage: storage)
        loader.demand([], owner: owner, cachedOnly: [id])
        let accountDeadline = Date().addingTimeInterval(5)
        while loader.overviewLoading, Date() < accountDeadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(!loader.overviewLoading)
        #expect(loader.overviewResults.isEmpty)
        #expect(loader.result(id) == nil)
        #expect(await probe.calls == 0)
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
            #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.dto.places.isEmpty == true)
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
    @Test func sameVersionZeroReplacementFencesOlderDirectPlaceResponse() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        let original = try syncedActivity(version: version)
        try await storage.apply([.upsertActivity(original)], checkpoint: placesCheckpoint(version: version), scope: scope)
        let pending = await storage.streamFence()
        try await storage.apply([.upsertActivity(try syncedActivity(version: version, empty: true))],
            checkpoint: placesCheckpoint(version: version, cursor: "zero"), scope: scope)
        #expect(try await !storage.saveActivityPlaces(original.placeMatches!, scope: scope, fence: pending, now: .now))
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.dto.places.isEmpty == true)
        #expect(await storage.summaryFenceIsCurrent(pending, activityID: id, scope: scope),
            "Replacing places fences only place responses")
    }
    @Test(arguments: ["bundle", "manifest"])
    func failedPlaceChangePreservesBothRequestFences(change: String) async throws {
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
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.dto.places.count == 1)
        #expect(await storage.summaryFenceIsCurrent(pending, activityID: id, scope: scope))
        #expect(try await storage.saveActivityPlaces(original.placeMatches!, scope: scope, fence: pending, now: .now),
            "An uncommitted place change must not reject an earlier place request")
        #expect(try await storage.saveStreamSummary(summaryResponse(revision: "2").payload,
            scope: scope, fence: pending) == .stored)
    }
    @Test func syncedVisitsLoadOfflineWithoutRequestsAndZeroReplacementRemovesThem() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        let original = try syncedActivity(version: version)
        try await storage.apply([.upsertActivity(original)], checkpoint: placesCheckpoint(version: version), scope: scope)
        let probe = PlacesProbe(result())
        let loader = ActivityPlacesLoader(source: { _ in probe })
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        loader.demand([id], owner: UUID())
        try await wait(loader)
        #expect(loader.result(id)?.places.count == 1)
        #expect(await probe.calls == 0)
        let zero = try syncedActivity(version: version, empty: true)
        try await storage.apply([.upsertActivity(zero)], checkpoint: placesCheckpoint(version: version, cursor: "zero"), scope: scope)
        for _ in 0..<20 { await Task.yield() }
        try await wait(loader)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.dto.places.isEmpty == true)
        #expect(loader.result(id)?.places.isEmpty == true)
        #expect(await probe.calls == 0)
        loader.reset()
    }
    @Test func emptySyncPageInvalidatesGlobalVersionAndFencesLateDirectResponses() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let version = String(repeating: "a", count: 64)
        let original = try syncedActivity(version: version)
        try await storage.apply([.upsertActivity(original)], checkpoint: placesCheckpoint(version: version), scope: scope)
        let fence = await storage.streamFence()
        try await storage.apply([], checkpoint: placesCheckpoint(version: String(repeating: "b", count: 64)), scope: scope)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
        #expect(try await !storage.saveActivityPlaces(original.placeMatches!, scope: scope, fence: fence, now: .now))
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
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.dto.places.count == 1)
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
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope)?.dto.places.count == 1)
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
    @Test func chooserDisplaysSavedPlacesWhileOtherRoutesAreStillLoading() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let original = try activity()
        let metadata = try JSONSerialization.jsonObject(with: ActivityMapAPI.makeEncoder().encode(original.streams))
        try await storage.apply([.upsertActivity(original),
            .upsertActivity(try Fixtures.activity(["id": "1", "streams": metadata])),
            .upsertActivity(try Fixtures.activity(["id": "2", "streams": metadata]))], scope: scope)
        let hut = ActivityMapAPI.MatchedPlace(id: "saved-hut", name: "Saved hut", kinds: [.hut],
            longitude: 8, latitude: 47, elevationM: 500, visits: [.init(distanceM: 100)])
        #expect(try await storage.saveActivityPlaces(result(places: [hut]), scope: scope,
            fence: await storage.streamFence(), now: .now))
        let source = GatedPlacesProbe(result())
        let loader = ActivityPlacesLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(), storage: storage)
        loader.demand(["1", "2", id], owner: UUID())
        let deadline = Date().addingTimeInterval(2)
        while loader.result(id) == nil, Date() < deadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(loader.result(id)?.places.map(\.id) == ["saved-hut"],
            "Cached chooser places must not wait behind other routes' network requests")
        loader.reset()
        await source.finish("1"); await source.finish("2"); await source.finish(id)
    }
    @Test func narrowingDemandCancelsUnneededRequestsButPreservesSharedProfileDemand() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let original = try activity()
        let metadata = try JSONSerialization.jsonObject(with: ActivityMapAPI.makeEncoder().encode(original.streams))
        try await storage.apply([.upsertActivity(original),
            .upsertActivity(try Fixtures.activity(["id": "2", "streams": metadata])),
            .upsertActivity(try Fixtures.activity(["id": "3", "streams": metadata]))], scope: scope)
        let source = GatedPlacesProbe(result())
        let loader = ActivityPlacesLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(), storage: storage)
        let mapOwner = UUID(), profileOwner = UUID()
        loader.demand([id, "2", "3"], owner: mapOwner, priority: id)
        loader.demand([id], owner: profileOwner)
        let stop = Date().addingTimeInterval(5)
        while await source.started.count < 2, Date() < stop { try await Task.sleep(for: .milliseconds(5)) }
        #expect(await source.started.count == 2)
        loader.demand([], owner: mapOwner)
        await source.finish("2"); await source.finish(id)
        try await wait(loader)
        #expect(loader.result(id)?.status == .complete)
        #expect(loader.result("2") == nil)
        #expect(await !source.started.contains("3"))
        #expect(try await storage.cachedActivityPlaces(activityID: "2", scope: scope) == nil)
        loader.reset()
    }
    @Test func sharedDemandReopenAndOfflineRelaunchReuseCompletedZero() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try activity())], scope: scope)
        let source = PlacesProbe(result())
        let loader = ActivityPlacesLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(), storage: storage)
        let a = UUID(), b = UUID()
        loader.demand([id], owner: a); loader.demand([id], owner: b)
        loader.release(a)
        try await wait(loader)
        #expect(await source.calls == 1)
        await storage.notifySummaryChange(scope: scope.key, activityIDs: [id], cancelsRequests: false)
        for _ in 0..<5 { await Task.yield() }
        try await wait(loader)
        #expect(await source.calls == 1)
        #expect(loader.result(id)?.status == .complete)
        #expect(loader.result(id)?.places.isEmpty == true)
        loader.release(b); loader.demand([id], owner: a); try await wait(loader)
        #expect(await source.calls == 1)
        loader.reset()
        let relaunched = ActivityPlacesLoader(source: { _ in source })
        await relaunched.configure(SyncFixtures.session(verified: false), storage: storage)
        relaunched.demand([id], owner: UUID()); try await wait(relaunched)
        #expect(relaunched.result(id)?.status == .complete)
        #expect(await source.calls == 1)
        relaunched.reset()
    }
    @Test func changedStreamDeletionAndContextFenceSavedAndLateResults() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try activity())], scope: scope)
        let fence = await storage.streamFence()
        #expect(try await storage.saveActivityPlaces(result(), scope: scope, fence: fence, now: .now))
        try await storage.apply([.upsertActivity(try activity(revision: "2"))], scope: scope)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
        #expect(try await !storage.saveActivityPlaces(result(), scope: scope, fence: fence, now: .now))
        try await storage.apply([.deleteActivity(id)], scope: scope)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
        #expect(try await !storage.saveActivityPlaces(result(), scope: scope, fence: fence, now: .now))
    }
    @Test func observedCatalogueChangeAndScopeCleanupInvalidateSavedData() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try activity()), .upsertActivity(try Fixtures.activity(["id": "2"]))], scope: scope)
        let first = result(); let oldFence = await storage.streamFence()
        #expect(try await storage.saveActivityPlaces(first, scope: scope, fence: oldFence, now: .now))
        let next = ActivityMapAPI.ActivityPlaces(userID: first.userID, activityID: "2", status: .complete,
            streamGeneration: "g1", streamRevision: "1", catalogueSnapshotID: "new-snapshot", matcherVersion: "v2", matchingVersion: nil, resultRevision: nil, places: [])
        let nextFence = await storage.streamFence()
        #expect(try await storage.saveActivityPlaces(next, scope: scope, fence: nextFence, now: .now))
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
        // An older in-flight request cannot restore the retired identity.
        #expect(try await !storage.saveActivityPlaces(first, scope: scope, fence: oldFence, now: .now))
        try await storage.clear(scope: scope)
        #expect(try await storage.cachedPlacesContext(scope: scope) == nil)
    }
    @Test func oldSavedResultsRevalidateOnlineButRemainAvailableOffline() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try activity())], scope: scope)
        let fence = await storage.streamFence()
        #expect(try await storage.saveActivityPlaces(result(), scope: scope, fence: fence, now: .now.addingTimeInterval(-2 * 86400)))
        let source = PlacesProbe(result())
        let offline = ActivityPlacesLoader(source: { _ in source })
        await offline.configure(SyncFixtures.session(verified: false), storage: storage)
        offline.demand([id], owner: UUID()); try await wait(offline)
        #expect(offline.result(id)?.status == .complete)
        #expect(await source.calls == 0)
        offline.reset()
        let online = ActivityPlacesLoader(source: { _ in source })
        await online.configure(SyncFixtures.session(), storage: storage)
        online.demand([id], owner: UUID()); try await wait(online)
        #expect(await source.calls == 1)
        online.demand([id], owner: UUID()); try await wait(online)
        #expect(await source.calls == 1)
        online.reset()
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
        #expect(try await reopened.cachedActivityPlaces(activityID: id, scope: scope)?.dto.status == .complete)
        let other = StoreScope(deployment: scope.deployment, userID: "bob")
        #expect(try await reopened.cachedActivityPlaces(activityID: id, scope: other) == nil)
        try await reopened.clearExcept(scope: other)
        #expect(try await reopened.cachedActivityPlaces(activityID: id, scope: scope) == nil)
    }
    private func writeDisk(_ url: URL) async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(url: url))
        let fence = await storage.streamFence()
        #expect(try await storage.saveActivityPlaces(result(), scope: scope, fence: fence, now: .now))
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
    @Test func requestQueueBoundsConcurrencyAndPrioritizesInspectedActivity() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let original = try activity()
        let metadata = try JSONSerialization.jsonObject(with: ActivityMapAPI.makeEncoder().encode(original.streams))
        for id in ["1", "2", "3"] {
            try await storage.apply([.upsertActivity(try Fixtures.activity(["id": id, "streams": metadata]))], scope: scope)
        }
        let source = GatedPlacesProbe(result())
        let loader = ActivityPlacesLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(), storage: storage)
        loader.demand(["1", "2", "3"], owner: UUID(), priority: "3")
        let stop = Date().addingTimeInterval(5)
        while await source.started.count < 2, Date() < stop { try await Task.sleep(for: .milliseconds(5)) }
        #expect(await source.started.count == 2)
        #expect(await source.started.contains("3"))
        await source.finish("3")
        while await source.started.count < 3, Date() < stop { try await Task.sleep(for: .milliseconds(5)) }
        #expect(await source.started.count == 3)
        await source.finish("1"); await source.finish("2")
        try await wait(loader)
        #expect(loader.results.count == 3)
        loader.reset()
    }
    @Test func sourceConflictRetriesOnceAndThenCachesTheCurrentResult() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try activity())], scope: scope)
        let source = ChangedPlacesProbe(result())
        let loader = ActivityPlacesLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(), storage: storage)
        loader.demand([id], owner: UUID())
        try await wait(loader)
        #expect(await source.calls == 2)
        #expect(loader.result(id)?.status == .complete)
        loader.reset()
    }
    @Test func resetRejectsLateResponseFromSourceIgnoringCancellation() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try activity())], scope: scope)
        let source = GatedPlacesProbe(result())
        let loader = ActivityPlacesLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(), storage: storage)
        loader.demand([id], owner: UUID())
        let deadline = Date().addingTimeInterval(5)
        while await source.started.isEmpty, Date() < deadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(await source.started.count == 1)
        loader.reset()
        await source.finish(id)
        try await Task.sleep(for: .milliseconds(20))
        #expect(loader.results.isEmpty)
        #expect(loader.failures.isEmpty)
        #expect(try await storage.cachedActivityPlaces(activityID: id, scope: scope) == nil)
    }
    private func api() -> (ActivityPlacesAPI, URLSession) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PlacesURLProtocol.self]
        let session = URLSession(configuration: config)
        return (ActivityPlacesAPI(baseURL: scope.deployment, token: "test-bearer", session: session), session)
    }
    @Test func webEndpointDecodesBareResponseAndRetainsBearerHeaders() async throws {
        let body = Data(#"{"userId":"alice","activityId":"9007199254740993","status":"complete","streamGeneration":"g1","streamRevision":"1","catalogueSnapshotId":"snapshot","matcherVersion":"v1","places":[]}"#.utf8)
        PlacesURLProtocol.setHandler { request in
            #expect(request.url?.path == "/api/activities/9007199254740993/places")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-bearer")
            #expect(!request.httpShouldHandleCookies)
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, body)
        }
        let (api, session) = api(); defer { session.invalidateAndCancel() }
        let response = try await api.places(activityID: id)
        #expect(response.activityID == id && response.status == .complete)
        #expect(PlacesURLProtocol.requests.count == 1)
        // Standard v1 calls still require a versioned envelope.
        #expect(throws: APIClient.RequestError.self) {
            try APIClient.decodeResult(data: body, httpResponse: HTTPURLResponse(url: scope.deployment, statusCode: 200, httpVersion: nil, headerFields: nil)!, as: ActivityMapAPI.ActivityPlaces.self)
        }
    }
    @Test func webEndpointRetainsBackoffErrorsAndRejectsWrongActivity() async throws {
        let (api, session) = api(); defer { session.invalidateAndCancel() }
        PlacesURLProtocol.setHandler { request in
            (HTTPURLResponse(url: request.url!, statusCode: 429, httpVersion: nil, headerFields: ["Retry-After": "120"])!, Data())
        }
        do { _ = try await api.places(activityID: id); Issue.record("Expected backoff") }
        catch let error as APIClient.RequestError { #expect(error.facts.retryAfter == 120) }
        let body = try ActivityMapAPI.makeEncoder().encode(result())
        PlacesURLProtocol.setHandler { request in (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, body) }
        await #expect(throws: APIClient.RequestError.self) { try await api.places(activityID: "2") }
        await #expect(throws: APIClient.RequestError.self) { try await api.places(activityID: "1e3") }
        #expect(PlacesURLProtocol.requests.count == 1)
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

private actor GatedPlacesProbe: ActivityPlacesSource {
    private(set) var started: [String] = []
    private var continuations: [String: CheckedContinuation<ActivityMapAPI.ActivityPlaces, Never>] = [:]
    let template: ActivityMapAPI.ActivityPlaces
    init(_ template: ActivityMapAPI.ActivityPlaces) { self.template = template }
    func places(activityID: String) async -> ActivityMapAPI.ActivityPlaces {
        started.append(activityID)
        return await withCheckedContinuation { continuations[activityID] = $0 }
    }
    func finish(_ id: String) {
        let dto = ActivityMapAPI.ActivityPlaces(userID: template.userID, activityID: id, status: .complete,
            streamGeneration: template.streamGeneration, streamRevision: template.streamRevision,
            catalogueSnapshotID: template.catalogueSnapshotID, matcherVersion: template.matcherVersion, matchingVersion: nil, resultRevision: nil,
            places: [])
        continuations.removeValue(forKey: id)?.resume(returning: dto)
    }
}

private actor ChangedPlacesProbe: ActivityPlacesSource {
    let dto: ActivityMapAPI.ActivityPlaces
    private(set) var calls = 0
    init(_ dto: ActivityMapAPI.ActivityPlaces) { self.dto = dto }
    func places(activityID: String) throws -> ActivityMapAPI.ActivityPlaces {
        calls += 1
        if calls == 1 { throw APIClient.RequestError.server(code: "activity_changed", message: "Changed", status: 409, requestID: nil, retryable: true) }
        return dto
    }
}

nonisolated final class PlacesURLProtocol: URLProtocol, @unchecked Sendable {
    final class Box: @unchecked Sendable {
        let lock = NSLock()
        var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
        var requests: [URLRequest] = []
        var holdResponse = false
    }
    static let box = Box()
    static func setHandler(holdResponse: Bool = false, _ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)) {
        box.lock.lock(); defer { box.lock.unlock() }
        box.handler = handler
        box.requests = []
        box.holdResponse = holdResponse
    }
    static var requests: [URLRequest] {
        box.lock.lock(); defer { box.lock.unlock() }; return box.requests
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.box.lock.lock()
        let handler = Self.box.handler
        let holdResponse = Self.box.holdResponse
        Self.box.requests.append(request)
        Self.box.lock.unlock()
        do {
            let (response, data) = try handler!(request)
            if holdResponse { return }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

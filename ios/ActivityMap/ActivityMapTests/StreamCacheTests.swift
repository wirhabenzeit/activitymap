import Foundation
import SwiftData
import Testing
@testable import ActivityMap

@MainActor
struct StreamCacheTests {
    private let id = StreamFixtures.activityID
    private let scope = Fixtures.scope

    private func memoryStore() throws -> LocalStore {
        try LocalStore(container: LocalStore.makeContainer(inMemory: true))
    }

    private func saveRaw(
        _ store: LocalStore, id: String = StreamFixtures.activityID, streams: String = StreamFixtures.sixStreams,
        generation: String = "g1", revision: String = "1", scope: StoreScope = Fixtures.scope,
        fence: StreamFence? = nil
    ) async throws -> StreamCacheWrite {
        let raw = try StreamFixtures.raw(id: id, streams: streams, generation: generation, revision: revision)
        let captured: StreamFence
        if let fence { captured = fence } else { captured = await store.streamFence() }
        return try await store.saveRawStreams(raw.dto, responseBody: raw.body, scope: scope, fence: captured)
    }

    private func saveSummary(
        _ store: LocalStore, id: String = StreamFixtures.activityID, summary: String? = StreamFixtures.distanceSummary,
        generation: String = "g1", revision: String = "1", state: String = "current",
        scope: StoreScope = Fixtures.scope, fence: StreamFence? = nil
    ) async throws -> StreamCacheWrite {
        let dto = try StreamFixtures.summary(id: id, summary: summary, generation: generation, revision: revision, state: state)
        let captured: StreamFence
        if let fence { captured = fence } else { captured = await store.streamFence() }
        return try await store.saveStreamSummary(dto, scope: scope, fence: captured)
    }

    // MARK: - Persistence

    @Test func diskStoreReopensExactRawBytesAndSeparateSummary() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "streams.store")
        try await writeStreamFixture(url: url)

        let store = try LocalStore(container: LocalStore.makeContainer(url: url))
        let raw = try #require(try await store.cachedRawStreams(activityID: id, scope: scope))
        #expect(raw.responseBody == StreamFixtures.rawBody())
        #expect(raw.isCurrent && raw.metadata.revision == "1" && raw.metadata.generation == "g1")
        let streams = try raw.streams()
        #expect(streams.time?.data == [0, 1, 2, 5])
        #expect(streams.distance?.data == [0, 1.5, 3.25, 7.125])
        #expect(streams.latlng?.data == [[47.123456789, 8.2], [47.2, 8.3], [47.3, 8.4]])
        #expect(streams.altitude?.data == [401.2, 402.4, 403.6, 404.8])
        #expect(streams.watts?.data == [210, 0, 305])
        #expect(streams.heartrate?.data == [120, 131, 142, 150])
        #expect(streams.latlng?.resolution == .medium && streams.watts?.seriesType == .time)
        // Metadata the typed DTO does not model survives in the stored bytes.
        let json = try raw.streamsJSON()
        #expect((json["time"] as? [String: Any])?["device_clock"] as? String == "gps")
        let sensor = (json["watts"] as? [String: Any])?["sensor"] as? [String: Any]
        #expect(sensor?["name"] as? String == "crank")

        let summary = try #require(try await store.cachedStreamSummary(activityID: id, scope: scope))
        #expect(summary.isCurrent && summary.summary?.basis == .distance)
        #expect(summary.summary?.latlng?.count == 3 && summary.summary?.watts == nil)
    }

    private func writeStreamFixture(url: URL) async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(url: url))
        #expect(try await saveRaw(store) == .stored)
        #expect(try await saveSummary(store) == .stored)
    }

    @Test func partialRawSetsKeepMissingEmptyAndUnequalStreams() async throws {
        let store = try memoryStore()
        #expect(try await saveRaw(store, streams: StreamFixtures.partialStreams) == .stored)
        let streams = try #require(try await store.cachedRawStreams(activityID: id, scope: scope)).streams()
        #expect(streams.time?.data.count == 5 && streams.distance?.data.count == 2)
        #expect(streams.altitude != nil && streams.altitude?.data == [])
        #expect(streams.watts == nil && streams.heartrate == nil && streams.latlng == nil)

        // A successful empty set is cached as such, not as "not fetched".
        #expect(try await saveRaw(store, id: "2", streams: "{}") == .stored)
        let empty = try #require(try await store.cachedRawStreams(activityID: "2", scope: scope)).streams()
        #expect(empty.time == nil && empty.latlng == nil)
        #expect(try await store.cachedRawStreams(activityID: "3", scope: scope) == nil)
    }

    @Test func summaryStatesStayDistinctAndIndependentOfRaw() async throws {
        let store = try memoryStore()
        #expect(try await saveSummary(store, summary: StreamFixtures.timeSummary) == .stored)
        #expect(try await saveSummary(store, id: "2", summary: StreamFixtures.noAxisSummary) == .stored)
        #expect(try await saveSummary(store, id: "3", summary: nil) == .stored)
        // Not current: nothing to cache, and nothing overwritten.
        #expect(try await saveSummary(store, id: "4", summary: nil, state: "stale") == .notCacheable)
        #expect(try await saveSummary(store, id: "4", summary: nil, state: "not_fetched") == .notCacheable)

        let cached = try await store.cachedStreamSummaries(activityIDs: [id, "2", "3", "4", id], scope: scope)
        #expect(Set(cached.keys) == [id, "2", "3"])
        #expect(cached[id]?.summary?.basis == .time && cached[id]?.summary?.watts == [210, 180, 305])
        #expect(cached["2"]?.summary != nil && cached["2"]?.summary?.basis == nil)
        #expect(cached["3"]?.isCurrent == true && cached["3"]?.summary == nil)

        // A summary without raw data (and vice versa) is a normal state.
        let status = try await store.streamCacheStatus(activityID: id, scope: scope)
        #expect(status.raw == nil && status.summary?.isCurrent == true && status.summaryVersion == 1)
        #expect(try await saveRaw(store, id: "5") == .stored)
        let rawOnly = try await store.streamCacheStatus(activityID: "5", scope: scope)
        #expect(rawOnly.raw?.revision == "1" && rawOnly.summary == nil)
    }

    @Test func summaryVersionChangeReplacesSummaryAndKeepsRaw() async throws {
        let store = try memoryStore()
        #expect(try await saveRaw(store) == .stored)
        #expect(try await saveSummary(store) == .stored)
        let v2 = StreamFixtures.distanceSummary.replacingOccurrences(of: #""version":1"#, with: #""version":2"#)
        #expect(try await saveSummary(store, summary: v2) == .stored)
        let status = try await store.streamCacheStatus(activityID: id, scope: scope)
        #expect(status.summaryVersion == 2 && status.summary?.isCurrent == true)
        #expect(status.raw?.isCurrent == true)
        #expect(try await store.cachedRawStreams(activityID: id, scope: scope)?.responseBody == StreamFixtures.rawBody())
    }

    // MARK: - Sync invalidation

    @Test func syncMetadataInvalidatesOnlyTheAffectedActivity() async throws {
        let store = try memoryStore()
        for activity in [id, "2"] {
            #expect(try await saveRaw(store, id: activity, revision: "5") == .stored)
            #expect(try await saveSummary(store, id: activity, revision: "5") == .stored)
        }
        func current(_ activity: String) async throws -> (Bool?, Bool?) {
            let status = try await store.streamCacheStatus(activityID: activity, scope: scope)
            return (status.raw?.isCurrent, status.summary?.isCurrent)
        }

        // Same or older revision: a delayed sync item must not regress the cache.
        try await store.apply([.upsertActivity(try StreamFixtures.activity(revision: "5"))], scope: scope)
        try await store.apply([.upsertActivity(try StreamFixtures.activity(revision: "4", state: "stale"))], scope: scope)
        #expect(try await current(id) == (true, true))

        // Newer revision of the same generation.
        try await store.apply([.upsertActivity(try StreamFixtures.activity(revision: "6"))], scope: scope)
        #expect(try await current(id) == (false, false))
        #expect(try await current("2") == (true, true))

        // Invalidation of the cached revision, and a generation change.
        try await store.apply([.upsertActivity(try StreamFixtures.activity(id: "2", revision: "5", state: "stale"))], scope: scope)
        #expect(try await current("2") == (false, false))
        #expect(try await saveRaw(store, id: "3", generation: "g1", revision: "9") == .stored)
        try await store.apply([.upsertActivity(try StreamFixtures.activity(id: "3", generation: "g2", revision: "1"))], scope: scope)
        #expect(try await current("3") == (false, nil))

        // Stale entries remain readable offline, flagged as not current.
        let stale = try #require(try await store.cachedStreamSummary(activityID: id, scope: scope))
        #expect(!stale.isCurrent && stale.summary != nil)
        // Invalidation touched only metadata; snapshots stay stream-free.
        #expect(try await store.snapshot(scope: scope).activities.count == 3)
    }

    @Test func directResponseOlderThanCommittedSyncIsStoredAsStale() async throws {
        let store = try memoryStore()
        try await store.apply([.upsertActivity(try StreamFixtures.activity(revision: "3"))], scope: scope)
        #expect(try await saveSummary(store, revision: "2") == .stored)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.isCurrent == false)
        // A response of another generation may be newer than lagging sync.
        #expect(try await saveSummary(store, generation: "g2", revision: "1") == .stored)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.isCurrent == true)
        // Once sync reports that generation, nothing changes.
        try await store.apply([.upsertActivity(try StreamFixtures.activity(generation: "g2", revision: "1"))], scope: scope)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.isCurrent == true)
    }

    // MARK: - Ordering and fencing

    @Test func outOfOrderResponsesNeverRegressTheCache() async throws {
        let store = try memoryStore()
        let earlier = await store.streamFence()
        let later = await store.streamFence()
        #expect(try await saveRaw(store, revision: "2", fence: later) == .stored)
        #expect(try await saveRaw(store, revision: "1", fence: earlier) == .superseded)
        #expect(try await saveSummary(store, revision: "2", fence: later) == .stored)
        #expect(try await saveSummary(store, revision: "1", fence: earlier) == .superseded)
        // Across generations, the later request wins.
        #expect(try await saveSummary(store, generation: "g0", revision: "7", fence: earlier) == .superseded)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.metadata.revision == "2")
        // Numeric, not lexicographic, revision order.
        #expect(try await saveRaw(store, revision: "10") == .stored)
        #expect(try await saveRaw(store, revision: "9") == .superseded)
        #expect(StreamRevision.compare("10", "9") == .orderedDescending)
        #expect(StreamRevision.compare("007", "7") == .orderedSame)
    }

    @Test func tombstoneFencesLateResponsesEvenAfterRecreation() async throws {
        let store = try memoryStore()
        let bob = StoreScope(deployment: scope.deployment, userID: "bob")
        try await store.apply([.upsertActivity(try StreamFixtures.activity())], scope: scope)
        #expect(try await saveRaw(store) == .stored)
        #expect(try await saveSummary(store) == .stored)
        #expect(try await saveSummary(store, scope: bob) == .stored)
        let inFlight = await store.streamFence()

        try await store.apply([.deleteActivity(id)], scope: scope)
        #expect(try await store.cachedRawStreams(activityID: id, scope: scope) == nil)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope) == nil)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: bob) != nil)

        // Recreated with the same ID: the old request still cannot write.
        try await store.apply([.upsertActivity(try StreamFixtures.activity(generation: "g2"))], scope: scope)
        #expect(try await saveRaw(store, fence: inFlight) == .fenced)
        #expect(try await saveSummary(store, fence: inFlight) == .fenced)
        #expect(try await store.streamCacheStatus(activityID: id, scope: scope) == StreamCacheStatus(raw: nil, summary: nil, summaryVersion: nil))
        #expect(try await saveSummary(store, scope: bob, fence: inFlight) == .stored)
        #expect(try await saveSummary(store, generation: "g2") == .stored)
    }

    @Test func syncInvalidationFencesInFlightRequests() async throws {
        let store = try memoryStore()
        #expect(try await saveSummary(store, revision: "1") == .stored)
        let inFlight = await store.streamFence()
        try await store.apply([.upsertActivity(try StreamFixtures.activity(revision: "1", state: "stale"))], scope: scope)
        #expect(try await saveSummary(store, revision: "1", fence: inFlight) == .fenced)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.isCurrent == false)
        #expect(try await saveSummary(store, revision: "2") == .stored)
        try await store.invalidateStreams(activityID: id, scope: scope)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.isCurrent == false)
    }

    @Test func logoutAndAccountTransitionsClearAndFenceStreams() async throws {
        let store = try memoryStore()
        let bob = StoreScope(deployment: scope.deployment, userID: "bob")
        let dev = StoreScope(deployment: URL(string: "http://localhost:3000")!, userID: "alice")
        for target in [scope, bob, dev] {
            #expect(try await saveRaw(store, scope: target) == .stored)
            #expect(try await saveSummary(store, scope: target) == .stored)
        }
        let beforeLogout = await store.streamFence()
        try await store.clear(scope: scope)
        #expect(try await store.cachedRawStreams(activityID: id, scope: scope) == nil)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope) == nil)
        #expect(try await saveRaw(store, scope: scope, fence: beforeLogout) == .fenced)
        #expect(try await store.cachedRawStreams(activityID: id, scope: bob) != nil)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: dev) != nil)

        let beforeTransition = await store.streamFence()
        try await store.clearExcept(scope: bob)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: dev) == nil)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: bob) != nil)
        #expect(try await saveSummary(store, scope: dev, fence: beforeTransition) == .fenced)
        #expect(try await saveSummary(store, scope: dev) == .stored)
    }

    // MARK: - Upgrade

    @Test func existingStoreUpgradesWithoutDataLoss() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "legacy.store")
        let activity = try Fixtures.activity()
        let photo = try Fixtures.photo()
        try writeLegacyStore(url: url, activity: activity, photo: photo)

        let store = try LocalStore(container: LocalStore.makeContainer(url: url))
        let snapshot = try await store.snapshot(scope: scope)
        #expect(snapshot.activities == [activity])
        #expect(snapshot.photos == [photo])
        #expect(snapshot.checkpoint == Fixtures.checkpoint)
        #expect(try await saveSummary(store) == .stored)
    }

    /// The schema as shipped before stream caching, released before reopening.
    private func writeLegacyStore(url: URL, activity: ActivityMapAPI.Activity, photo: ActivityMapAPI.Photo) throws {
        let schema = Schema([StoredActivity.self, StoredPhoto.self, SyncState.self])
        let container = try ModelContainer(
            for: schema, configurations: [ModelConfiguration(schema: schema, url: url, cloudKitDatabase: .none)])
        let context = ModelContext(container)
        context.insert(try StoredActivity(scope: scope.key, dto: activity))
        context.insert(try StoredPhoto(scope: scope.key, dto: photo))
        context.insert(try SyncState(scope: scope.key, checkpoint: Fixtures.checkpoint))
        try context.save()
    }
}

import Foundation
import SwiftData
import Testing
@testable import ActivityMap

@MainActor
struct StreamSummaryCacheTests {
    private let id = StreamFixtures.activityID
    private let scope = Fixtures.scope
    private func store() throws -> LocalStore { try LocalStore(container: LocalStore.makeContainer(inMemory: true)) }
    private func activity(_ id: String = StreamFixtures.activityID, generation: String = "g1", revision: String = "1", state: String = "current") throws -> ActivityMapAPI.Activity {
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON(generation: generation, revision: revision, state: state).utf8))
        return try Fixtures.activity(["id": id, "streams": metadata])
    }
    private func dto(_ id: String = StreamFixtures.activityID, summary: String? = StreamFixtures.distanceSummary,
                     generation: String = "g1", revision: String = "1", state: String = "current") throws -> ActivityMapAPI.ActivityCompactStreamSummary {
        try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.ActivityCompactStreamSummary.self,
            from: Data(StreamFixtures.summaryJSON(id: id, summary: summary, generation: generation, revision: revision, state: state).utf8))
    }
    private func save(_ store: LocalStore, _ dto: ActivityMapAPI.ActivityCompactStreamSummary,
                      fence: StreamFence? = nil, now: Date = .now, scope: StoreScope = Fixtures.scope) async throws -> StreamCacheWrite {
        let ticket = if let fence { fence } else { await store.streamFence() }
        return try await store.saveStreamSummary(dto, scope: scope, fence: ticket, now: now)
    }

    @Test func encodedDiskReopenAndLegacyUpgradePreserveOldOfflineData() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "cache.store")
        let original = try activity()
        let photo = try Fixtures.photo()
        try writeLegacy(url, activity: original, photo: photo)
        let old = Date().addingTimeInterval(-40 * 86400)
        try await writeNew(url, dto: dto(), storedAt: old)
        let reopened = try LocalStore(container: LocalStore.makeContainer(url: url))
        let snapshot = try await reopened.snapshot(scope: scope)
        #expect(snapshot.activities == [original] && snapshot.photos == [photo])
        #expect(snapshot.checkpoint == Fixtures.checkpoint)
        let cached = try #require(try await reopened.cachedStreamSummary(activityID: id, scope: scope))
        #expect(cached.isCurrent && cached.storedAt == old)
        #expect(cached.dto.summary?.distance == "?]iA" && cached.codec == "polyline-v1" && cached.algorithmVersion == 1)
        #expect(cached.hasElevationProfileCandidate)
        let probe = SummarySourceProbe([])
        let loader = StreamSummaryLoader(source: { _ in probe })
        await loader.configure(SyncFixtures.session(verified: false), storage: reopened)
        await loader.load(activityID: id)
        #expect(loader.state(for: id) == .current(cached))
        #expect(await probe.calls == 0)
    }
    private func writeLegacy(_ url: URL, activity: ActivityMapAPI.Activity, photo: ActivityMapAPI.Photo) throws {
        let schema = Schema([StoredActivity.self, StoredPhoto.self, SyncState.self])
        let container = try ModelContainer(for: schema,
            configurations: [ModelConfiguration(schema: schema, url: url, cloudKitDatabase: .none)])
        let context = ModelContext(container)
        context.insert(try StoredActivity(scope: scope.key, dto: activity))
        context.insert(try StoredPhoto(scope: scope.key, dto: photo))
        context.insert(try SyncState(scope: scope.key, checkpoint: Fixtures.checkpoint))
        try context.save()
    }
    private func writeNew(_ url: URL, dto: ActivityMapAPI.ActivityCompactStreamSummary, storedAt: Date) async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(url: url))
        #expect(try await save(store, dto, now: storedAt) == .stored)
    }

    @Test func cacheVersionsMissingAndTimeSummariesStayDistinct() async throws {
        let store = try store()
        for key in [id, "2", "3", "4"] { try await store.apply([.upsertActivity(try activity(key))], scope: scope) }
        #expect(try await save(store, dto()) == .stored)
        let upgraded = StreamFixtures.distanceSummary.replacingOccurrences(of: "\"algorithm_version\":1", with: "\"algorithm_version\":2")
        #expect(try await save(store, dto(summary: upgraded)) == .stored)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.algorithmVersion == 2)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.codec == "polyline-v1")
        #expect(try await save(store, dto("2", summary: StreamFixtures.timeSummary)) == .stored)
        #expect(try await save(store, dto("3", summary: nil)) == .stored)
        #expect(try await save(store, dto("4", summary: StreamFixtures.noAxisSummary)) == .stored)
        let probe = SummarySourceProbe([])
        let loader = StreamSummaryLoader(source: { _ in probe })
        await loader.configure(SyncFixtures.session(verified: false), storage: store)
        for key in [id, "2", "3", "4"] { await loader.load(activityID: key) }
        if case .current(let time) = loader.state(for: "2") { #expect(!time.hasElevationProfileCandidate) }
        else { Issue.record("Time-basis summaries are current data independent of chart readiness") }
        for key in [id, "3", "4"] {
            if case .unavailable = loader.state(for: key) {} else { Issue.record("Expected unavailable \(key)") }
        }
        #expect(await probe.calls == 0)
    }

    @Test func delayedSyncAndRequestsCannotRegressNewerDirectCache() async throws {
        let store = try store()
        try await store.apply([.upsertActivity(try activity(revision: "2"))], scope: scope)
        let earlier = await store.streamFence()
        let later = await store.streamFence()
        #expect(try await save(store, dto(generation: "g2", revision: "5"), fence: later) == .stored)
        #expect(try await save(store, dto(revision: "4"), fence: earlier) == .superseded)
        try await store.apply([.upsertActivity(try activity(generation: "g1", revision: "4", state: "stale"))], scope: scope)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.isCurrent == true)
        try await store.apply([.upsertActivity(try activity(generation: "g3", revision: "5", state: "stale"))], scope: scope)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope)?.isCurrent == false)
        #expect(try await save(store, dto(generation: "g3", revision: "6"), fence: earlier) == .fenced)
        #expect(try await save(store, dto(generation: "g3", revision: "6")) == .stored)
        #expect(StreamRevision.compare("007", "7") == .orderedSame)
        #expect(StreamRevision.compare("10000000000000000000", "99") == .orderedDescending)
    }

    @Test func noExistingSummaryStillFencesSourceInvalidationAndDeleteRecreate() async throws {
        let store = try store()
        try await store.apply([.upsertActivity(try activity())], scope: scope)
        let stale = await store.streamFence()
        try await store.apply([.upsertActivity(try activity(generation: "g2", state: "stale"))], scope: scope)
        #expect(try await save(store, dto(), fence: stale) == .fenced)
        let deleted = await store.streamFence()
        try await store.apply([.deleteActivity(id), .upsertActivity(try activity(generation: "g3"))], scope: scope)
        #expect(try await save(store, dto(), fence: deleted) == .fenced)
        #expect(try await save(store, dto(generation: "g3", revision: "2")) == .stored)
        let scopeTicket = await store.streamFence()
        try await store.clear(scope: scope)
        #expect(try await save(store, dto(), fence: scopeTicket) == .fenced)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope) == nil)
    }

    @Test func failedTransactionDoesNotAdvanceFencesOrInvalidateCache() async throws {
        enum Failure: Error { case save }
        let container = try LocalStore.makeContainer(inMemory: true)
        let good = LocalStore(container: container)
        try await good.apply([.upsertActivity(try activity())], scope: scope)
        #expect(try await save(good, dto()) == .stored)
        let failing = LocalStore(container: container, save: { _ in throw Failure.save })
        let ticket = await failing.streamFence()
        await #expect(throws: Failure.self) {
            try await failing.apply([.upsertActivity(try activity(generation: "g2", state: "stale"))], scope: scope)
        }
        #expect(await failing.summaryFenceIsCurrent(ticket, activityID: id, scope: scope))
        #expect(try await failing.cachedStreamSummary(activityID: id, scope: scope)?.isCurrent == true)
    }

    @Test func logoutDeploymentScopeAndTrueExpiryCleanup() async throws {
        let store = try store()
        let other = StoreScope(deployment: URL(string: "http://localhost:3000")!, userID: scope.userID)
        for target in [scope, other] {
            try await store.apply([.upsertActivity(try activity())], scope: target)
            #expect(try await save(store, dto(), scope: target) == .stored)
        }
        let ticket = await store.streamFence()
        try await store.clearExcept(scope: other)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope) == nil)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: other) != nil)
        #expect(try await save(store, dto(), fence: ticket) == .fenced)
        let expired = SyncSession(user: .init(id: scope.userID, name: "Expired", email: nil, image: nil, athleteID: "42", stravaConnected: true,
            authentication: .init(method: .bearer, sessionExpiresAt: .distantPast)), token: "expired", deployment: scope.deployment, verified: true)
        try await store.apply([.upsertActivity(try activity())], scope: scope)
        #expect(try await save(store, dto()) == .stored)
        let loader = StreamSummaryLoader()
        await loader.configure(expired, storage: store)
        await loader.load(activityID: id)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: scope) == nil)
    }
}

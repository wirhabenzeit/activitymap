import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct SyncEngineTests {
    @Test func bootstrapDrainsBothResourcesThenCatchesConcurrentMutations() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let first = try Fixtures.activity()
        let second = try Fixtures.activity(["id": "2"])
        let changed = try Fixtures.activity(["name": "Changed during bootstrap"])
        let photo = try Fixtures.photo()
        let source = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([first], next: "a2"))),
            .bootstrap(.activities, "a2", .success(SyncFixtures.activities([second], snapshot: nil))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos([photo], next: "p2"))),
            .bootstrap(.photos, "p2", .success(SyncFixtures.photos())),
            .changes("snapshot", .success(SyncFixtures.changes([SyncFixtures.upsert(changed)], next: "delta"))),
            .changes("delta", .success(SyncFixtures.changes())),
        ])
        let checkpoint = try await SyncEngine(source: source, store: store, scope: Fixtures.scope).run()
        let result = try await store.snapshot(scope: Fixtures.scope)
        #expect(Set(result.activities) == Set([changed, second]))
        #expect(result.photos == [photo])
        #expect(checkpoint.bootstrapCursor == "snapshot" && checkpoint.changesCursor == "caught-up")
        #expect(checkpoint.bootstrapComplete && checkpoint.lastSyncAt != nil)
        #expect(await source.steps.isEmpty)
    }

    @Test func interruptedDeltaResumesFromLastCommittedPageAndReplaysSafely() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await store.apply([], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let dto = try Fixtures.activity()
        let source = ScriptedSyncSource([
            .changes("cursor-1", .success(SyncFixtures.changes([SyncFixtures.upsert(dto)], next: "committed"))),
            .changes("committed", .failure(.transport("offline"))),
        ])
        await #expect(throws: APIClient.RequestError.self) {
            try await SyncEngine(source: source, store: store, scope: Fixtures.scope).run()
        }
        let partial = try await store.snapshot(scope: Fixtures.scope)
        #expect(partial.activities == [dto] && partial.checkpoint?.changesCursor == "committed")
        let resumed = ScriptedSyncSource([
            .changes("committed", .success(SyncFixtures.changes([SyncFixtures.upsert(dto)], next: "replayed"))),
            .changes("replayed", .success(SyncFixtures.changes())),
        ])
        _ = try await SyncEngine(source: resumed, store: store, scope: Fixtures.scope).run()
        #expect(try await store.snapshot(scope: Fixtures.scope).activities == [dto])
    }

    @Test func interruptedBootstrapRestartsWithoutGhostRows() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let source = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([try Fixtures.activity()]))),
            .bootstrap(.photos, nil, .failure(.transport("offline"))),
        ])
        await #expect(throws: APIClient.RequestError.self) {
            try await SyncEngine(source: source, store: store, scope: Fixtures.scope).run()
        }
        #expect(try await store.snapshot(scope: Fixtures.scope).checkpoint?.bootstrapComplete == false)
        _ = try await SyncEngine(source: SyncFixtures.complete(), store: store, scope: Fixtures.scope).run()
        #expect(try await store.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func expiredCursorRebootstrapsOnce() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await store.apply([.upsertActivity(try Fixtures.activity())], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .failure(SyncFixtures.rebootstrap)),
            .bootstrap(.activities, nil, .success(SyncFixtures.activities())),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos())),
            .changes("snapshot", .success(SyncFixtures.changes())),
        ])
        _ = try await SyncEngine(source: source, store: store, scope: Fixtures.scope).run()
        #expect(try await store.snapshot(scope: Fixtures.scope).activities.isEmpty)
        #expect(await source.calls == 4)
        let twice = ScriptedSyncSource([
            .changes("caught-up", .failure(SyncFixtures.rebootstrap)),
            .bootstrap(.activities, nil, .failure(SyncFixtures.rebootstrap)),
        ])
        await #expect(throws: APIClient.RequestError.self) {
            try await SyncEngine(source: twice, store: store, scope: Fixtures.scope).run()
        }
        #expect(await twice.calls == 2)
    }

    @Test func stalledDeltaIsRejectedBeforeApplyingOrAdvancing() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await store.apply([], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .success(SyncFixtures.changes([SyncFixtures.upsert(try Fixtures.activity())], next: "cursor-1")))
        ])
        await #expect(throws: SyncEngine.ProtocolError.self) {
            try await SyncEngine(source: source, store: store, scope: Fixtures.scope).run()
        }
        let result = try await store.snapshot(scope: Fixtures.scope)
        #expect(result.activities.isEmpty && result.checkpoint == Fixtures.checkpoint)
    }

    @Test func malformedUpsertDoesNotSkipDataAndAdvanceCursor() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await store.apply([], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let invalid = ActivityMapAPI.SyncChangeItem(sequence: "2", entityType: .activity, operation: .upsert, id: "2", activity: nil, photo: nil)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .success(SyncFixtures.changes([SyncFixtures.upsert(try Fixtures.activity()), invalid])))
        ])
        await #expect(throws: SyncEngine.ProtocolError.self) {
            try await SyncEngine(source: source, store: store, scope: Fixtures.scope).run()
        }
        let result = try await store.snapshot(scope: Fixtures.scope)
        #expect(result.activities.isEmpty && result.checkpoint == Fixtures.checkpoint)
    }

    @Test func bootstrapCannotMintASecondSnapshotOrLoop() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let source = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities(next: "next"))),
            .bootstrap(.activities, "next", .success(SyncFixtures.activities(next: "next", snapshot: nil))),
        ])
        await #expect(throws: SyncEngine.ProtocolError.self) {
            try await SyncEngine(source: source, store: store, scope: Fixtures.scope).run()
        }
        let invalidPhotos = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities())),
            .bootstrap(.photos, nil, .success(.photos(.init(items: [], nextCursor: nil, snapshotCursor: "wrong", retention: SyncFixtures.retention, freshness: SyncFixtures.freshness)))),
        ])
        await #expect(throws: SyncEngine.ProtocolError.self) {
            try await SyncEngine(source: invalidPhotos, store: store, scope: Fixtures.scope).run()
        }
    }

    @Test func tombstonesAndEmptyPageCommitWithTheirCursor() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let activity = try Fixtures.activity()
        try await store.apply([.upsertActivity(activity), .upsertPhoto(try Fixtures.photo())], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let deletion = ActivityMapAPI.SyncChangeItem(sequence: "1", entityType: .activity, operation: .delete, id: activity.id, activity: nil, photo: nil)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .success(SyncFixtures.changes([deletion], next: "deleted"))),
            .changes("deleted", .success(SyncFixtures.changes())),
        ])
        _ = try await SyncEngine(source: source, store: store, scope: Fixtures.scope).run()
        let result = try await store.snapshot(scope: Fixtures.scope)
        #expect(result.activities.isEmpty && result.photos.isEmpty)
        #expect(result.checkpoint?.changesCursor == "caught-up")
    }
}

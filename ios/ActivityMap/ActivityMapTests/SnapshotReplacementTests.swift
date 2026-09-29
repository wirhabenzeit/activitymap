import Foundation
import Testing
@testable import ActivityMap

actor GatedReplacementSource: SyncPageSource {
    let replacement: ActivityMapAPI.Activity
    private var response: CheckedContinuation<ActivityMapAPI.SyncBootstrapPage, any Error>?
    private var requested: CheckedContinuation<Void, Never>?
    private var started = false
    init(replacement: ActivityMapAPI.Activity) { self.replacement = replacement }
    func waitForPhotos() async {
        if started { return }
        await withCheckedContinuation { requested = $0 }
    }
    func failPhotos() {
        response?.resume(throwing: APIClient.RequestError.transport("offline during replacement"))
        response = nil
    }
    func bootstrap(resource: ActivityMapAPI.SyncResource, cursor: String?) async throws -> ActivityMapAPI.SyncBootstrapPage {
        if resource == .activities {
            return .activities(.init(items: [replacement], nextCursor: nil, snapshotCursor: "replacement", retention: .init(retentionDays: 30, cursorValidUntil: Date().addingTimeInterval(86400)), freshness: .init(lastSummaryReconciledAt: nil)))
        }
        return try await withCheckedThrowingContinuation {
            response = $0
            started = true
            requested?.resume()
            requested = nil
        }
    }
    func changes(cursor: String) throws -> ActivityMapAPI.SyncChangesPage {
        throw APIClient.RequestError.server(code: "sync_rebootstrap_required", message: "Expired", status: 409, requestID: nil, retryable: false)
    }
}

@MainActor
struct SnapshotReplacementTests {
    @Test func interruptedReplacementKeepsCachePhotosCursorAndBrowsingContext() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let old = try Fixtures.activity(["id": "1"])
        let photo = try Fixtures.photo(["activity_id": "1"])
        var checkpoint = Fixtures.checkpoint
        checkpoint.lastSyncAt = Date().addingTimeInterval(-30 * 86400)
        checkpoint.freshness = .init(lastSummaryReconciledAt: nil)
        try await storage.apply([.upsertActivity(old), .upsertPhoto(photo)], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = GatedReplacementSource(replacement: try Fixtures.activity(["id": "2"]))
        let store = ActivityStore()
        let controller = SyncController(activities: store, source: { _ in source }, invalidate: { _ in Issue.record("Replacement failure expired sign-in") })
        controller.setSession(SyncFixtures.session(verified: false), storage: storage)
        await controller.refresh()
        store.replaceSelection(with: [1])
        store.inspect(1)
        let scopeRevision = store.mapContext.scopeRevision
        controller.setSession(SyncFixtures.session(), storage: storage)
        await source.waitForPhotos()
        #expect(controller.status == .syncing && store.activities.map(\.id) == [1])
        #expect(BrowsingPresentation(store: store, sync: controller).empty == nil)
        let during = try await storage.snapshot(scope: Fixtures.scope)
        #expect(during.activities == [old] && during.photos == [photo] && during.checkpoint == checkpoint)
        await source.failPhotos()
        await controller.refresh()
        let after = try await storage.snapshot(scope: Fixtures.scope)
        #expect(controller.status == .offline && controller.hasCompletedCache)
        #expect(after.activities == [old] && after.photos == [photo] && after.checkpoint == checkpoint)
        #expect(store.selectedActivityIDs == [1] && store.activeActivityID == 1 && store.inspectedActivityID == 1)
        #expect(store.mapContext.scopeRevision == scopeRevision)
    }

    @Test func completedReplacementRemovesOrphansAndReconcilesSelectionOnce() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let old = try Fixtures.activity(["id": "1"])
        let kept = try Fixtures.activity(["id": "2", "name": "Old name"])
        let changed = try Fixtures.activity(["id": "2", "name": "New name"])
        let orphanPhoto = try Fixtures.photo(["activity_id": "1"])
        let keptPhoto = try Fixtures.photo(["unique_id": "kept", "activity_id": "2"])
        try await storage.apply([.upsertActivity(old), .upsertActivity(kept), .upsertPhoto(orphanPhoto)], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .failure(SyncFixtures.rebootstrap)),
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([changed]))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos([keptPhoto]))),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
        ])
        let store = ActivityStore()
        let controller = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(verified: false), storage: storage)
        await controller.refresh()
        store.replaceSelection(with: [1, 2])
        store.activate(1)
        store.inspect(1)
        controller.setSession(SyncFixtures.session(), storage: storage)
        #expect(store.selectedActivityIDs == [1, 2])
        await controller.refresh()
        let after = try await storage.snapshot(scope: Fixtures.scope)
        #expect(controller.status == .ready && after.activities == [changed] && after.photos == [keptPhoto])
        #expect(after.checkpoint?.changesCursor == "snapshot" && after.checkpoint?.lastSyncAt != nil)
        #expect(store.selectedActivityIDs == [2] && store.activeActivityID == 2 && store.inspectedActivityID == nil)
        #expect(await source.calls == 4)
    }

    @Test func replacementCatchupFailureAndRepeated409KeepLastCompletedSnapshot() async throws {
        for repeated in [false, true] {
            let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
            let old = try Fixtures.activity(["id": "1"])
            let photo = try Fixtures.photo(["activity_id": "1"])
            try await storage.apply([.upsertActivity(old), .upsertPhoto(photo)], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
            let source = ScriptedSyncSource([
                .changes("cursor-1", .failure(SyncFixtures.rebootstrap)),
                .bootstrap(.activities, nil, .success(SyncFixtures.activities([try Fixtures.activity(["id": "2"])]))),
                .bootstrap(.photos, nil, .success(SyncFixtures.photos())),
                .changes("snapshot", .failure(repeated ? SyncFixtures.rebootstrap : .transport("offline"))),
            ])
            await #expect(throws: APIClient.RequestError.self) {
                try await SyncEngine(source: source, store: storage, scope: Fixtures.scope).run()
            }
            let after = try await storage.snapshot(scope: Fixtures.scope)
            #expect(after.activities == [old] && after.photos == [photo] && after.checkpoint == Fixtures.checkpoint)
            #expect(await source.calls == 4, "Recovery never recursively starts another bootstrap")
        }
    }

    @Test func failedReplacementSaveRollsBackActivitiesPhotosAndCheckpoint() async throws {
        enum DiskError: Error { case full }
        let container = try LocalStore.makeContainer(inMemory: true)
        let storage = LocalStore(container: container)
        let old = try Fixtures.activity(["id": "1"])
        let photo = try Fixtures.photo(["activity_id": "1"])
        try await storage.apply([.upsertActivity(old), .upsertPhoto(photo)], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let failing = LocalStore(container: container, save: { _ in throw DiskError.full })
        var advanced = Fixtures.checkpoint
        advanced.changesCursor = "replacement"
        let snapshot = StoreSnapshot(activities: [try Fixtures.activity(["id": "2"])], photos: [], checkpoint: advanced)
        await #expect(throws: DiskError.self) { try await failing.replaceSnapshot(snapshot, scope: Fixtures.scope) }
        let reader = LocalStore(container: container)
        let after = try await reader.snapshot(scope: Fixtures.scope)
        #expect(after.activities == [old] && after.photos == [photo] && after.checkpoint == Fixtures.checkpoint)
        try await storage.apply([], scope: Fixtures.scope)
        #expect(try await reader.snapshot(scope: Fixtures.scope).activities == [old])
    }

    @Test func incompleteReplacementNeverCommits() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let old = try Fixtures.activity(["id": "1"])
        try await storage.apply([.upsertActivity(old)], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let snapshot = StoreSnapshot(activities: [], photos: [], checkpoint: SyncCheckpoint())
        await #expect(throws: LocalStore.ReplacementError.self) { try await storage.replaceSnapshot(snapshot, scope: Fixtures.scope) }
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [old])
    }
}

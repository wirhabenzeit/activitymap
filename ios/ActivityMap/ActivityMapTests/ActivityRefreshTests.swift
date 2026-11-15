import Foundation
import Testing
@testable import ActivityMap

actor ScriptedRefreshSource: ActivityRefreshSource {
    var results: [Result<ActivityMapAPI.ActivityRefreshResult, APIClient.RequestError>]
    private(set) var calls = 0
    init(_ results: [Result<ActivityMapAPI.ActivityRefreshResult, APIClient.RequestError>]) { self.results = results }
    func refresh(activityID: String) throws -> ActivityMapAPI.ActivityRefreshResult {
        calls += 1
        return try results.removeFirst().get()
    }
}

actor GatedRefreshSource: ActivityRefreshSource {
    private var response: CheckedContinuation<ActivityMapAPI.ActivityRefreshResult, Never>?
    private var requested: CheckedContinuation<Void, Never>?
    private var started = false
    private(set) var calls = 0
    func waitForRequest() async {
        if started { return }
        await withCheckedContinuation { requested = $0 }
    }
    func release(_ result: ActivityMapAPI.ActivityRefreshResult) { response?.resume(returning: result); response = nil }
    func refresh(activityID: String) async -> ActivityMapAPI.ActivityRefreshResult {
        calls += 1
        return await withCheckedContinuation {
            response = $0; started = true
            requested?.resume(); requested = nil
        }
    }
}

@MainActor
struct ActivityRefreshTests {
    private func ready(_ original: ActivityMapAPI.Activity, source: any ActivityRefreshSource,
                       photos: [ActivityMapAPI.Photo] = []) async throws -> (SyncController, LocalStore) {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let feed = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([original]))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos(photos))),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot")))
        ])
        let controller = SyncController(activities: ActivityStore(), source: { _ in feed }, refreshSource: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .ready)
        return (controller, storage)
    }

    @Test func refreshCommitsActivityAndReplacesPhotosWithoutAdvancingCursor() async throws {
        let original = try Fixtures.activity()
        let updated = try Fixtures.activity(["name": "Refreshed", "last_updated": "2026-11-15T12:00:00Z"])
        let oldPhoto = try Fixtures.photo(["activity_id": original.id, "unique_id": "old"])
        let photo = try Fixtures.photo(["activity_id": original.id, "unique_id": "new"])
        let source = ScriptedRefreshSource([.success(.init(activity: updated, photos: [photo], photosStatus: .complete, photosError: nil))])
        let (controller, storage) = try await ready(original, source: source, photos: [oldPhoto])
        let before = try await storage.snapshot(scope: Fixtures.scope)
        let id = Int(original.id)!
        let model = controller.editing.refreshModel(activityID: id)
        await model.refresh(activityID: id, using: controller.editing)
        let after = try await storage.snapshot(scope: Fixtures.scope)
        #expect(after.activities == [updated] && after.photos == [photo] && after.checkpoint == before.checkpoint)
        #expect(controller.activities.activity(id: id)?.name == "Refreshed")
        #expect(model.message?.string().contains("up to date") == true && !model.isRefreshing)
    }

    @Test func partialRefreshKeepsPhotosAndRetainsRetryDeadlineAcrossReopening() async throws {
        let original = try Fixtures.activity()
        let oldPhoto = try Fixtures.photo(["activity_id": original.id])
        let updated = try Fixtures.activity(["name": "Details refreshed", "last_updated": "2026-11-15T12:00:00Z"])
        let source = ScriptedRefreshSource([.success(.init(activity: updated, photos: [], photosStatus: .partial,
            photosError: .init(code: "photo_refresh_failed", retryable: true, retryAfterSeconds: 120)))])
        let (controller, storage) = try await ready(original, source: source, photos: [oldPhoto])
        let id = Int(original.id)!
        let model = controller.editing.refreshModel(activityID: id)
        let now = Date()
        await model.refresh(activityID: id, using: controller.editing, now: now)
        #expect(try await storage.snapshot(scope: Fixtures.scope).photos == [oldPhoto])
        #expect(model.retryAt == now.addingTimeInterval(120) && !model.canRefresh(now: now))
        #expect(controller.editing.refreshModel(activityID: id) === model)
        await model.refresh(activityID: id, using: controller.editing, now: now)
        #expect(await source.calls == 1)
        #expect(model.message?.string().contains("Photos could not") == true)
    }

    @Test func rateLimitPreservesDataAndAllowsRetryAfterDeadline() async throws {
        let original = try Fixtures.activity()
        let source = ScriptedRefreshSource([.failure(.rateLimited(retryAfter: 60, requestID: "r")),
            .success(.init(activity: original, photos: [], photosStatus: .complete, photosError: nil))])
        let (controller, storage) = try await ready(original, source: source)
        let model = controller.editing.refreshModel(activityID: Int(original.id)!)
        let now = Date()
        await model.refresh(activityID: Int(original.id)!, using: controller.editing, now: now)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [original])
        #expect(!model.canRefresh(now: now) && model.canRefresh(now: now.addingTimeInterval(60)))
        await model.refresh(activityID: Int(original.id)!, using: controller.editing, now: now.addingTimeInterval(61))
        #expect(await source.calls == 2 && model.retryAt == nil)
    }

    @Test func repeatedRefreshAndEditDoNotSendConcurrentMutations() async throws {
        let original = try Fixtures.activity()
        let source = GatedRefreshSource()
        let (controller, _) = try await ready(original, source: source)
        let id = Int(original.id)!
        let model = controller.editing.refreshModel(activityID: id)
        let work = Task { await model.refresh(activityID: id, using: controller.editing) }
        await source.waitForRequest()
        #expect(model.isRefreshing && controller.editingInProgress)
        await model.refresh(activityID: id, using: controller.editing)
        await #expect(throws: ActivityEditingError.self) {
            try await controller.updateActivity(activityID: id, fields: .init(name: "Duplicate", description: nil, sportType: nil))
        }
        #expect(await source.calls == 1)
        await source.release(.init(activity: original, photos: [], photosStatus: .complete, photosError: nil))
        await work.value
        #expect(!model.isRefreshing && !controller.editingInProgress)
    }

    @Test func logoutFencesLateRefreshAndDiscardsItsRetainedModel() async throws {
        let original = try Fixtures.activity()
        let source = GatedRefreshSource()
        let (controller, storage) = try await ready(original, source: source)
        let id = Int(original.id)!
        let oldModel = controller.editing.refreshModel(activityID: id)
        let work = Task { await oldModel.refresh(activityID: id, using: controller.editing) }
        await source.waitForRequest()
        controller.setSession(nil, storage: storage)
        await controller.refresh()
        await source.release(.init(activity: original, photos: [], photosStatus: .complete, photosError: nil))
        await work.value
        #expect(controller.activities.activities.isEmpty && controller.session == nil)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
        #expect(controller.editing.refreshModel(activityID: id) !== oldModel)
    }

    @Test func mismatchedRefreshCannotAlterLocalLibrary() async throws {
        let original = try Fixtures.activity()
        let other = try Fixtures.activity(["id": "2"])
        let source = ScriptedRefreshSource([.success(.init(activity: other, photos: [], photosStatus: .complete, photosError: nil))])
        let (controller, storage) = try await ready(original, source: source)
        await #expect(throws: ActivityEditingError.self) { try await controller.refreshActivity(activityID: Int(original.id)!) }
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [original])
        #expect(!controller.editingInProgress)
    }
}

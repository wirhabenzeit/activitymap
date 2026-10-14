import Foundation
import Testing
@testable import ActivityMap

actor ScriptedEditSource: ActivityEditSource {
    var results: [Result<ActivityMapAPI.Activity, APIClient.RequestError>]
    private(set) var requests: [ActivityMapAPI.UpdateActivityRequest] = []
    init(_ results: [Result<ActivityMapAPI.Activity, APIClient.RequestError>]) { self.results = results }
    func update(activityID: String, fields: ActivityMapAPI.UpdateActivityRequest) throws -> ActivityMapAPI.Activity {
        requests.append(fields)
        return try results.removeFirst().get()
    }
}

actor GatedEditSource: ActivityEditSource {
    private var continuation: CheckedContinuation<ActivityMapAPI.Activity, Never>?
    private var requested: CheckedContinuation<Void, Never>?
    private var started = false
    func waitForRequest() async {
        if started { return }
        await withCheckedContinuation { requested = $0 }
    }
    func release(_ dto: ActivityMapAPI.Activity) { continuation?.resume(returning: dto); continuation = nil }
    func update(activityID: String, fields: ActivityMapAPI.UpdateActivityRequest) async -> ActivityMapAPI.Activity {
        await withCheckedContinuation {
            continuation = $0; started = true
            requested?.resume(); requested = nil
        }
    }
}

@MainActor
struct ActivityEditingTests {
    private func ready(_ original: ActivityMapAPI.Activity, edits: any ActivityEditSource,
                       storage: LocalStore? = nil, invalidate: @escaping (String) -> Void = { _ in }) async throws -> (SyncController, LocalStore) {
        let storage = try storage ?? LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let source = SyncFixtures.complete([original])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, editSource: { _ in edits }, invalidate: invalidate)
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .ready)
        return (controller, storage)
    }

    @Test func draftSendsOnlyChangedFieldsAndCanClearDescription() throws {
        let original = try StoredModelMapper.activity(Fixtures.activity(["description": "Old prose"]))
        let draft = ActivityEditModel(activity: original)
        #expect(!draft.isDirty && !draft.canSave())
        draft.description = ""
        #expect(draft.canSave())
        #expect(draft.fields.description == "" && draft.fields.name == nil && draft.fields.sportType == nil)
        draft.name = "N" // The API accepts a one-character name.
        draft.sport = .trailRun
        #expect(draft.fields.name == "N" && draft.fields.sportType == .trailRun)
        draft.name = " \n "
        #expect(draft.validationMessage != nil && !draft.canSave())
        draft.name = String(repeating: "😀", count: 128)
        #expect(!draft.canSave()) // Match the API's UTF-16 length limits.
        draft.name = original.name
        draft.description = String(repeating: "x", count: 10_001)
        #expect(!draft.canSave())
        #expect(original.description == "Old prose" && original.sportType == .hike)
    }

    @Test func savedEditReopensOnDiskAndReconcilesFiltersWithoutMovingCursor() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appending(path: "edit.store")
        let storage = try LocalStore(container: LocalStore.makeContainer(url: url))
        let original = try Fixtures.activity(["description": "Old prose", "last_updated": "2026-10-01T12:00:00Z"])
        let saved = try Fixtures.activity(["name": "Evening trail", "description": "", "sport_type": "TrailRun", "last_updated": "2026-10-14T12:00:00Z"])
        let edits = ScriptedEditSource([.success(saved)])
        let (controller, _) = try await ready(original, edits: edits, storage: storage)
        let store = controller.activities
        let id = try #require(Int(original.id))
        store.replaceSelection(with: [id]); store.inspect(id)
        store.activeSportTypes = [.hike]
        let before = try await storage.snapshot(scope: Fixtures.scope)
        let draft = ActivityEditModel(activity: try #require(store.activity(id: id)))
        draft.name = saved.name; draft.description = ""; draft.sport = .trailRun
        await draft.save(using: controller.editing)
        #expect(draft.didSave && draft.errorMessage == nil)
        #expect(store.activity(id: id)?.name == "Evening trail")
        #expect(store.activity(id: id)?.sportType == .trailRun)
        #expect(store.selectedActivityIDs == [id] && store.visibleSelectedActivityIDs.isEmpty)
        #expect(store.activeActivityID == nil && store.inspectedActivityID == nil)
        let after = try await storage.snapshot(scope: Fixtures.scope)
        #expect(after.activities == [saved] && after.checkpoint == before.checkpoint)
        let reopened = try LocalStore(container: LocalStore.makeContainer(url: url))
        #expect(try await reopened.snapshot(scope: Fixtures.scope).activities == [saved])
        // An already-read older feed page must not revert the direct result.
        try await storage.apply([.upsertActivity(original)], scope: Fixtures.scope)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [saved])
        try await storage.replaceSnapshot(before, scope: Fixtures.scope)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [saved])
        let newer = try Fixtures.activity(["name": "Changed elsewhere", "last_updated": "2026-10-14T13:00:00Z"])
        try await storage.apply([.upsertActivity(newer)], scope: Fixtures.scope)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [newer])
    }

    @Test func rateLimitRetainsDraftAndHonorsRetryTime() async throws {
        let original = try Fixtures.activity()
        let saved = try Fixtures.activity(["name": "New name"])
        let edits = ScriptedEditSource([.failure(.rateLimited(retryAfter: 120, requestID: nil)), .success(saved)])
        let (controller, _) = try await ready(original, edits: edits)
        let draft = ActivityEditModel(activity: try StoredModelMapper.activity(original))
        draft.name = "New name"
        let now = Date()
        await draft.save(using: controller.editing, now: now)
        #expect(draft.name == "New name" && !draft.didSave && draft.errorMessage != nil)
        #expect(draft.retryAt == now.addingTimeInterval(120) && !draft.canSave(now: now.addingTimeInterval(119)))
        await draft.save(using: controller.editing, now: now.addingTimeInterval(119))
        #expect(await edits.requests.count == 1)
        await draft.save(using: controller.editing, now: now.addingTimeInterval(120))
        #expect(draft.didSave)
        #expect(await edits.requests.count == 2)
    }

    @Test(arguments: [APIClient.RequestError.serviceUnavailable(retryAfter: 60, requestID: nil),
                     .server(code: "strava_fetch_failed", message: "Strava unavailable", status: 503, requestID: nil, retryable: true, retryAfter: 90)])
    func retryableFailureKeepsDraftAndServerDeadline(error: APIClient.RequestError) async throws {
        let original = try Fixtures.activity()
        let edits = ScriptedEditSource([.failure(error)])
        let (controller, _) = try await ready(original, edits: edits)
        let draft = ActivityEditModel(activity: try StoredModelMapper.activity(original))
        draft.description = "Unsaved draft"
        let now = Date()
        await draft.save(using: controller.editing, now: now)
        #expect(!draft.didSave && draft.description == "Unsaved draft" && draft.retryAt! > now)
        #expect(controller.activities.activities.first?.description == original.description)
    }

    @Test func ambiguousFailureDoesNotOfferAnotherUpstreamWrite() async throws {
        let original = try Fixtures.activity()
        let edits = ScriptedEditSource([.failure(.transport("Connection lost"))])
        let (controller, _) = try await ready(original, edits: edits)
        let draft = ActivityEditModel(activity: try StoredModelMapper.activity(original))
        draft.name = "Kept draft"
        await draft.save(using: controller.editing)
        #expect(draft.requiresReconciliation && !draft.canSave() && draft.name == "Kept draft")
        await draft.save(using: controller.editing)
        #expect(await edits.requests.count == 1)
    }

    @Test func offlineDraftDoesNotSubmit() async throws {
        let original = try Fixtures.activity()
        let edits = ScriptedEditSource([])
        let (controller, storage) = try await ready(original, edits: edits)
        controller.setSession(SyncFixtures.session(verified: false), storage: storage)
        await controller.refresh()
        let draft = ActivityEditModel(activity: try StoredModelMapper.activity(original))
        draft.name = "Offline draft"
        await draft.save(using: controller.editing)
        #expect(controller.editing.unavailableReason != nil && !draft.didSave)
        #expect(await edits.requests.isEmpty)
    }

    @Test func duplicateSavesAreRejectedAndDeletionFencesLateCompletion() async throws {
        let original = try Fixtures.activity()
        let gate = GatedEditSource()
        let (controller, storage) = try await ready(original, edits: gate)
        let id = try #require(Int(original.id))
        let fields = ActivityMapAPI.UpdateActivityRequest(name: "Delayed edit", description: nil, sportType: nil)
        let save = Task { try await controller.updateActivity(activityID: id, fields: fields) }
        await gate.waitForRequest()
        await #expect(throws: ActivityEditingError.self) { try await controller.updateActivity(activityID: id, fields: fields) }
        try await storage.apply([.deleteActivity(original.id)], scope: Fixtures.scope)
        await gate.release(try Fixtures.activity(["name": "Delayed edit"]))
        await #expect(throws: CancellationError.self) { try await save.value }
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func accountChangeFencesLateEdit() async throws {
        let original = try Fixtures.activity()
        let gate = GatedEditSource()
        let (controller, storage) = try await ready(original, edits: gate)
        let save = Task { try await controller.updateActivity(activityID: Int(original.id)!,
            fields: .init(name: "Late edit", description: nil, sportType: nil)) }
        await gate.waitForRequest()
        controller.setSession(nil, storage: storage)
        await controller.refresh()
        await gate.release(try Fixtures.activity(["name": "Late edit"]))
        await #expect(throws: CancellationError.self) { try await save.value }
        #expect(controller.activities.activities.isEmpty)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func unauthorizedSaveClearsScopedDataAndInvalidatesCredential() async throws {
        let original = try Fixtures.activity()
        let edits = ScriptedEditSource([.failure(.server(code: "not_authenticated", message: "Sign in again", status: 401, requestID: nil, retryable: false))])
        var invalidated: String?
        let (controller, storage) = try await ready(original, edits: edits, invalidate: { invalidated = $0 })
        await #expect(throws: APIClient.RequestError.self) {
            try await controller.updateActivity(activityID: Int(original.id)!, fields: .init(name: "New", description: nil, sportType: nil))
        }
        #expect(invalidated == "test-token-alice" && controller.status == .expired)
        #expect(controller.activities.activities.isEmpty)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func localWriteFailureRollsBackAndDoesNotAdvanceCursor() async throws {
        enum DiskError: Error { case full }
        let container = try LocalStore.makeContainer(inMemory: true)
        let storage = LocalStore(container: container)
        let original = try Fixtures.activity()
        try await storage.apply([.upsertActivity(original)], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let failing = LocalStore(container: container, save: { _ in throw DiskError.full })
        let fence = await failing.streamFence()
        await #expect(throws: DiskError.self) {
            try await failing.commitActivityEdit(Fixtures.activity(["name": "Saved upstream"]), scope: Fixtures.scope,
                fence: fence, sessionExpiresAt: Date().addingTimeInterval(3600), now: Date())
        }
        let after = try await storage.snapshot(scope: Fixtures.scope)
        #expect(after.activities == [original] && after.checkpoint == Fixtures.checkpoint)
        try await storage.apply([], scope: Fixtures.scope)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [original])
    }

    @Test func lateResultCannotOverwriteANewAccountWithTheSameActivityID() async throws {
        let original = try Fixtures.activity()
        let nextAccount = try Fixtures.activity(["name": "Other account"])
        let gate = GatedEditSource()
        let alice = SyncFixtures.complete([original]), bob = SyncFixtures.complete([nextAccount])
        let controller = SyncController(activities: ActivityStore(),
            source: { $0.user.id == "bob" ? bob : alice }, editSource: { _ in gate }, invalidate: { _ in })
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        let save = Task { try await controller.updateActivity(activityID: Int(original.id)!,
            fields: .init(name: "Late edit", description: nil, sportType: nil)) }
        await gate.waitForRequest()
        let bobSession = SyncFixtures.session(id: "bob")
        controller.setSession(bobSession, storage: storage)
        await controller.refresh()
        await gate.release(try Fixtures.activity(["name": "Late edit"]))
        await #expect(throws: CancellationError.self) { try await save.value }
        #expect(controller.activities.activities.first?.name == "Other account")
        #expect(try await storage.snapshot(scope: bobSession.scope).activities == [nextAccount])
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func cancelledOrExpiredDirectWriteAndDeleteRecreationAreFenced() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let original = try Fixtures.activity()
        try await storage.apply([.upsertActivity(original)], scope: Fixtures.scope)
        let fence = await storage.streamFence()
        await #expect(throws: CancellationError.self) {
            try await storage.commitActivityEdit(Fixtures.activity(["name": "Expired"]), scope: Fixtures.scope,
                fence: fence, sessionExpiresAt: Date().addingTimeInterval(-1), now: Date())
        }
        try await storage.apply([.deleteActivity(original.id), .upsertActivity(original)], scope: Fixtures.scope)
        await #expect(throws: CancellationError.self) {
            try await storage.commitActivityEdit(Fixtures.activity(["name": "Late"]), scope: Fixtures.scope,
                fence: fence, sessionExpiresAt: Date().addingTimeInterval(3600), now: Date())
        }
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [original])
    }
}

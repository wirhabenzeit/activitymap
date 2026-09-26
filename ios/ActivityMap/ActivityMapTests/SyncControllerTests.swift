import Foundation
import Testing
@testable import ActivityMap

/// A server that delivers its first response even after the request is cancelled.
actor GatedSyncSource: SyncPageSource {
    private var response: CheckedContinuation<ActivityMapAPI.SyncBootstrapPage, Never>?
    private var requested: CheckedContinuation<Void, Never>?
    private var started = false

    func waitForRequest() async {
        if started { return }
        await withCheckedContinuation { requested = $0 }
    }
    func release(_ page: ActivityMapAPI.SyncBootstrapPage) { response?.resume(returning: page); response = nil }
    func bootstrap(resource: ActivityMapAPI.SyncResource, cursor: String?) async -> ActivityMapAPI.SyncBootstrapPage {
        await withCheckedContinuation { continuation in
            response = continuation
            started = true
            requested?.resume()
            requested = nil
        }
    }
    func changes(cursor: String) throws -> ActivityMapAPI.SyncChangesPage { throw ScriptedSyncSource.ScriptError.unexpectedRequest }
}

@MainActor
struct SyncControllerTests {
    @Test func refreshRestartsWorkCancelledBeforeItBegins() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        // Cleanup must still run even if the queued account transition never started.
        try await storage.apply([.upsertActivity(try Fixtures.activity())], scope: Fixtures.scope)
        let source = SyncFixtures.complete([try Fixtures.activity(["id": "2"])])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(id: "bob"), storage: storage)
        controller.pause()
        await controller.refresh()
        #expect(controller.status == .ready && controller.activities.activities.map(\.id) == [2])
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
        #expect(await source.calls == 3)
    }

    @Test func accountSwitchCancelsLateResponsesBeforePurgingPreviousAccount() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let oldSource = GatedSyncSource()
        let newActivity = try Fixtures.activity(["id": "2", "name": "Bob's activity"])
        let newSource = SyncFixtures.complete([newActivity])
        let activities = ActivityStore()
        let controller = SyncController(activities: activities, source: {
            if $0.user.id == "alice" { return oldSource }
            return newSource
        }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await oldSource.waitForRequest()
        controller.setSession(SyncFixtures.session(id: "bob"), storage: storage)
        #expect(activities.activities.isEmpty)
        await oldSource.release(SyncFixtures.activities([try Fixtures.activity()]))
        await controller.refresh()
        #expect(controller.status == .ready)
        #expect(activities.activities.map(\.name) == ["Bob's activity"])
        let old = try await storage.snapshot(scope: Fixtures.scope)
        #expect(old.activities.isEmpty && old.photos.isEmpty && old.checkpoint == nil)
        #expect(await newSource.calls == 3)
    }

    @Test func logoutCancelsSyncAndClearsCacheAndSelection() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let source = GatedSyncSource()
        let activities = ActivityStore(activities: [ActivityStoreSelectionTests.activity(42)])
        activities.replaceSelection(with: [42])
        activities.inspect(42)
        #expect(activities.selectedActivityIDs == [42])
        let controller = SyncController(activities: activities, source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await source.waitForRequest()
        controller.setSession(nil, storage: storage)
        await source.release(SyncFixtures.activities([try Fixtures.activity()]))
        await controller.refresh()
        #expect(controller.status == .signedOut && activities.activities.isEmpty && activities.selectedActivityIDs.isEmpty)
        #expect(activities.activeActivityID == nil && activities.inspectedActivityID == nil)
        #expect(try await storage.snapshot(scope: Fixtures.scope).checkpoint == nil)
    }

    @Test func cachedAccountCanReadOfflineWithoutNetworkOrTokenInvalidation() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity()
        var checkpoint = Fixtures.checkpoint
        checkpoint.lastSyncAt = Date()
        checkpoint.freshness = SyncFixtures.freshness
        try await storage.apply([.upsertActivity(dto)], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([])
        let activities = ActivityStore()
        var invalidated = false
        let controller = SyncController(activities: activities, source: { _ in source }, invalidate: { _ in invalidated = true })
        controller.setSession(SyncFixtures.session(verified: false), storage: storage)
        await controller.refresh()
        #expect(controller.status == .offline && activities.activities.count == 1)
        #expect(await source.calls == 0)
        #expect(!invalidated)
    }

    @Test func oldOfflineDataStaysAndDisconnectedAccountsArePurged() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        var checkpoint = Fixtures.checkpoint
        // The server enforces freshness; the device keeps its copy until it syncs.
        checkpoint.lastSyncAt = Date().addingTimeInterval(-30 * 86400)
        checkpoint.freshness = SyncFixtures.freshness
        try await storage.apply([.upsertActivity(try Fixtures.activity())], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(verified: false), storage: storage)
        await controller.refresh()
        #expect(controller.status == .offline && controller.activities.activities.count == 1)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.count == 1)
        controller.setSession(SyncFixtures.session(connected: false), storage: storage)
        await controller.refresh()
        #expect(controller.status == .disconnected)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func recentSavedDataRemainsAvailableWhenBackendReconciliationIsPending() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        var checkpoint = Fixtures.checkpoint
        checkpoint.lastSyncAt = Date()
        checkpoint.freshness = .init(lastSummaryReconciledAt: nil)
        try await storage.apply([.upsertActivity(try Fixtures.activity())], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(verified: false), storage: storage)
        await controller.refresh()

        #expect(controller.status == .offline && controller.activities.activities.count == 1)
        let snapshot = try await storage.snapshot(scope: Fixtures.scope)
        #expect(snapshot.activities.count == 1 && snapshot.checkpoint != nil)
        #expect(await source.calls == 0)
    }

    @Test func onlineSyncDisplaysDataAndUsesChangesCursorWithoutBackendReconciliation() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity()
        let pending = ActivityMapAPI.SyncFreshnessMeta(lastSummaryReconciledAt: nil)
        let source = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([dto], freshness: pending))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos(freshness: pending))),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot", freshness: pending))),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot", freshness: pending))),
        ])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .ready)
        #expect(controller.activities.activities.map(\.name) == [dto.name])
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [dto])

        await controller.refresh()
        #expect(controller.status == .ready)
        #expect(controller.activities.activities.count == 1)
        #expect(await source.calls == 4) // One later delta poll, no second bootstrap.

        controller.pause()
        #expect(controller.status == .ready && controller.activities.activities.count == 1)
        controller.setSession(SyncFixtures.session(verified: false), storage: storage)
        await controller.refresh()
        #expect(controller.status == .offline && controller.activities.activities.count == 1)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.count == 1)
        #expect(await source.calls == 4)
    }

    @Test func networkFailureKeepsRecentSavedActivitiesVisible() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity()
        var checkpoint = Fixtures.checkpoint
        checkpoint.lastSyncAt = Date()
        checkpoint.freshness = .init(lastSummaryReconciledAt: nil)
        try await storage.apply([.upsertActivity(dto)], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .failure(.transport("offline")))
        ])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()

        #expect(controller.status == .offline)
        #expect(controller.activities.activities.map(\.name) == [dto.name])
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [dto])
    }

    @Test func unauthorizedSyncClearsCacheAndInvalidatesOnlyItsToken() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        var checkpoint = Fixtures.checkpoint
        checkpoint.lastSyncAt = Date()
        checkpoint.freshness = SyncFixtures.freshness
        try await storage.apply([.upsertActivity(try Fixtures.activity())], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .failure(.server(code: "not_authenticated", message: "Expired", status: 401, requestID: "r", retryable: false)))
        ])
        var token: String?
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { token = $0 })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(token == "test-token-alice")
        #expect(controller.status == .signedOut && controller.activities.activities.isEmpty)
        #expect(try await storage.snapshot(scope: Fixtures.scope).checkpoint == nil)
    }

    @Test func rateLimitSuppressesManualRetriesUntilRetryAfter() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let source = ScriptedSyncSource([
            .bootstrap(.activities, nil, .failure(.rateLimited(retryAfter: 120, requestID: "r")))
        ])
        let now = Date()
        let controller = SyncController(activities: ActivityStore(), now: { now }, source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        await controller.refresh()
        #expect(controller.status == .rateLimited(now.addingTimeInterval(120)))
        #expect(await source.calls == 1)
    }

    @Test func transientFailureAfterDeleteReloadsCommittedData() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity()
        var checkpoint = Fixtures.checkpoint
        checkpoint.lastSyncAt = Date()
        checkpoint.freshness = SyncFixtures.freshness
        try await storage.apply([.upsertActivity(dto)], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .success(SyncFixtures.changes([
                .init(sequence: "1", entityType: .activity, operation: .delete, id: dto.id, activity: nil, photo: nil)
            ], next: "deleted"))),
            .changes("deleted", .failure(.transport("offline"))),
        ])
        var invalidated = false
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { _ in invalidated = true })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .offline && controller.activities.activities.isEmpty)
        #expect(controller.checkpoint?.changesCursor == "deleted" && !invalidated)
    }
}

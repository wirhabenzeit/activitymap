import SwiftData
import Foundation
import Combine
@preconcurrency import ConvexMobile
import Testing
@testable import ActivityMap

@MainActor
private final class TestNativeConnection: NativeLibraryConnection {
    let pages: any SyncPageSource
    var events = AsyncThrowingStream<Void, Error>.makeStream(bufferingPolicy: .bufferingNewest(1))
    private(set) var closed = false
    init(_ pages: any SyncPageSource) { self.pages = pages }
    func updates() -> AsyncThrowingStream<Void, Error> {
        events = AsyncThrowingStream<Void, Error>.makeStream(bufferingPolicy: .bufferingNewest(1))
        return events.stream
    }
    func close() { closed = true; events.continuation.finish() }
}

// Combine's subject serializes its callbacks internally. This driver lets the
// test deliver the same background callbacks as the SDK's Rust connection.
nonisolated private final class NativePublisherDriver: @unchecked Sendable {
    let subject = PassthroughSubject<String, ClientError>()
}

nonisolated private struct NamespacedPages: SyncPageSource {
    let base: any SyncPageSource
    let native: Bool
    func accepts(cursor: String) -> Bool { cursor.hasPrefix("ios-convex-v1:") == native }
    func bootstrap(resource: ActivityMapAPI.SyncResource, cursor: String?) async throws -> ActivityMapAPI.SyncBootstrapPage {
        try await base.bootstrap(resource: resource, cursor: cursor)
    }
    func changes(cursor: String) async throws -> ActivityMapAPI.SyncChangesPage { try await base.changes(cursor: cursor) }
}

@MainActor
struct NativeSyncTests {
    @Test func SDKCallbacksCanArriveOffTheMainActor() async throws {
        let driver = NativePublisherDriver()
        let values = ConvexSyncConnection.stream(driver.subject.eraseToAnyPublisher())
        DispatchQueue.global().async {
            driver.subject.send("native background response")
            driver.subject.send(completion: .finished)
        }
        var received: [String] = []
        for try await value in values { received.append(value) }
        #expect(received == ["native background response"])
    }

    @Test func cancellingAWaitingReaderUnsubscribesFromTheSDK() async throws {
        let driver = NativePublisherDriver()
        let cancelled = AsyncStream<Bool>.makeStream()
        let publisher = driver.subject.handleEvents(receiveCancel: { @Sendable in
            cancelled.continuation.yield(true)
            cancelled.continuation.finish()
        }).eraseToAnyPublisher()
        let values = ConvexSyncConnection.stream(publisher)
        let reader = Task { for try await _ in values {} }
        reader.cancel()
        _ = await reader.result
        var unsubscribed = false
        for await event in cancelled.stream { unsubscribed = event }
        #expect(unsubscribed)
    }

    private let cursor = "ios-convex-v1:position-1"
    private func storage() async throws -> LocalStore {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        var checkpoint = Fixtures.checkpoint
        checkpoint.changesCursor = cursor
        try await storage.apply([.upsertActivity(try Fixtures.activity())], checkpoint: checkpoint, scope: Fixtures.scope)
        return storage
    }

    private func eventually(_ condition: () async throws -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while try await !condition() {
            guard ContinuousClock.now < deadline else { Issue.record("Timed out waiting for sync"); return }
            try await Task.sleep(for: .milliseconds(10))
        }
    }

    @Test func nativeChangesAndWakeupsCommitToSwiftDataBeforePublishing() async throws {
        let storage = try await storage()
        let changed = try Fixtures.activity(["name": "Native update", "map_polyline": "full-detailed-route"])
        let source = ScriptedSyncSource([
            .changes(cursor, .success(SyncFixtures.changes([SyncFixtures.upsert(changed)], next: "ios-convex-v1:2"))),
            .changes("ios-convex-v1:2", .success(SyncFixtures.changes(next: "ios-convex-v1:2"))),
            .changes("ios-convex-v1:2", .success(SyncFixtures.changes([
                .init(sequence: "3", entityType: .activity, operation: .delete, id: changed.id, activity: nil, photo: nil)
            ], next: "ios-convex-v1:3"))),
            .changes("ios-convex-v1:3", .success(SyncFixtures.changes(next: "ios-convex-v1:3")))
        ])
        let connection = TestNativeConnection(source)
        let activities = ActivityStore()
        let controller = SyncController(activities: activities, nativeFactory: { _ in connection }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.usesNativeSync && controller.status == .ready)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.first?.mapPolyline == "full-detailed-route")
        #expect(activities.activities.first?.name == "Native update")
        connection.events.continuation.yield(())
        try await eventually { controller.checkpoint?.changesCursor == "ios-convex-v1:3" && controller.status == .ready }
        #expect(activities.activities.isEmpty)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
        controller.pause()
        await controller.summarySync.stopAndWait()
        #expect(connection.closed)
    }

    @Test func notificationDuringRefreshSchedulesAnotherPass() async throws {
        let storage = try await storage()
        let source = GatedChangesSource(unchanged: SyncFixtures.changes(next: cursor))
        let connection = TestNativeConnection(source)
        let controller = SyncController(activities: ActivityStore(), nativeFactory: { _ in connection }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await source.waitForRequest()
        connection.events.continuation.yield(())
        await Task.yield()
        await source.release()
        await controller.refresh()
        try await eventually { await source.calls >= 2 && controller.status == .ready }
        #expect(controller.usesNativeSync)
        controller.pause()
        await controller.summarySync.stopAndWait()
    }

    @Test func nativeStallResumesWithoutEitherTransportBootstrapping() async throws {
        let storage = try await storage()
        let native = ScriptedSyncSource([
            .changes(cursor, .failure(.transport("Timed out"))),
            .changes(cursor, .success(SyncFixtures.changes(next: cursor))),
            .changes(cursor, .success(SyncFixtures.changes(next: cursor))),
        ])
        var connections: [TestNativeConnection] = []
        let http = ScriptedSyncSource([])
        let controller = SyncController(activities: ActivityStore(), source: { _ in http }, nativeFactory: { _ in
            let connection = TestNativeConnection(native); connections.append(connection); return connection
        }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .offline && controller.usesNativeSync)
        #expect(await http.calls == 0)
        #expect(try await storage.syncMetadata(scope: Fixtures.scope).checkpoint?.changesCursor == cursor)
        await controller.refresh()
        #expect(controller.status == .ready)
        controller.pause()
        await controller.refresh()
        #expect(controller.status == .ready && connections.count == 2)
        #expect(await native.calls == 3)
        #expect(await http.calls == 0)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [try Fixtures.activity()])
        controller.pause()
        await controller.summarySync.stopAndWait()
    }

    @Test func switchingTransportBootstrapsInsteadOfReusingTheOtherCursor() async throws {
        let storage = try await storage()
        let http = SyncFixtures.complete()
        let engine = SyncEngine(source: NamespacedPages(base: http, native: false), store: storage, scope: Fixtures.scope)
        let checkpoint = try await engine.run()
        #expect(checkpoint.changesCursor == "snapshot")
        #expect(await http.calls == 3)
        #expect(!SyncAPI(baseURL: Fixtures.scope.deployment, token: "test").accepts(cursor: cursor))
    }

    @Test func signOutFencesInFlightNativeWritesAndClearsSwiftData() async throws {
        let storage = try await storage()
        let source = GatedChangesSource(unchanged: SyncFixtures.changes([SyncFixtures.upsert(try Fixtures.activity())], next: "ios-convex-v1:2"))
        let connection = TestNativeConnection(source)
        let controller = SyncController(activities: ActivityStore(), nativeFactory: { _ in connection }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await source.waitForRequest()
        controller.setSession(nil, storage: storage)
        await source.release()
        await controller.refresh()
        #expect(controller.status == .signedOut && connection.closed)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
        #expect(try await storage.syncMetadata(scope: Fixtures.scope).checkpoint == nil)
    }

    @Test func unverifiedOfflineSessionReadsSwiftDataWithoutConnecting() async throws {
        let storage = try await storage()
        var connected = false
        let controller = SyncController(activities: ActivityStore(), nativeFactory: { _ in connected = true; return nil }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(verified: false), storage: storage)
        await controller.refresh()
        #expect(!connected && controller.status == .offline)
        #expect(controller.activities.activities.count == 1)
    }

    @Test func pauseClosesTheConnectionAndForegroundReconnects() async throws {
        let storage = try await storage()
        let source = ScriptedSyncSource([
            .changes(cursor, .success(SyncFixtures.changes(next: cursor))),
            .changes(cursor, .success(SyncFixtures.changes(next: cursor)))
        ])
        var connections: [TestNativeConnection] = []
        let controller = SyncController(activities: ActivityStore(), nativeFactory: { _ in
            let connection = TestNativeConnection(source)
            connections.append(connection)
            return connection
        }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        controller.pause()
        #expect(connections.count == 1 && connections[0].closed)
        await controller.refresh()
        #expect(connections.count == 2 && controller.usesNativeSync)
        controller.pause()
        await controller.summarySync.stopAndWait()
    }

    @Test func nativeDiscoveryHonorsExplicitSessionRejection() async throws {
        let storage = try await storage()
        let http = ScriptedSyncSource([])
        var invalidated = false
        let controller = SyncController(activities: ActivityStore(), source: { _ in http }, nativeFactory: { _ in
            throw APIClient.RequestError.unexpectedStatus(401)
        }, invalidate: { _ in invalidated = true })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .expired && invalidated)
        #expect(await http.calls == 0)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func nativeDiscoveryHonorsRetryAfterBeforeAnyFallback() async throws {
        let storage = try await storage()
        let http = ScriptedSyncSource([])
        let native = ScriptedSyncSource([.changes(cursor, .success(SyncFixtures.changes(next: cursor)))])
        let connection = TestNativeConnection(native)
        var date = Date()
        var attempts = 0
        let controller = SyncController(activities: ActivityStore(), now: { date }, source: { _ in http }, nativeFactory: { _ in
            attempts += 1
            if attempts == 1 { throw APIClient.RequestError.rateLimited(retryAfter: 120, requestID: nil) }
            return connection
        }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .rateLimited(date.addingTimeInterval(120)))
        #expect(await http.calls == 0)
        #expect(controller.activities.activities.count == 1)
        await controller.refresh()
        #expect(await http.calls == 0)
        date = date.addingTimeInterval(121)
        await controller.refresh()
        #expect(controller.status == .ready && controller.usesNativeSync && attempts == 2)
        #expect(await http.calls == 0)
        controller.pause()
        await controller.summarySync.stopAndWait()
    }

    @Test func failedSubscriptionReconnectsFromTheNativePosition() async throws {
        let storage = try await storage()
        let source = ScriptedSyncSource([
            .changes(cursor, .success(SyncFixtures.changes(next: cursor))),
            .changes(cursor, .success(SyncFixtures.changes(next: cursor)))
        ])
        var connections: [TestNativeConnection] = []
        let http = ScriptedSyncSource([])
        let controller = SyncController(activities: ActivityStore(), source: { _ in http }, nativeFactory: { _ in
            let connection = TestNativeConnection(source); connections.append(connection); return connection
        }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        connections[0].events.continuation.finish(throwing: APIClient.RequestError.transport("Disconnected"))
        try await eventually { controller.status == .offline }
        #expect(connections[0].closed && !controller.usesNativeSync)
        await controller.refresh()
        #expect(controller.status == .ready && controller.checkpoint?.changesCursor == cursor)
        #expect(connections.count == 2 && controller.usesNativeSync)
        #expect(await http.calls == 0)
        controller.pause()
        await controller.summarySync.stopAndWait()
    }

    @Test func transientDiscoveryFailureDoesNotMigrateANativeCache() async throws {
        let storage = try await storage()
        let http = ScriptedSyncSource([])
        let controller = SyncController(activities: ActivityStore(), source: { _ in http }, nativeFactory: { _ in
            throw APIClient.RequestError.transport("Temporary outage")
        }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .offline && controller.checkpoint?.changesCursor == cursor)
        #expect(await http.calls == 0)
        controller.pause()
    }

    @Test func unsupportedDeploymentCanStillFallBackToHTTP() async throws {
        let storage = try await storage()
        let http = SyncFixtures.complete([try Fixtures.activity()])
        let controller = SyncController(activities: ActivityStore(), source: { _ in NamespacedPages(base: http, native: false) },
            nativeFactory: { _ in throw NativeSyncCapabilityError.unavailable }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .ready && controller.checkpoint?.changesCursor == "snapshot")
        controller.pause()
        await controller.summarySync.stopAndWait()
    }

    @Test func cacheReadFailureConsumesTheWakeupWithoutSpinning() async throws {
        let container = try LocalStore.makeContainer(inMemory: true)
        let storage = LocalStore(container: container)
        var checkpoint = Fixtures.checkpoint
        checkpoint.changesCursor = cursor
        try await storage.apply([.upsertActivity(try Fixtures.activity())], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([.changes(cursor, .success(SyncFixtures.changes(next: cursor)))])
        let connection = TestNativeConnection(source)
        var clockReads = 0
        let controller = SyncController(activities: ActivityStore(), now: { clockReads += 1; return Date() },
            nativeFactory: { _ in connection }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        let context = ModelContext(container)
        let state = try #require(context.fetch(FetchDescriptor<SyncState>()).first)
        state.payload = Data("corrupt checkpoint".utf8)
        try context.save()
        let before = clockReads
        connection.events.continuation.yield(())
        try await eventually { if case .failed = controller.status { return true }; return false }
        try await Task.sleep(for: .milliseconds(100))
        #expect(clockReads - before < 10)
        #expect(await source.calls == 1)
        controller.pause()
        await controller.summarySync.stopAndWait()
    }

    @Test func profileChangesKeepTheSDKConnection() async throws {
        let storage = try await storage()
        let source = ScriptedSyncSource([
            .changes(cursor, .success(SyncFixtures.changes(next: cursor))),
            .changes(cursor, .success(SyncFixtures.changes(next: cursor)))
        ])
        let connection = TestNativeConnection(source)
        var connected = 0
        let controller = SyncController(activities: ActivityStore(), nativeFactory: { _ in connected += 1; return connection }, invalidate: { _ in })
        let initial = SyncFixtures.session()
        controller.setSession(initial, storage: storage)
        await controller.refresh()
        let user = initial.user
        let renamed = ActivityMapAPI.CurrentUser(id: user.id, name: "Renamed", email: user.email, image: user.image,
            athleteID: user.athleteID, stravaConnected: user.stravaConnected, stravaPermissions: user.stravaPermissions,
            authentication: user.authentication)
        controller.setSession(SyncSession(user: renamed, token: initial.token, deployment: initial.deployment, verified: true), storage: storage)
        await controller.refresh()
        #expect(controller.status == .ready && connected == 1 && !connection.closed)
        controller.pause()
        await controller.summarySync.stopAndWait()
    }

    @Test func notificationWaitsForEditCompletionWithoutPolling() async throws {
        let storage = try await storage()
        let source = ScriptedSyncSource([
            .changes(cursor, .success(SyncFixtures.changes(next: cursor))),
            .changes(cursor, .success(SyncFixtures.changes(next: cursor)))
        ])
        let connection = TestNativeConnection(source)
        let edit = GatedEditSource()
        var clockReads = 0
        let controller = SyncController(activities: ActivityStore(), now: { clockReads += 1; return Date() },
            nativeFactory: { _ in connection }, editSource: { _ in edit }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        let dto = try Fixtures.activity(["name": "Saved edit"])
        let save = Task { try await controller.updateActivity(activityID: Int(dto.id)!, fields: .init(name: "Saved edit", description: nil, sportType: nil)) }
        await edit.waitForRequest()
        connection.events.continuation.yield(())
        let before = clockReads
        try await Task.sleep(for: .milliseconds(250))
        #expect(await source.calls == 1 && clockReads == before)
        await edit.release(dto)
        try await save.value
        try await eventually { await source.calls == 2 && controller.status == .ready }
        controller.pause()
        await controller.summarySync.stopAndWait()
    }

    @Test func pageSlowerThanEightSecondsStillCompletesNatively() async throws {
        let publisher = Just("slow page").setFailureType(to: ClientError.self)
            .delay(for: .seconds(8.1), scheduler: DispatchQueue(label: "slow-native-page-test")).eraseToAnyPublisher()
        #expect(try await ConvexSyncConnection.first(publisher) == "slow page")
    }

    @Test func closeCancelsPendingSubscriptionsAndReleasesTheSDK() async throws {
        var client: ConvexClientWithAuth<ConvexTokenProvider.Token>? = ConvexClientWithAuth(
            deploymentUrl: "https://example.convex.cloud", authProvider: ConvexTokenProvider(session: SyncFixtures.session()))
        weak var released = client
        let connection = ConvexSyncConnection(client: client!)
        client = nil
        let driver = NativePublisherDriver()
        let cancelled = AsyncStream<Bool>.makeStream()
        let publisher = driver.subject.handleEvents(receiveCancel: { @Sendable in
            cancelled.continuation.yield(true); cancelled.continuation.finish()
        }).eraseToAnyPublisher()
        let values = ConvexSyncConnection.stream(publisher, subscriptions: connection.subscriptions)
        let reader = Task { for try await _ in values {} }
        connection.close()
        await connection.closeAndWait()
        _ = await reader.result
        var unsubscribed = false
        for await event in cancelled.stream { unsubscribed = event }
        #expect(unsubscribed && released == nil)
    }
    @Test func matchingVersionUpdateInvalidatesPlacesWithoutDownloadingRoutesAgain() async throws {
        let storage = try await storage()
        var checkpoint = Fixtures.checkpoint
        checkpoint.changesCursor = cursor
        checkpoint.placesSyncReady = true
        checkpoint.freshness = .init(lastSummaryReconciledAt: nil, placeMatchingVersion: String(repeating: "a", count: 64))
        try await storage.apply([], checkpoint: checkpoint, scope: Fixtures.scope)
        let freshness = ActivityMapAPI.SyncFreshnessMeta(lastSummaryReconciledAt: Date(timeIntervalSince1970: 1_700_000_000),
            placeMatchingVersion: String(repeating: "b", count: 64))
        let source = ScriptedSyncSource([.changes(cursor, .success(SyncFixtures.changes(next: cursor, freshness: freshness)))])
        let result = try await SyncEngine(source: source, store: storage, scope: Fixtures.scope).run()
        #expect(result.freshness == freshness)
        #expect(await source.calls == 1)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities == [try Fixtures.activity()])
    }

}

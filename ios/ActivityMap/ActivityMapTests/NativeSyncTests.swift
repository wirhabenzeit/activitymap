import Foundation
import Combine
@preconcurrency import ConvexMobile
import Testing
@testable import ActivityMap

@MainActor
private final class TestNativeConnection: NativeLibraryConnection {
    let pages: any SyncPageSource
    let events = AsyncThrowingStream<Void, Error>.makeStream(bufferingPolicy: .bufferingNewest(1))
    private(set) var closed = false
    init(_ pages: any SyncPageSource) { self.pages = pages }
    func updates() -> AsyncThrowingStream<Void, Error> { events.stream }
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

    @Test func failedNativeAndHTTPReplacementPreserveTheCompletedLibrary() async throws {
        let storage = try await storage()
        let native = ScriptedSyncSource([.changes(cursor, .failure(.transport("Offline")))])
        let connection = TestNativeConnection(native)
        let replacement = try Fixtures.activity(["name": "Uncommitted replacement"])
        let http = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([replacement]))),
            .bootstrap(.photos, nil, .failure(.transport("Offline")))
        ])
        let controller = SyncController(activities: ActivityStore(),
            source: { _ in NamespacedPages(base: http, native: false) }, nativeFactory: { _ in connection }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .offline && !controller.usesNativeSync && connection.closed)
        let snapshot = try await storage.snapshot(scope: Fixtures.scope)
        #expect(snapshot.activities == [try Fixtures.activity()])
        #expect(snapshot.checkpoint?.changesCursor == cursor)
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
        let date = Date()
        let controller = SyncController(activities: ActivityStore(), now: { date }, source: { _ in http }, nativeFactory: { _ in
            throw APIClient.RequestError.rateLimited(retryAfter: 120, requestID: nil)
        }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .rateLimited(date.addingTimeInterval(120)))
        #expect(await http.calls == 0)
        #expect(controller.activities.activities.count == 1)
        await controller.refresh()
        #expect(await http.calls == 0)
    }

    @Test func failedSubscriptionHandsTheWriterToHTTP() async throws {
        let storage = try await storage()
        let source = ScriptedSyncSource([.changes(cursor, .success(SyncFixtures.changes(next: cursor)))])
        let connection = TestNativeConnection(source)
        let replacement = try Fixtures.activity(["name": "HTTP recovery"])
        let http = SyncFixtures.complete([replacement])
        let controller = SyncController(activities: ActivityStore(), source: { _ in NamespacedPages(base: http, native: false) },
            nativeFactory: { _ in connection }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        connection.events.continuation.finish(throwing: APIClient.RequestError.transport("Disconnected"))
        try await eventually { controller.checkpoint?.changesCursor == "snapshot" && controller.status == .ready }
        #expect(!controller.usesNativeSync && connection.closed)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.first?.name == "HTTP recovery")
        controller.pause()
        await controller.summarySync.stopAndWait()
    }
}

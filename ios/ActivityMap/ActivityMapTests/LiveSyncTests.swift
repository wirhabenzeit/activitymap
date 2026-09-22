import Foundation
import Testing
@testable import ActivityMap

/// Opt-in proof against the actual local Next.js handlers and Docker database.
/// Run with scripts/verify-ios-sync-local.mjs; CI uses deterministic fixtures.
@MainActor
struct LiveSyncTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["ACTIVITYMAP_SYNC_TEST_TOKEN"] != nil))
    func localServerBootstrapDeltaAndDiskReload() async throws {
        let environment = ProcessInfo.processInfo.environment
        let token = try #require(environment["ACTIVITYMAP_SYNC_TEST_TOKEN"])
        let baseURL = URL(string: "http://localhost:3000")!
        let user = try await APIClient.get("/api/v1/me", bearerToken: token, baseURL: baseURL, as: ActivityMapAPI.CurrentUser.self)
        let scope = StoreScope(deployment: baseURL, userID: user.id)
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "live-sync.store")
        let store = try LocalStore(container: LocalStore.makeContainer(url: url))
        let engine = SyncEngine(source: SyncAPI(baseURL: baseURL, token: token), store: store, scope: scope)
        let bootstrap = try await engine.run()
        #expect(bootstrap.bootstrapComplete && bootstrap.lastSyncAt != nil)
        let first = try await store.snapshot(scope: scope)
        #expect(first.activities.count == Int(environment["ACTIVITYMAP_SYNC_EXPECTED_ACTIVITIES"]!))
        #expect(first.photos.count == Int(environment["ACTIVITYMAP_SYNC_EXPECTED_PHOTOS"]!))
        _ = try await engine.run() // A second pass must use the committed delta cursor.
        let reopened = try LocalStore(container: LocalStore.makeContainer(url: url))
        let persisted = try await reopened.snapshot(scope: scope)
        #expect(persisted.activities == first.activities && persisted.photos == first.photos)
        let viewStore = ActivityStore()
        try await viewStore.load(from: reopened, scope: scope)
        #expect(viewStore.activities.count == first.activities.count)
        let controller = SyncController(activities: viewStore, invalidate: { _ in Issue.record("Local session unexpectedly invalidated") })
        controller.setSession(.init(user: user, token: token, deployment: baseURL, verified: true), storage: reopened)
        await controller.refresh()
        #expect(controller.status == .ready && viewStore.activities.count == first.activities.count)
        let offlineViewStore = ActivityStore()
        let offline = SyncController(activities: offlineViewStore, invalidate: { _ in Issue.record("Offline session was invalidated") })
        offline.setSession(.init(user: user, token: token, deployment: baseURL, verified: false), storage: reopened)
        await offline.refresh()
        #expect(offline.status == .offline && offlineViewStore.activities.count == first.activities.count)
        print("LOCAL_SYNC_PROOF_PASSED activities=\(first.activities.count) photos=\(first.photos.count)")
    }
}

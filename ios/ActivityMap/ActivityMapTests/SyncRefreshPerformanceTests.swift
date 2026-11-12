import Foundation
import Testing
@testable import ActivityMap

/// Network-free measurement of the actual persistence and refresh path.
/// Uses a library comparable in size to the retained production library.
@MainActor
struct SyncRefreshPerformanceTests {
    @Test
    func cachedRefresh() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = try LocalStore(container: LocalStore.makeContainer(url: directory.appending(path: "benchmark.store")))
        let mutations = try (1...4602).map { id in
            StoreMutation.upsertActivity(try Fixtures.activity([
                "id": String(id), "map_polyline": String(repeating: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", count: 100),
            ]))
        }
        try await storage.apply(mutations, checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let source = EmptyRefreshSource()
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .ready)
        for _ in 0..<3 {
            let clock = ContinuousClock()
            let start = clock.now
            await controller.refresh()
            #expect(controller.status == .ready && controller.activities.activities.count == 4602)
            print("SYNC_REFRESH_BENCHMARK activities=4602 duration=\(start.duration(to: clock.now))")
        }
        controller.pause()
        await controller.summarySync.stopAndWait()
    }
}

private nonisolated struct EmptyRefreshSource: SyncPageSource {
    func bootstrap(resource: ActivityMapAPI.SyncResource, cursor: String?) throws -> ActivityMapAPI.SyncBootstrapPage {
        throw ScriptedSyncSource.ScriptError.unexpectedRequest
    }
    func changes(cursor: String) async -> ActivityMapAPI.SyncChangesPage {
        await SyncFixtures.changes(next: cursor)
    }
}

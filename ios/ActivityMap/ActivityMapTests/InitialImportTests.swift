import Foundation
import Testing
@testable import ActivityMap

actor ScriptedInitialImport: InitialImportSource {
    var initial: ActivityMapAPI.InitialImport
    var pages: [ActivityMapAPI.InitialImport]
    private(set) var advances = 0
    private var gate: CheckedContinuation<Void, Never>?
    private var requested: CheckedContinuation<Void, Never>?
    private var gated = false
    private let gateAt: Int

    init(initial: ActivityMapAPI.InitialImport, pages: [ActivityMapAPI.InitialImport], gated: Bool = false, gateAt: Int = 1) {
        self.initial = initial; self.pages = pages; self.gated = gated; self.gateAt = gateAt
    }
    func read() -> ActivityMapAPI.InitialImport { initial }
    func setProgress(_ progress: ActivityMapAPI.InitialImport) { initial = progress }
    func advance() async -> ActivityMapAPI.InitialImport {
        advances += 1
        if gated && advances == gateAt {
            await withCheckedContinuation { continuation in
                gate = continuation; requested?.resume(); requested = nil
            }
        }
        return pages.removeFirst()
    }
    func waitForRequest() async {
        if advances >= gateAt { return }
        await withCheckedContinuation { requested = $0 }
    }
    func release() { gated = false; gate?.resume(); gate = nil }
}

@MainActor struct InitialImportTests {
    private func progress(_ phase: ActivityMapAPI.InitialImportPhase, _ count: Int = 0,
                          retryAt: Date? = nil) -> ActivityMapAPI.InitialImport {
        .init(phase: phase, importedCount: count, target: 200, historyComplete: phase == .empty,
              retryAt: retryAt, message: nil)
    }

    @Test func firstBatchIsUsableWhileSecondBatchIsStillPending() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let first = try Fixtures.activity(["id": "1"])
        let second = try Fixtures.activity(["id": "2"])
        let importer = ScriptedInitialImport(initial: progress(.notStarted),
                                             pages: [progress(.importing, 50), progress(.ready, 100)], gated: true, gateAt: 2)
        let source = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([first]))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos())),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
            .changes("snapshot", .success(SyncFixtures.changes([SyncFixtures.upsert(second)], next: "delta"))),
            .changes("delta", .success(SyncFixtures.changes(next: "delta"))),
            .changes("delta", .success(SyncFixtures.changes(next: "delta"))),
        ])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source },
                                        initialImportSource: { _ in importer }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await importer.waitForRequest()
        #expect(controller.initialImport?.importedCount == 50)
        #expect(controller.activities.activities.map(\.id) == [1])
        #expect(controller.hasCompletedCache)
        await importer.release()
        await controller.refresh()
        #expect(controller.activities.activities.map(\.id).sorted() == [1, 2])
        #expect(controller.initialImport?.phase == .ready && controller.status == .ready)
        #expect(await importer.advances == 2)
    }

    @Test func retryDeadlinePreservesUsableActivitiesWithoutAnotherImport() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let source = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([try Fixtures.activity()]))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos())),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
        ])
        let importer = ScriptedInitialImport(initial: progress(.paused, 50, retryAt: Date().addingTimeInterval(3600)), pages: [])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source },
                                        initialImportSource: { _ in importer }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        await controller.refresh()
        #expect(controller.activities.activities.count == 1)
        #expect(!controller.canRetryInitialImport)
        #expect(await importer.advances == 0)
    }

    @Test func logoutDiscardsLateImportProgress() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let source = ScriptedSyncSource([])
        let importer = ScriptedInitialImport(initial: progress(.notStarted), pages: [progress(.ready, 50)], gated: true)
        let controller = SyncController(activities: ActivityStore(), source: { _ in source },
                                        initialImportSource: { _ in importer }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await importer.waitForRequest()
        controller.setSession(nil, storage: storage)
        await importer.release()
        await controller.refresh()
        #expect(controller.initialImport == nil && controller.activities.activities.isEmpty)
        #expect(controller.status == .signedOut)
        #expect(await source.calls == 0)
    }

    @Test func returningAccountSkipsOnboarding() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let source = SyncFixtures.complete()
        let importer = ScriptedInitialImport(initial: progress(.ready, 200), pages: [])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source },
                                        initialImportSource: { _ in importer }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.initialImport == nil && controller.status == .ready)
        #expect(await importer.advances == 0)
    }

    @Test func anotherClientCanFinishAPreviouslyVisibleImport() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let source = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([try Fixtures.activity()]))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos())),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
        ])
        let importer = ScriptedInitialImport(initial: progress(.importing, 50), pages: [progress(.failed, 50)])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source },
                                        initialImportSource: { _ in importer }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.initialImport?.phase == .failed)
        await importer.setProgress(progress(.ready, 200))
        await controller.refresh()
        #expect(controller.initialImport?.phase == .ready)
        #expect(await importer.advances == 1)
    }
}

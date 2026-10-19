import Foundation
import Testing
@testable import ActivityMap

@MainActor struct StravaImportTests {
    private func status(_ state: ActivityMapAPI.StravaImportStatus = .idle, retry: Date? = nil) -> ActivityMapAPI.StravaImport {
        .init(available: true, runID: state == .idle ? nil : "run", status: state, reason: nil,
              startedAt: nil, finishedAt: nil, retryAt: retry, summaries: 200, details: 5, photos: 3)
    }
    @Test func startIsDeduplicatedAndServerCooldownSurvivesReopening() async throws {
        let suite = "manual-import-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let session = SyncFixtures.session(), idle = status(), running = status(.running, retry: Date().addingTimeInterval(300))
        var continuation: CheckedContinuation<ActivityMapAPI.StravaImport, Error>?
        var submissions = 0
        let controller = StravaImportController(defaults: defaults, load: { _ in idle }, submit: { _ in
            submissions += 1
            return try await withCheckedThrowingContinuation { continuation = $0 }
        })
        controller.activate(session); await controller.refresh(session)
        #expect(controller.canStart(session))
        let request = Task { await controller.start(session) }
        while continuation == nil { await Task.yield() }
        await controller.start(session)
        #expect(submissions == 1)
        continuation?.resume(returning: running); await request.value
        #expect(!controller.canStart(session))
        #expect(controller.progressMessage?.contains("Summaries fetched: 200") == true)
        let restored = StravaImportController(defaults: defaults, load: { _ in running })
        restored.activate(session); await restored.refresh(session)
        #expect(restored.snapshot?.status == .running)
        #expect(!restored.canStart(session))
    }
    @Test func accountChangeFencesLateStartAndOfflineCannotSubmit() async throws {
        let session = SyncFixtures.session(), idle = status(), running = status(.running)
        var continuation: CheckedContinuation<ActivityMapAPI.StravaImport, Error>?
        let controller = StravaImportController(load: { _ in idle }, submit: { _ in
            try await withCheckedThrowingContinuation { continuation = $0 }
        })
        controller.activate(session); await controller.refresh(session)
        let request = Task { await controller.start(session) }
        while continuation == nil { await Task.yield() }
        let other = SyncFixtures.session(id: "other")
        controller.activate(other)
        continuation?.resume(returning: running); await request.value
        #expect(controller.scope == other.scope)
        #expect(controller.snapshot == nil)
        let offline = SyncSession(user: other.user, token: other.token, deployment: other.deployment, verified: false)
        #expect(!controller.canStart(offline))
    }
    @Test func retryAfterSurvivesReopeningAndIsScopedToDeployment() async throws {
        let suite = "manual-import-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let session = SyncFixtures.session()
        var calls = 0
        let controller = StravaImportController(defaults: defaults, load: { _ in
            calls += 1; throw APIClient.RequestError.rateLimited(retryAfter: 3600, requestID: nil)
        })
        controller.activate(session); await controller.refresh(session)
        let restored = StravaImportController(defaults: defaults, load: { _ in calls += 1; return status() })
        restored.activate(session); await restored.refresh(session)
        #expect(calls == 1)
        let other = SyncSession(user: session.user, token: session.token, deployment: URL(string: "https://other.example")!, verified: true)
        restored.activate(other); await restored.refresh(other)
        #expect(calls == 2)
    }
}

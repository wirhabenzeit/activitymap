import Foundation
import Testing
@testable import ActivityMap

@MainActor struct IngestionStatusTests {
    struct Corpus: Decodable {
        struct Scenario: Decodable { let id: String; let status: ActivityMapAPI.IngestionStatus }
        let scenarios: [Scenario]
    }
    struct Expected: Codable, Equatable {
        let title: String; let coverage: String; let counts: String; let schedule: String; let reason: String?
    }
    private var shared: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appending(path: "shared")
    }
    private func corpus() throws -> Corpus {
        try ActivityMapAPI.makeDecoder().decode(Corpus.self, from: Data(contentsOf: shared.appending(path: "ingestion-status-fixtures.v1.json")))
    }
    @Test func sharedPresentationMatchesWebForEveryScenario() throws {
        let expected = try JSONDecoder().decode([String: [Expected]].self, from: Data(contentsOf: shared.appending(path: "ingestion-client-expectations.v1.json")))
        for scenario in try corpus().scenarios {
            let rows = IngestionPresentation.rows(scenario.status)
            let summaries = IngestionPresentation.summaries(scenario.status)
            #expect(summaries.count == 4)
            #expect(summaries[0].count.contains("total unknown") == (scenario.status.history.totalActivityCount == nil))
            #expect((summaries[2].status == "Needs attention") == (scenario.status.streams.failed > 0 || scenario.status.streams.scheduling == .stalled))
            #expect(rows.map { Expected(title: $0.title, coverage: $0.coverage, counts: $0.counts, schedule: $0.schedule, reason: $0.reason) } == expected[scenario.id])
            #expect(IngestionPresentation.stale(scenario.status, now: scenario.status.observedAt.addingTimeInterval(120)))
            #expect(!IngestionPresentation.stale(scenario.status, now: scenario.status.observedAt.addingTimeInterval(59)))
        }
    }
    @Test func boundedRefreshAndOfflineSnapshotStayScoped() async throws {
        let suite = "ingestion-tests-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let fixture = try #require(corpus().scenarios.first?.status)
        var calls = 0
        let controller = IngestionStatusController(defaults: defaults) { _ in calls += 1; return fixture }
        let session = SyncFixtures.session()
        controller.activate(session)
        await controller.refresh(session)
        await controller.refresh(session)
        #expect(calls == 1)
        #expect(controller.snapshot == fixture)
        let restored = IngestionStatusController(defaults: defaults)
        restored.activate(session)
        #expect(restored.snapshot == fixture)
        let otherDeployment = SyncSession(user: session.user, token: session.token, deployment: URL(string: "https://other.example")!, verified: true)
        restored.activate(otherDeployment)
        #expect(restored.snapshot == nil)
        #expect(restored.scope == otherDeployment.scope)
    }
    @Test func rejectedSessionDoesNotServeACachedSnapshot() async throws {
        let suite = "ingestion-tests-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let controller = IngestionStatusController(defaults: defaults) { _ in throw APIClient.RequestError.unexpectedStatus(401) }
        let session = SyncFixtures.session()
        controller.activate(session)
        await controller.refresh(session)
        #expect(controller.snapshot == nil)
        #expect(controller.message == "Sign in again to check server import status.")
    }
    @Test func lateResponseCannotReplaceAnotherAccountsSnapshot() async throws {
        let suite = "ingestion-tests-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let fixture = try #require(corpus().scenarios.first?.status)
        var continuation: CheckedContinuation<ActivityMapAPI.IngestionStatus, Never>?
        let controller = IngestionStatusController(defaults: defaults) { _ in
            await withCheckedContinuation { continuation = $0 }
        }
        let first = SyncFixtures.session()
        controller.activate(first)
        let request = Task { await controller.refresh(first) }
        while continuation == nil { await Task.yield() }
        let second = SyncFixtures.session(id: "bob")
        controller.activate(second)
        continuation?.resume(returning: fixture)
        await request.value
        #expect(controller.scope == second.scope)
        #expect(controller.snapshot == nil)
    }
    @Test func retryAfterIsHonouredAcrossReopeningSettings() async throws {
        let suite = "ingestion-tests-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        var calls = 0
        let controller = IngestionStatusController(defaults: defaults) { _ in
            calls += 1
            throw APIClient.RequestError.rateLimited(retryAfter: 3600, requestID: nil)
        }
        let session = SyncFixtures.session()
        controller.activate(session)
        await controller.refresh(session)
        controller.activate(session)
        await controller.refresh(session)
        #expect(calls == 1)
        #expect(controller.nextCheck.timeIntervalSinceNow > 3500)
    }

}

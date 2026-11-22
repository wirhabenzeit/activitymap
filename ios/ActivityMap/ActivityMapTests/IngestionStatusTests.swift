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
            let rows = IngestionPresentation.rows(scenario.status, locale: Locale(identifier: "en_US"))
            let summaries = IngestionPresentation.summaries(scenario.status, locale: Locale(identifier: "en_US"))
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
    @Test func coverageUsesStoredPhotosAndDoesNotInventPercentages() throws {
        let fixture = try #require(corpus().scenarios.first { $0.id == "photo-only-staleness" }?.status)
        let summaries = IngestionPresentation.summaries(fixture)
        #expect(summaries[0].progress == nil)
        #expect(summaries[3].progress?.completed == 8)
        #expect(fixture.photos.current == 6)
        #expect(summaries[3].progress?.percent == 88.8)
        #expect(IngestionPresentation.coverageProgress(nil, total: 100) == nil)
        #expect(IngestionPresentation.coverageProgress(0, total: 0) == nil)
        #expect(IngestionPresentation.coverageProgress(9999, total: 10000)?.percent == 99.9)
        #expect(IngestionPresentation.coverageProgress(100, total: 100)?.percent == 100)
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

    /// A fixture's status with its reconciliation (and history) fields replaced.
    private func status(_ reconciliation: [String: Any?], history: [String: Any?] = [:]) throws -> ActivityMapAPI.IngestionStatus {
        let raw = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: shared.appending(path: "ingestion-status-fixtures.v1.json"))) as? [String: Any])
        var value = try #require(((raw["scenarios"] as? [[String: Any]])?.first { $0["id"] as? String == "initial-import-unknown-total" })?["status"] as? [String: Any])
        var fields = try #require(value["history"] as? [String: Any])
        var sweep = try #require(fields["reconciliation"] as? [String: Any])
        for (key, item) in reconciliation { sweep[key] = item ?? NSNull() }
        for (key, item) in history { fields[key] = item ?? NSNull() }
        fields["reconciliation"] = sweep
        value["history"] = fields
        return try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.IngestionStatus.self, from: JSONSerialization.data(withJSONObject: value))
    }

    @Test func stravaCheckShowsTheSweepAsTheServerHasIt() async throws {
        let en = Locale(identifier: "en_US")
        let scanning = try status([:])
        let observed = scanning.observedAt
        let iso = { (minutes: Double) in ISO8601DateFormatter().string(from: observed.addingTimeInterval(minutes * 60)) }
        let idle = try status(["phase": "idle", "pagesScanned": nil, "scanStartedAt": nil,
                               "lastCompletedAt": iso(-120), "nextDueAt": iso(6 * 24 * 60)])
        let now = observed.addingTimeInterval(60)
        func view(_ status: ActivityMapAPI.IngestionStatus?, _ request: StravaCheck.Request? = nil, at: Date? = nil) -> StravaCheck.View {
            StravaCheck.view(status, request: request, now: at ?? now, locale: en)
        }
        // Reopened Settings: idle, requested elsewhere, scanning, confirming, waiting, blocked.
        #expect(view(idle).disabled == false)
        #expect(view(idle).message?.hasPrefix("Last checked ") == true)
        let due = try status(["phase": "idle", "pagesScanned": nil, "scanStartedAt": nil, "lastCompletedAt": iso(-120), "nextDueAt": iso(-1)])
        #expect(view(due) == .init(disabled: true, message: "Check requested. Missing activities appear as they are found."))
        #expect(view(scanning).disabled)
        #expect(view(scanning).message?.hasPrefix("Checking your Strava activity list… Started ") == true)
        #expect(view(try status(["phase": "confirming"])).message?.hasPrefix("Activity list checked ") == true)
        #expect(view(try status([:], history: ["scheduling": "waiting", "retryAt": iso(30)])).message?.hasPrefix("Strava’s request limit was reached.") == true)
        #expect(view(try status([:], history: ["scheduling": "blocked"])) == .init(disabled: true, message: nil))
        #expect(view(nil) == .init(disabled: false, message: nil))

        // A request's answer, until a newer status replaces it.
        let started = StravaCheck.Request.started(at: now)
        #expect(view(idle, started).message == "Check requested. Missing activities appear as they are found.")
        let finished = try status(["phase": "idle", "pagesScanned": nil, "scanStartedAt": nil,
                                   "lastCompletedAt": iso(2), "nextDueAt": iso(6 * 24 * 60)])
        let later = try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.IngestionStatus.self, from: JSONSerialization.data(withJSONObject: {
            var raw = try JSONSerialization.jsonObject(with: ActivityMapAPI.makeEncoder().encode(finished)) as! [String: Any]
            raw["observedAt"] = iso(2); return raw
        }()))
        #expect(view(later, started, at: observed.addingTimeInterval(180)).disabled == false)
        let recent = StravaCheck.Request.recent(at: now, retryAt: observed.addingTimeInterval(45 * 60))
        #expect(view(idle, recent).disabled)
        #expect(view(idle, recent).message?.hasPrefix("Strava was checked recently.") == true)
        #expect(view(idle, recent, at: observed.addingTimeInterval(46 * 60)).disabled == false)

        // The command's answer.
        func run(_ state: ActivityMapAPI.StravaImportStatus, retry: Date? = nil) -> ActivityMapAPI.StravaImport {
            .init(available: true, runID: "sweep-1", status: state, reason: nil, startedAt: nil, finishedAt: nil,
                  retryAt: retry, summaries: 0, details: 0, photos: 0)
        }
        let session = SyncFixtures.session(), fixed = { Date(timeIntervalSince1970: 1_000) }
        #expect(await StravaCheck.request(session, now: fixed) { _ in run(.running) } == .started(at: fixed()))
        #expect(await StravaCheck.request(session, now: fixed) { _ in run(.succeeded, retry: fixed().addingTimeInterval(600)) }
                == .recent(at: fixed(), retryAt: fixed().addingTimeInterval(600)))
        #expect(await StravaCheck.request(session, now: fixed) { _ in throw APIClient.RequestError.rateLimited(retryAfter: 3600, requestID: nil) }
                == .failed(at: fixed(), retryAt: fixed().addingTimeInterval(3600)))
    }

}

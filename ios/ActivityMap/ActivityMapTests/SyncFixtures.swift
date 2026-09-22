import Foundation
@testable import ActivityMap

actor ScriptedSyncSource: SyncPageSource {
    enum Step: Sendable {
        case bootstrap(ActivityMapAPI.SyncResource, String?, Result<ActivityMapAPI.SyncBootstrapPage, APIClient.RequestError>)
        case changes(String, Result<ActivityMapAPI.SyncChangesPage, APIClient.RequestError>)
    }
    enum ScriptError: Error { case unexpectedRequest }
    var steps: [Step]
    private(set) var calls = 0

    init(_ steps: [Step]) { self.steps = steps }

    func bootstrap(resource: ActivityMapAPI.SyncResource, cursor: String?) throws -> ActivityMapAPI.SyncBootstrapPage {
        calls += 1
        guard !steps.isEmpty, case .bootstrap(let expectedResource, let expectedCursor, let result) = steps.removeFirst(),
              resource == expectedResource, cursor == expectedCursor else { throw ScriptError.unexpectedRequest }
        return try result.get()
    }

    func changes(cursor: String) throws -> ActivityMapAPI.SyncChangesPage {
        calls += 1
        guard !steps.isEmpty, case .changes(let expected, let result) = steps.removeFirst(), expected == cursor else {
            throw ScriptError.unexpectedRequest
        }
        return try result.get()
    }
}

@MainActor
enum SyncFixtures {
    static let retention = ActivityMapAPI.SyncRetentionMeta(retentionDays: 30, cursorValidUntil: Date().addingTimeInterval(86400))
    static let freshness = ActivityMapAPI.SyncFreshnessMeta(lastSummaryReconciledAt: Date())
    static let rebootstrap = APIClient.RequestError.server(code: "sync_rebootstrap_required", message: "Expired", status: 409, requestID: "request", retryable: false)

    static func activities(_ items: [ActivityMapAPI.Activity] = [], next: String? = nil, snapshot: String? = "snapshot", freshness: ActivityMapAPI.SyncFreshnessMeta = SyncFixtures.freshness) -> ActivityMapAPI.SyncBootstrapPage {
        .activities(.init(items: items, nextCursor: next, snapshotCursor: snapshot, retention: retention, freshness: freshness))
    }

    static func photos(_ items: [ActivityMapAPI.Photo] = [], next: String? = nil, freshness: ActivityMapAPI.SyncFreshnessMeta = SyncFixtures.freshness) -> ActivityMapAPI.SyncBootstrapPage {
        .photos(.init(items: items, nextCursor: next, snapshotCursor: nil, retention: retention, freshness: freshness))
    }

    static func changes(_ items: [ActivityMapAPI.SyncChangeItem] = [], next: String, freshness: ActivityMapAPI.SyncFreshnessMeta = SyncFixtures.freshness) -> ActivityMapAPI.SyncChangesPage {
        .init(items: items, nextCursor: next, retention: retention, freshness: freshness)
    }

    static func upsert(_ dto: ActivityMapAPI.Activity) -> ActivityMapAPI.SyncChangeItem {
        .init(sequence: "1", entityType: .activity, operation: .upsert, id: dto.id, activity: dto, photo: nil)
    }

    static func session(id: String = "alice", verified: Bool = true, connected: Bool = true) -> SyncSession {
        .init(user: .init(id: id, name: id, email: nil, image: nil, athleteID: "42", stravaConnected: connected,
                         authentication: .init(method: .bearer, sessionExpiresAt: Date().addingTimeInterval(86400))),
              token: "test-token-\(id)", deployment: Fixtures.scope.deployment, verified: verified)
    }

    static func complete(_ items: [ActivityMapAPI.Activity] = []) -> ScriptedSyncSource {
        ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(activities(items))),
            .bootstrap(.photos, nil, .success(photos())),
            .changes("snapshot", .success(changes(next: "snapshot"))),
        ])
    }
}

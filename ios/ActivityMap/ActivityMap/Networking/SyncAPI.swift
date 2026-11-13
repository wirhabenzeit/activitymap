import Foundation

nonisolated protocol SyncPageSource: Sendable {
    func accepts(cursor: String) -> Bool
    func bootstrap(resource: ActivityMapAPI.SyncResource, cursor: String?) async throws -> ActivityMapAPI.SyncBootstrapPage
    func changes(cursor: String) async throws -> ActivityMapAPI.SyncChangesPage
}

nonisolated extension SyncPageSource {
    func accepts(cursor: String) -> Bool { true }
}

/// Credentials and deployment are captured for a whole sync pass, never read
/// afresh from global auth state partway through pagination.
nonisolated struct SyncAPI: SyncPageSource {
    let baseURL: URL
    let token: String
    var session: URLSession = .shared

    func accepts(cursor: String) -> Bool { !cursor.hasPrefix("ios-convex-") }

    func bootstrap(resource: ActivityMapAPI.SyncResource, cursor: String?) async throws -> ActivityMapAPI.SyncBootstrapPage {
        var query = [URLQueryItem(name: "resource", value: resource.rawValue)]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await APIClient.get(
            "/api/v1/sync/bootstrap", query: query, bearerToken: token,
            baseURL: baseURL, session: session, as: ActivityMapAPI.SyncBootstrapPage.self)
    }

    func changes(cursor: String) async throws -> ActivityMapAPI.SyncChangesPage {
        try await APIClient.get(
            "/api/v1/sync/changes", query: [URLQueryItem(name: "cursor", value: cursor), URLQueryItem(name: "limit", value: "500")],
            bearerToken: token, baseURL: baseURL, session: session, as: ActivityMapAPI.SyncChangesPage.self)
    }
}

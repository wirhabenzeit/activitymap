import Foundation

nonisolated protocol ShareLinksSource: Sendable {
    func create(_ request: ActivityMapAPI.CreateShareLinkRequest) async throws -> ActivityMapAPI.CreatedShareLink
    func list() async throws -> [ActivityMapAPI.ShareLinkSummary]
    func revoke(id: String) async throws
}

nonisolated struct ShareLinksAPI: ShareLinksSource {
    let baseURL: URL
    let token: String
    var session: URLSession = .shared

    func create(_ request: ActivityMapAPI.CreateShareLinkRequest) async throws -> ActivityMapAPI.CreatedShareLink {
        try await APIClient.post("/api/v1/share-links", body: request, bearerToken: token,
            baseURL: baseURL, session: session, as: ActivityMapAPI.CreatedShareLink.self)
    }

    func list() async throws -> [ActivityMapAPI.ShareLinkSummary] {
        try await APIClient.get("/api/v1/share-links", bearerToken: token,
            baseURL: baseURL, session: session, as: ActivityMapAPI.ShareLinkList.self).links
    }

    func revoke(id: String) async throws {
        let _: ActivityMapAPI.RevokeShareLinkResult = try await APIClient.post("/api/v1/share-links/revoke",
            body: ActivityMapAPI.RevokeShareLinkRequest(id: id), bearerToken: token,
            baseURL: baseURL, session: session, as: ActivityMapAPI.RevokeShareLinkResult.self)
    }
}

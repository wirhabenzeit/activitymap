import Foundation

/// How a stream request may reach Strava. Detail opens use `auto`; `refresh`
/// is only for a deliberate user refresh, never for every open.
nonisolated enum StreamFetchMode: Sendable, Hashable {
    /// `fetch=none`: the server's stored state only, never an upstream request.
    case storedOnly
    /// `fetch=auto`: reuse a current stored set, fetch a missing or stale one.
    case auto
    /// `refresh=true`: ask the server to fetch again even if its set is current.
    case refresh

    var queryItems: [URLQueryItem] {
        switch self {
        case .storedOnly: [URLQueryItem(name: "fetch", value: "none")]
        case .auto: []
        case .refresh: [URLQueryItem(name: "refresh", value: "true")]
        }
    }
}

nonisolated protocol StreamSource: Sendable {
    func rawStreams(activityID: String, mode: StreamFetchMode) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityStreams>
    func summary(activityID: String, mode: StreamFetchMode) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityStreamSummary>
    /// Stored summaries only (never contacts Strava), keyed by activity ID.
    /// Activities the server omitted are absent, not empty charts.
    func storedSummaries(activityIDs: [String]) async throws
        -> [String: ActivityMapAPI.ActivityStreamSummary]
}

/// v1 stream endpoints. Like `SyncAPI`, credentials and deployment are
/// captured once so a response can always be attributed to the scope that
/// requested it.
nonisolated struct StreamsAPI: StreamSource {
    /// `STREAM_SUMMARIES_MAX_IDS` in `src/app/api/v1/stream-summaries/handler.ts`.
    static let maxSummaryBatch = 100

    let baseURL: URL
    let token: String
    var session: URLSession = .shared

    func rawStreams(activityID: String, mode: StreamFetchMode) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityStreams> {
        let id = try Self.validated(activityID)
        return try await APIClient.getResponse(
            "/api/v1/activities/\(id)/streams",
            query: mode.queryItems, bearerToken: token, baseURL: baseURL, session: session,
            as: ActivityMapAPI.ActivityStreams.self)
    }

    func summary(activityID: String, mode: StreamFetchMode) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityStreamSummary> {
        let id = try Self.validated(activityID)
        return try await APIClient.getResponse(
            "/api/v1/activities/\(id)/streams/summary",
            query: mode.queryItems, bearerToken: token, baseURL: baseURL, session: session,
            as: ActivityMapAPI.ActivityStreamSummary.self)
    }

    func storedSummaries(activityIDs: [String]) async throws
        -> [String: ActivityMapAPI.ActivityStreamSummary] {
        var seen = Set<String>()
        let ids = try activityIDs.filter { seen.insert($0).inserted }.map(Self.validated)
        var result: [String: ActivityMapAPI.ActivityStreamSummary] = [:]
        for start in stride(from: 0, to: ids.count, by: Self.maxSummaryBatch) {
            let batch = ids[start..<min(start + Self.maxSummaryBatch, ids.count)]
            let page = try await APIClient.get(
                "/api/v1/stream-summaries",
                query: [URLQueryItem(name: "ids", value: batch.joined(separator: ","))],
                bearerToken: token, baseURL: baseURL, session: session,
                as: ActivityMapAPI.ActivityStreamSummaries.self)
            // Order is unspecified; ignore anything that was not asked for.
            let requested = Set(batch)
            for entry in page.summaries where requested.contains(entry.activityID) {
                result[entry.activityID] = entry
            }
        }
        return result
    }

    /// Activity IDs are canonical decimal strings; anything else would change
    /// the request path or the comma-separated batch.
    static func validated(_ activityID: String) throws -> String {
        guard !activityID.isEmpty, activityID.utf8.allSatisfy({ (48...57).contains($0) }) else {
            throw APIClient.RequestError.encoding("Invalid activity ID \(activityID)")
        }
        return activityID
    }
}

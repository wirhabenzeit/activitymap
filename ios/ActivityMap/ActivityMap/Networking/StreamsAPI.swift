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
        case .auto: [URLQueryItem(name: "fetch", value: "auto")]
        case .refresh: [URLQueryItem(name: "fetch", value: "auto"), URLQueryItem(name: "refresh", value: "true")]
        }
    }
}

nonisolated protocol StreamSource: Sendable {
    func rawStreams(activityID: String, mode: StreamFetchMode) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityStreams>
    func summary(activityID: String, mode: StreamFetchMode) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummary>
    /// Stored summaries only (never contacts Strava), keyed by activity ID.
    /// Activities the server omitted are absent, not empty charts.
    func storedSummaries(activityIDs: [String]) async throws
        -> [String: ActivityMapAPI.ActivityCompactStreamSummary]
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
        let response = try await APIClient.getResponse(
            "/api/v1/activities/\(id)/streams",
            query: mode.queryItems, bearerToken: token, baseURL: baseURL, session: session,
            as: ActivityMapAPI.ActivityStreams.self)
        guard response.payload.activityID == id else {
            throw APIClient.RequestError.decoding("Stream response activity ID does not match the request")
        }
        return response
    }

    func summary(activityID: String, mode: StreamFetchMode) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummary> {
        let id = try Self.validated(activityID)
        let response = try await APIClient.getResponse(
            "/api/v1/activities/\(id)/streams/summary/compact",
            query: mode.queryItems, bearerToken: token, baseURL: baseURL, session: session,
            as: ActivityMapAPI.ActivityCompactStreamSummary.self)
        guard response.payload.activityID == id else {
            throw APIClient.RequestError.decoding("Summary response activity ID does not match the request")
        }
        return response
    }

    /// One stored-only batch, preserving its HTTP metadata. The endpoint has no
    /// upstream fetch or refresh mode. Encoded series stay encoded in the DTO.
    func storedSummaryBatch(activityIDs: [String]) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummaries> {
        try Task.checkCancellation()
        let ids = try Self.uniqueValidated(activityIDs)
        guard !ids.isEmpty, ids.count <= Self.maxSummaryBatch else {
            throw APIClient.RequestError.encoding("Pass 1 to \(Self.maxSummaryBatch) activity IDs")
        }
        return try await APIClient.getResponse(
            "/api/v1/stream-summaries/compact",
            query: [URLQueryItem(name: "ids", value: ids.joined(separator: ","))],
            bearerToken: token, baseURL: baseURL, session: session,
            as: ActivityMapAPI.ActivityCompactStreamSummaries.self)
    }

    func storedSummaries(activityIDs: [String]) async throws
        -> [String: ActivityMapAPI.ActivityCompactStreamSummary] {
        try Task.checkCancellation()
        let ids = try Self.uniqueValidated(activityIDs)
        var result: [String: ActivityMapAPI.ActivityCompactStreamSummary] = [:]
        for start in stride(from: 0, to: ids.count, by: Self.maxSummaryBatch) {
            let batch = ids[start..<min(start + Self.maxSummaryBatch, ids.count)]
            try Task.checkCancellation()
            let page = try await storedSummaryBatch(activityIDs: Array(batch)).payload
            // Order is unspecified; ignore anything that was not asked for.
            let requested = Set(batch)
            for entry in page.summaries where requested.contains(entry.activityID) {
                result[entry.activityID] = entry
            }
        }
        return result
    }

    private static func uniqueValidated(_ activityIDs: [String]) throws -> [String] {
        var seen = Set<String>()
        return try activityIDs.filter { seen.insert($0).inserted }.map(validated)
    }

    /// Activity IDs are canonical decimal strings; anything else would change
    /// the request path or the comma-separated batch.
    static func validated(_ activityID: String) throws -> String {
        guard activityID.first != "0", activityID.utf8.allSatisfy({ (48...57).contains($0) }),
              let numericID = Int64(activityID), numericID > 0 else {
            throw APIClient.RequestError.encoding("Invalid activity ID \(activityID)")
        }
        return activityID
    }
}

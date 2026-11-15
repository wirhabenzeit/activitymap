import Foundation

nonisolated protocol ActivityEditSource: Sendable {
    func update(activityID: String, fields: ActivityMapAPI.UpdateActivityRequest) async throws -> ActivityMapAPI.Activity
}

nonisolated struct ActivityEditsAPI: ActivityEditSource {
    let baseURL: URL
    let token: String
    var session: URLSession = .shared

    func update(activityID: String, fields: ActivityMapAPI.UpdateActivityRequest) async throws -> ActivityMapAPI.Activity {
        let id = try StreamsAPI.validated(activityID)
        let activity = try await APIClient.patch("/api/v1/activities/\(id)", body: fields,
            bearerToken: token, baseURL: baseURL, session: session, as: ActivityMapAPI.Activity.self)
        guard activity.id == id else { throw APIClient.RequestError.decoding("Activity identity mismatch") }
        return activity
    }
}

nonisolated protocol ActivityRefreshSource: Sendable {
    func refresh(activityID: String) async throws -> ActivityMapAPI.ActivityRefreshResult
}

extension ActivityEditsAPI: ActivityRefreshSource {
    func refresh(activityID: String) async throws -> ActivityMapAPI.ActivityRefreshResult {
        let id = try StreamsAPI.validated(activityID)
        let result = try await APIClient.post("/api/v1/activities/\(id)/refresh",
            bearerToken: token, baseURL: baseURL, session: session, timeout: 60, as: ActivityMapAPI.ActivityRefreshResult.self)
        guard result.activity.id == id, result.photos.allSatisfy({ $0.activityID == id }),
              Set(result.photos.map(\.uniqueID)).count == result.photos.count else {
            throw APIClient.RequestError.decoding("Activity refresh identity mismatch")
        }
        return result
    }
}

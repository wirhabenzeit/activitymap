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

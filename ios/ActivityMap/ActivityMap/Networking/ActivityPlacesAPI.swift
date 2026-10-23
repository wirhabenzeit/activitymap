import Foundation

nonisolated protocol ActivityPlacesSource: Sendable {
    func places(activityID: String) async throws -> ActivityMapAPI.ActivityPlaces
}

/// Uses the deployed web endpoint and its exact shared Zod-generated DTO.
nonisolated struct ActivityPlacesAPI: ActivityPlacesSource {
    let baseURL: URL
    let token: String
    var session: URLSession = .shared

    func places(activityID: String) async throws -> ActivityMapAPI.ActivityPlaces {
        let id = try StreamsAPI.validated(activityID)
        let result = try await APIClient.getUnwrapped("/api/activities/\(id)/places",
            bearerToken: token, baseURL: baseURL, session: session, as: ActivityMapAPI.ActivityPlaces.self)
        guard result.activityID == id,
              result.places.allSatisfy({ $0.latitude.isFinite && abs($0.latitude) <= 90
                && $0.longitude.isFinite && abs($0.longitude) <= 180 && !$0.kinds.isEmpty }) else {
            throw APIClient.RequestError.decoding("Places response identity or geometry is invalid")
        }
        return result
    }
}

import UIKit

enum StravaActivityLink {
    enum OpenError: LocalizedError {
        case invalidID, unavailable
        var errorDescription: String? {
            switch self {
            case .invalidID: "This activity doesn’t have a valid Strava link."
            case .unavailable: "The activity couldn’t be opened in Strava or your browser. Check your connection and try again."
            }
        }
    }

    static func url(activityID: Int) throws -> URL {
        guard activityID > 0, let url = URL(string: "https://www.strava.com/activities/\(activityID)") else {
            throw OpenError.invalidID
        }
        return url
    }

    /// Universal links use Strava when available; the ordinary HTTPS open
    /// falls back to the user's browser. Never round the ID through Double.
    static func open(activityID: Int,
                     using opener: (URL, Bool) async -> Bool = { url, universalOnly in
                         await UIApplication.shared.open(url, options: universalOnly ? [.universalLinksOnly: true] : [:])
                     }) async throws {
        let url = try url(activityID: activityID)
        try Task.checkCancellation()
        if await opener(url, true) { return }
        try Task.checkCancellation()
        guard await opener(url, false) else { throw OpenError.unavailable }
    }
}

import Foundation

/// Deployment configuration for this build, supplied by `Config/Base.xcconfig`
/// (overridable in the ignored `Config/Local.xcconfig`) and surfaced through the
/// merged `Info.plist`.
///
/// The app reads and writes only through `/api/v1` and never holds a database
/// credential or a Strava token, so choosing an environment here chooses a
/// deployment; that deployment owns its own database.
///
/// Marked `nonisolated` because the target builds with
/// `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`, and the sync engine needs to
/// read this from its own background actor.
nonisolated enum APIConfiguration {
    /// The v1 contract version this build was written against, matching
    /// `SCHEMA_VERSION` in `src/contracts/v1/primitives.ts`. Every v1 response
    /// carries a `schemaVersion`; anything else means the client and server
    /// contracts have diverged.
    static let expectedSchemaVersion = "1"

    /// Base URL of the ActivityMap deployment, e.g. `http://localhost:3000`.
    static let baseURL: URL = {
        let raw = requiredValue(for: "ActivityMapAPIBaseURL")
        guard let url = URL(string: raw) else {
            preconditionFailure("ActivityMapAPIBaseURL is not a valid URL: \(raw)")
        }
        return url
    }()

    /// Where the mobile auth flow redirects with its one-time code. The server
    /// rejects any redirect target missing from `MOBILE_AUTH_REDIRECT_ALLOWLIST`,
    /// matching protocol, host, and path prefix exactly.
    static let authRedirectURI = requiredValue(for: "ActivityMapAuthRedirectURI")

    /// The scheme `ASWebAuthenticationSession` watches for, registered under
    /// `CFBundleURLTypes` so the redirect can reach the app at all.
    static let authCallbackScheme: String = {
        let scheme = requiredValue(for: "ActivityMapAuthCallbackScheme")
        // A redirect URI on some other scheme would never reach the callback,
        // and that failure surfaces as a silently abandoned sign-in rather than
        // as the configuration mistake it actually is.
        guard authRedirectURI.hasPrefix("\(scheme):") else {
            preconditionFailure(
                """
                ActivityMapAuthCallbackScheme (\(scheme)) does not match \
                ActivityMapAuthRedirectURI (\(authRedirectURI)).
                """
            )
        }
        return scheme
    }()

    /// Builds an absolute URL for a v1 path such as `/api/v1/me`.
    static func endpoint(_ path: String) -> URL {
        baseURL.appending(path: path)
    }

    private static func requiredValue(for key: String) -> String {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
            !value.isEmpty
        else {
            preconditionFailure(
                """
                Missing Info.plist value for \(key). Copy \
                Config/Local.xcconfig.example to Config/Local.xcconfig and \
                check Config/Base.xcconfig.
                """
            )
        }
        return value
    }
}

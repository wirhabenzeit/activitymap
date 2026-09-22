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
    /// Why a configured value is unusable. Every case is a build
    /// misconfiguration rather than anything a person using the app can act on,
    /// so these surface through `preconditionFailure` at first use.
    enum ConfigurationError: Error, CustomStringConvertible {
        case missing(key: String)
        case unparsable(key: String, value: String)
        case unsupportedScheme(key: String, value: String)
        case schemeMismatch(key: String, value: String, expected: String)
        case missingHost(key: String, value: String)
        case insecureRemoteHost(key: String, value: String, host: String)

        var description: String {
            switch self {
            case .missing(let key):
                """
                \(key) is missing or empty. Copy Config/Local.xcconfig.example to \
                Config/Local.xcconfig and check Config/Base.xcconfig.
                """
            case .unparsable(let key, let value):
                "\(key) is not a valid URL: \(value)"
            case .unsupportedScheme(let key, let value):
                """
                \(key) must use http or https, got: \(value). Remember that "//" \
                starts a comment in xcconfig, so a literal https://host truncates \
                to "https:" — compose separators from $(SLASH).
                """
            case .schemeMismatch(let key, let value, let expected):
                """
                \(key) must use the \(expected) scheme registered in \
                CFBundleURLTypes, got: \(value). A redirect on any other scheme \
                never reaches the app.
                """
            case .missingHost(let key, let value):
                """
                \(key) has no host: \(value). A bare scheme like "https:" is what \
                xcconfig produces when a literal "//" is swallowed as a comment; \
                compose separators from $(SLASH).
                """
            case .insecureRemoteHost(let key, let value, let host):
                """
                \(key) uses plain HTTP for \(host): \(value). Only localhost may \
                use HTTP, matching the single App Transport Security exception in \
                Info.plist. Use https for any other host.
                """
            }
        }
    }

    /// Base URL of the ActivityMap deployment, e.g. `http://localhost:3000`.
    static let baseURL: URL = resolve {
        try validateBaseURL(requiredValue(for: InfoKey.baseURL), key: InfoKey.baseURL)
    }

    /// Where the mobile auth flow redirects with its one-time code. The server
    /// rejects any redirect target missing from `MOBILE_AUTH_REDIRECT_ALLOWLIST`,
    /// matching protocol, host, and path prefix exactly.
    static let authRedirectURI: URL = resolve {
        try validateRedirectURI(
            requiredValue(for: InfoKey.redirectURI),
            expectedScheme: authCallbackScheme,
            key: InfoKey.redirectURI
        )
    }

    /// The scheme `ASWebAuthenticationSession` watches for, registered under
    /// `CFBundleURLTypes` so the redirect can reach the app at all.
    static let authCallbackScheme: String = resolve {
        try requiredValue(for: InfoKey.callbackScheme)
    }

    /// Builds an absolute URL for a v1 path such as `/api/v1/me`.
    static func endpoint(_ path: String) -> URL {
        baseURL.appending(path: path)
    }

    // MARK: - Validation

    /// Validates a configured API base URL.
    ///
    /// `URL(string:)` on its own is far too permissive to serve as a guard: it
    /// accepts `http:` with a nil host, a relative `foo` with no scheme, and
    /// `://x` with an empty scheme. The first of those is exactly what xcconfig
    /// yields when a literal `//` is eaten as a comment, and it would otherwise
    /// compose into nonsense like `http:/api/v1/me` at the first request instead
    /// of failing here.
    ///
    /// Plain HTTP is permitted only for `localhost`, matching the single App
    /// Transport Security exception in `Info.plist`; any other host must be
    /// HTTPS, so the code and that exception cannot disagree.
    static func validateBaseURL(_ raw: String, key: String) throws -> URL {
        let url = try parse(raw, key: key)

        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            throw ConfigurationError.unsupportedScheme(key: key, value: raw)
        }
        guard let host = url.host(), !host.isEmpty else {
            throw ConfigurationError.missingHost(key: key, value: raw)
        }
        guard scheme == "https" || host == "localhost" else {
            throw ConfigurationError.insecureRemoteHost(key: key, value: raw, host: host)
        }

        return url
    }

    /// Validates the mobile auth redirect target. A redirect on some other
    /// scheme would never reach the callback, and a truncated one such as
    /// `activitymap:` still satisfies a naive scheme-prefix check, so the host
    /// is required too. Either failure otherwise surfaces as a silently
    /// abandoned sign-in rather than as the configuration mistake it is.
    static func validateRedirectURI(
        _ raw: String,
        expectedScheme: String,
        key: String
    ) throws -> URL {
        let url = try parse(raw, key: key)

        guard url.scheme?.lowercased() == expectedScheme.lowercased() else {
            throw ConfigurationError.schemeMismatch(
                key: key, value: raw, expected: expectedScheme
            )
        }
        guard let host = url.host(), !host.isEmpty else {
            throw ConfigurationError.missingHost(key: key, value: raw)
        }

        return url
    }

    // MARK: - Info.plist access

    private enum InfoKey {
        static let baseURL = "ActivityMapAPIBaseURL"
        static let redirectURI = "ActivityMapAuthRedirectURI"
        static let callbackScheme = "ActivityMapAuthCallbackScheme"
    }

    private static func parse(_ raw: String, key: String) throws -> URL {
        guard let url = URL(string: raw) else {
            throw ConfigurationError.unparsable(key: key, value: raw)
        }
        return url
    }

    private static func requiredValue(for key: String) throws -> String {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
            !value.isEmpty
        else {
            throw ConfigurationError.missing(key: key)
        }
        return value
    }

    /// Turns a configuration failure into a trap at first use. Nothing here is
    /// recoverable at runtime: the value is baked into the bundle at build time.
    private static func resolve<Value>(_ load: () throws -> Value) -> Value {
        do {
            return try load()
        } catch {
            preconditionFailure("Invalid ActivityMap configuration. \(error)")
        }
    }
}

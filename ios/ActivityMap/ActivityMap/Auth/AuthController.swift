import AuthenticationServices
import CryptoKit
import Foundation
import Observation
import Security
#if canImport(UIKit)
import UIKit
#endif

/// Drives the mobile sign-in flow documented in
/// `docs/swiftui-backend-preparation-plan.md` ("Authentication design") and
/// implemented server-side by `~/server/auth/mobile.ts`: PKCE, a hosted
/// `ASWebAuthenticationSession`, a one-time code exchange, and an ActivityMap
/// bearer session stored in the Keychain.
///
/// This promotes `ios/ActivityMapMobileAuthTestClient/` into the app target —
/// see that file's header for the flow this was built from — routed through
/// `APIConfiguration` for the deployment/scheme/redirect instead of the test
/// client's hardcoded placeholders, and through `APIClient` and the generated
/// `ActivityMapAPI` DTOs instead of hand-rolled envelope structs.
@MainActor
@Observable
final class AuthController: NSObject {
    enum Status: Equatable {
        case signedOut
        /// A Keychain session exists and is being confirmed with `/me`. It is
        /// neither signed out (no new login is needed) nor verified yet.
        case restoring
        case signingIn
        case signedIn(ActivityMapAPI.CurrentUser)
        /// `restoreSession()` found a Keychain token but could not confirm it
        /// — a transport failure, timeout, `5xx`/`429`, or a decode error,
        /// anything short of the server explicitly rejecting the token. The
        /// token is left in the Keychain; retry with `restoreSession()`
        /// rather than starting a fresh sign-in, since the stored token may
        /// still be perfectly valid.
        /// The associated message is short, user-facing copy.
        case sessionRestoreFailed(String)
        /// `signOut()` could not confirm the server revoked the session — a
        /// transport failure, timeout, or `5xx`. The Keychain token is left
        /// in place: deleting the only copy here would leave a still-valid
        /// server session with nothing left to retry revocation with. Retry
        /// with `signOut()`.
        case signOutFailed(String)
        /// A sign-in attempt failed for a reason other than the person
        /// cancelling or declining; carries a short diagnostic code.
        case failed(String)
    }

    enum AuthError: Error, Equatable, CustomStringConvertible {
        case missingCodeOrState
        case stateMismatch
        case sessionFailedToStart
        case secureRandomUnavailable(OSStatus)
        /// The server returned the sign-in to the app with an `error` code
        /// (`/api/v1/auth/mobile/callback`), e.g. a failed Strava exchange.
        case provider(code: String, requestID: String?)

        var description: String {
            switch self {
            case .missingCodeOrState:
                "The sign-in callback was missing its code or state."
            case .stateMismatch:
                "The sign-in callback did not match the request that started it."
            case .sessionFailedToStart:
                "The sign-in sheet could not be presented."
            case .secureRandomUnavailable(let status):
                "Could not generate a secure random value (status \(status))."
            case .provider(let code, let requestID):
                "Sign-in returned \(code)" + (requestID.map { " (request \($0))" } ?? "") + "."
            }
        }
    }

    private(set) var status: Status = .signedOut
    /// The server asked not to retry session verification before this time.
    private(set) var restoreRetryAt: Date?

    /// The last sign-in attempt failed; cancelling is not a failure.
    var signInFailed: Bool {
        if case .failed = status { return true }
        return false
    }
    private(set) var currentUser: ActivityMapAPI.CurrentUser?
    private var revision = 0
    private var restoringToken: String?
    var isRestoringSession: Bool { restoringToken != nil }
    private var signingOut = false

    override init() {
        super.init()
        if let token = SessionStore.load() {
            currentUser = SessionIdentityStore.load(token: token, deployment: APIConfiguration.baseURL)
            // A returning person is not asked to sign in while the stored
            // session is checked (issue #303).
            status = .restoring
        }
    }

    var syncSession: SyncSession? {
        guard let currentUser, let token = SessionStore.load() else { return nil }
        let verified: Bool
        if case .signedIn = status { verified = true } else { verified = false }
        return SyncSession(user: currentUser, token: token, deployment: APIConfiguration.baseURL, verified: verified)
    }

    func invalidateSession(token: String) {
        guard SessionStore.load() == token else { return }
        revision += 1
        SessionStore.clear()
        SessionIdentityStore.clear()
        currentUser = nil
        status = .signedOut
    }

    /// Retained only for the duration of one sign-in attempt; `start()` needs
    /// its session kept alive, and there is nothing to keep once it finishes.
    private var authSession: ASWebAuthenticationSession?

    /// Attempts to resume a session already stored in the Keychain. Call once
    /// at launch. Only an explicit server rejection (`401`/`not_authenticated`)
    /// clears the token and moves to `.signedOut` — anything else (no
    /// connectivity, a timeout, a `5xx`) leaves the token in place and moves
    /// to `.sessionRestoreFailed`, since merely launching the app during a
    /// transient outage must not permanently sign anyone out.
    func restoreSession() async {
        guard !signingOut else { return }
        guard let token = SessionStore.load() else { return }
        guard restoringToken != token else { return }
        // Respect the server's requested wait after a rate-limited or
        // unavailable check; the failure message already names the time.
        if case .sessionRestoreFailed = status, let restoreRetryAt, restoreRetryAt > Date() { return }
        restoringToken = token
        defer { if restoringToken == token { restoringToken = nil } }
        // Re-verifying a signed-in session (pull to refresh) or the token a
        // sign-in just saved keeps its status; only an unconfirmed session
        // shows as restoring.
        switch status {
        case .signedOut, .sessionRestoreFailed: status = .restoring
        default: break
        }
        let requestRevision = revision
        do {
            let user = try await APIClient.get(
                "/api/v1/me", bearerToken: token, as: ActivityMapAPI.CurrentUser.self)
            guard requestRevision == revision, SessionStore.load() == token else { return }
            try SessionIdentityStore.save(user, token: token, deployment: APIConfiguration.baseURL)
            currentUser = user
            restoreRetryAt = nil
            status = .signedIn(user)
        } catch {
            guard requestRevision == revision, SessionStore.load() == token else { return }
            if Self.isExplicitlyUnauthenticated(error) {
                invalidateSession(token: token)
            } else {
                restoreRetryAt = Self.retryAfter(error).map { Date().addingTimeInterval($0) }
                status = .sessionRestoreFailed(Self.userMessage(for: error))
            }
        }
    }

    /// Runs the full flow end to end: generate `state` and a PKCE
    /// verifier/challenge, open the hosted sign-in sheet, exchange the
    /// resulting one-time code, store the bearer token, then hand off to
    /// `restoreSession()` to confirm it and report `status`.
    ///
    /// That handoff matters once the token is actually saved: at that point
    /// authentication has already succeeded and persisted, so a timeout or
    /// `5xx` on the confirming `/api/v1/me` call must not be treated as a
    /// sign-in failure whose retry starts a whole new OAuth round trip —
    /// `restoreSession()` already draws that 401-versus-transient
    /// distinction and gives a transient failure the right retry (itself,
    /// not a fresh `signIn()`).
    func signIn() async {
        // Repeated taps while the hosted sheet is opening start nothing new.
        guard status != .signingIn else { return }
        revision += 1
        // Every later step is fenced to this attempt: signing out, or an
        // expired session being invalidated, supersedes it, and a late
        // callback or exchange must not restore an unwanted session.
        let attempt = revision
        // Someone already signed in is reconnecting, usually to change what
        // they granted. Strava skips its consent screen for an app it has
        // already authorised, so ask for it explicitly.
        let reviewPermissions = currentUser != nil
        currentUser = nil
        status = .signingIn
        do {
            let state = try Self.randomURLSafeString()
            let verifier = try Self.randomURLSafeString()
            let challenge = Self.s256Challenge(forVerifier: verifier)

            guard
                var startURL = URLComponents(
                    url: APIConfiguration.endpoint("/api/v1/auth/mobile/start"),
                    resolvingAgainstBaseURL: false)
            else {
                throw AuthError.missingCodeOrState
            }
            startURL.queryItems = [
                URLQueryItem(name: "state", value: state),
                URLQueryItem(name: "code_challenge", value: challenge),
                URLQueryItem(
                    name: "redirect_uri",
                    value: APIConfiguration.authRedirectURI.absoluteString),
            ]
            if reviewPermissions {
                startURL.queryItems?.append(URLQueryItem(name: "prompt", value: "consent"))
            }
            guard let url = startURL.url else { throw AuthError.missingCodeOrState }

            let callbackURL = try await presentAuthSession(startingAt: url)
            guard attempt == revision else { return }

            let code: String
            switch Self.parseCallback(callbackURL, expectedState: state) {
            case .code(let value):
                code = value
            case .declined:
                // Declining on Strava's consent screen is the person's
                // choice, like closing the sheet: return quietly.
                status = .signedOut
                return
            case .failure(let error):
                throw error
            }

            let exchange = try await APIClient.post(
                "/api/v1/auth/mobile/exchange",
                body: ActivityMapAPI.MobileExchangeRequest(
                    code: code, pkceVerifier: verifier, state: state),
                as: ActivityMapAPI.MobileExchangeResponse.self)
            guard attempt == revision else {
                // Superseded while exchanging: don't keep the new session,
                // and don't leave it valid on the server either.
                Self.revokeAbandoned(exchange.sessionToken)
                return
            }

            try SessionStore.save(exchange.sessionToken)

            // The token is saved; from here on, any failure to confirm it is
            // restoreSession()'s classification to make, not a fresh
            // sign-in failure. restoreSession() never throws.
            await restoreSession()
        } catch is CancellationError {
            // Swift-level task cancellation; not a failure to report.
            guard attempt == revision else { return }
            status = .signedOut
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // The person dismissed the sign-in sheet themselves. This is the
            // ordinary "changed their mind" path, not an error.
            guard attempt == revision else { return }
            status = .signedOut
        } catch {
            guard attempt == revision else { return }
            status = .failed(String(describing: error))
        }
    }

    enum CallbackResult: Equatable {
        case code(String)
        /// Strava's consent was declined (`access_denied`).
        case declined
        case failure(AuthError)
    }

    /// Interprets the app callback from `/api/v1/auth/mobile/callback`:
    /// either `code` and `state`, or an `error` code and `state`. Every
    /// outcome must carry the `state` this attempt sent, so a stale or forged
    /// callback can't end or complete a different attempt.
    static func parseCallback(_ url: URL, expectedState: String) -> CallbackResult {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let returnedState = value("state") else { return .failure(.missingCodeOrState) }
        // Client-side CSRF check, in addition to the server checking `state`
        // again during the exchange.
        guard returnedState == expectedState else { return .failure(.stateMismatch) }
        if let error = value("error") {
            return error == "access_denied"
                ? .declined
                : .failure(.provider(code: error, requestID: value("request_id")))
        }
        guard let code = value("code") else { return .failure(.missingCodeOrState) }
        return .code(code)
    }

    private static func revokeAbandoned(_ token: String) {
        Task.detached {
            _ = try? await APIClient.post(
                "/api/v1/auth/logout", bearerToken: token, as: JSONValue.self)
        }
    }

    /// Short copy for a session that could not be confirmed. Diagnostics stay
    /// out of the product UI, apart from a request ID worth quoting.
    static func userMessage(for error: Error) -> String {
        guard let error = error as? APIClient.RequestError else {
            return "Something went wrong while checking your session. Try again."
        }
        switch error {
        case .transport:
            return "ActivityMap couldn’t be reached. Check your connection and try again."
        case .rateLimited(let retryAfter, _):
            return "ActivityMap is busy. Try again \(retryPhrase(retryAfter))."
        case .serviceUnavailable(let retryAfter, let requestID):
            return "ActivityMap is temporarily unavailable. Try again \(retryPhrase(retryAfter))."
                + (requestID.map { " Reference: \($0)" } ?? "")
        case .server(_, _, let status, let requestID, _, let retryAfter) where status == 429 || status >= 500:
            return "ActivityMap is temporarily unavailable. Try again \(retryPhrase(retryAfter))."
                + (requestID.map { " Reference: \($0)" } ?? "")
        case .schemaVersionMismatch:
            return "This version of ActivityMap needs an update to check your session."
        default:
            return "Something went wrong while checking your session. Try again."
        }
    }

    /// The server's `Retry-After`, if it sent one. Never invented here.
    static func retryAfter(_ error: Error) -> TimeInterval? {
        switch error as? APIClient.RequestError {
        case .rateLimited(let retryAfter, _): retryAfter
        case .serviceUnavailable(let retryAfter, _): retryAfter
        case .server(_, _, _, _, _, let retryAfter): retryAfter
        default: nil
        }
    }

    private static func retryPhrase(_ retryAfter: TimeInterval?) -> String {
        guard let retryAfter, retryAfter > 0 else { return "in a moment" }
        return "after " + Date().addingTimeInterval(retryAfter).formatted(date: .omitted, time: .shortened)
    }

    /// Revokes the session server-side first — so a leaked token can never be
    /// replayed even if the local clear below is somehow never reached — then
    /// clears the Keychain only once that revocation is confirmed (or the
    /// server reports the token already invalid). A transport failure or
    /// `5xx` instead leaves the token in place and reports
    /// `.signOutFailed`: clearing it anyway would abandon a still-valid
    /// server session with no copy of the token left to retry revoking it.
    func signOut() async {
        guard !signingOut else { return }
        signingOut = true
        defer { signingOut = false }
        revision += 1
        currentUser = nil // Hide data and stop sync as soon as sign-out starts.
        guard let token = SessionStore.load() else {
            SessionIdentityStore.clear()
            status = .signedOut
            return
        }
        do {
            _ = try await APIClient.post(
                "/api/v1/auth/logout", bearerToken: token, as: JSONValue.self)
            SessionStore.clear()
            SessionIdentityStore.clear()
            status = .signedOut
        } catch {
            if Self.isExplicitlyUnauthenticated(error) {
                // Nothing left to revoke server-side either way.
                SessionStore.clear()
                SessionIdentityStore.clear()
                status = .signedOut
            } else {
                status = .signOutFailed(Self.signOutMessage(for: error))
            }
        }
    }

    private static func signOutMessage(for error: Error) -> String {
        if case .transport = error as? APIClient.RequestError {
            return "ActivityMap couldn’t be reached, so you’re still signed in. Check your connection and try again."
        }
        return "ActivityMap couldn’t confirm the sign-out, so you’re still signed in. Try again."
    }

    /// True only for a server response that explicitly rejected the
    /// credential (`401`, `not_authenticated`) — never for a transport
    /// failure, timeout, decode error, or any other status, which must not
    /// be treated as equivalent to "this token is invalid". Left internal
    /// rather than private, like `APIClient.decodeResult`, so it can be
    /// exercised directly against crafted errors without a live server.
    static func isExplicitlyUnauthenticated(_ error: Error) -> Bool {
        if case .unexpectedStatus(401) = error as? APIClient.RequestError { return true }
        guard case .server(let code, _, let status, _, _, _) = error as? APIClient.RequestError
        else {
            return false
        }
        return status == 401 || code == "not_authenticated"
    }

    // MARK: - ASWebAuthenticationSession

    private func presentAuthSession(startingAt url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: APIConfiguration.authCallbackScheme
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: AuthError.missingCodeOrState)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session

            // `start()` returns false (without ever calling the completion
            // handler above) when the session cannot begin at all - e.g. no
            // presentation context. Without this guard the continuation
            // would never resume and signIn() would hang on "Signing in…"
            // forever.
            guard session.start() else {
                self.authSession = nil
                continuation.resume(throwing: AuthError.sessionFailedToStart)
                return
            }
        }
    }

    // MARK: - PKCE

    private static func randomURLSafeString(byteCount: Int = 32) throws -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        // A failure here leaves `bytes` all-zero; encoding that anyway would
        // make `state`/the PKCE verifier predictable instead of random, so
        // this must fail closed rather than continue with the buffer.
        guard status == errSecSuccess else {
            throw AuthError.secureRandomUnavailable(status)
        }
        return Data(bytes).base64URLEncodedString()
    }

    /// RFC 7636 PKCE "S256" challenge derivation, matching
    /// `computeS256PkceChallenge` in `~/server/auth/mobile.ts`
    /// (`sha256(verifier).digest('base64url')`).
    private static func s256Challenge(forVerifier verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest).base64URLEncodedString()
    }
}

extension AuthController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if canImport(UIKit)
        let windowScenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = windowScenes.first { $0.activationState == .foregroundActive } ?? windowScenes.first
        if let window = scene?.windows.first(where: \.isKeyWindow) ?? scene?.windows.first {
            return window
        }
        #endif
        return ASPresentationAnchor()
    }
}

extension Data {
    fileprivate func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

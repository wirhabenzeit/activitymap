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
/// How a sign-in reaches the installed Strava app (issue #305). The system
/// implementation asks UIKit; tests supply their own.
struct StravaAppLauncher {
    /// Whether the Strava app is installed (a `canOpenURL` probe on its scheme).
    var isInstalled: @MainActor () -> Bool
    /// Opens the app at a `strava://` URL; `false` when it could not be opened.
    var open: @MainActor (URL) async -> Bool

    static let unavailable = StravaAppLauncher(isInstalled: { false }, open: { _ in false })

    #if canImport(UIKit)
    static let system = StravaAppLauncher(
        isInstalled: { UIApplication.shared.canOpenURL(AuthController.stravaAppProbeURL) },
        open: { await UIApplication.shared.open($0, options: [:]) })
    #else
    static let system = unavailable
    #endif
}

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
    private(set) var signingOut = false
    private(set) var deletingAccount = false

    /// Strava's documented installed-app authorization route. Only its scheme
    /// matters to the probe; `strava` must be in `LSApplicationQueriesSchemes`.
    nonisolated static let stravaAppProbeURL = URL(string: "strava://oauth/mobile/authorize")!

    private let stravaApp: StravaAppLauncher
    private let apiSession: URLSession
    /// How long to wait for Strava's return after the app comes back to the
    /// foreground. A return is delivered around that moment; none within the
    /// grace means the person came back without approving.
    private let stravaReturnGrace: Duration
    /// The longest a sign-in may wait in the Strava app (the server's attempt
    /// lifetime).
    private let stravaReturnTimeout: Duration
    /// Set when an installed-app sign-in failed after Strava was opened, so the
    /// next attempt uses the web sign-in rather than repeating the failure.
    private var stravaAppHandoffFailed = false
    private var pendingStravaReturn: PendingStravaReturn?
    private var stravaReturnTimeoutTask: Task<Void, Never>?

    init(
        stravaApp: StravaAppLauncher = .system,
        session: URLSession = .shared,
        stravaReturnGrace: Duration = .seconds(2),
        stravaReturnTimeout: Duration = .seconds(600)
    ) {
        self.stravaApp = stravaApp
        self.apiSession = session
        self.stravaReturnGrace = stravaReturnGrace
        self.stravaReturnTimeout = stravaReturnTimeout
        super.init()
        #if DEBUG
        // The real-shell rotation fixture must not restore a device session or avatar.
        if ProcessInfo.processInfo.arguments.contains("--map-rotation-ui-testing") { return }
        #endif
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
        abandonPendingStravaReturn()
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
        guard !signingOut, !deletingAccount else { return }
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

    /// Runs the full flow end to end, then stores the bearer token and hands
    /// off to `restoreSession()` to confirm it and report `status`.
    ///
    /// The sign-in goes through the installed Strava app when there is one and
    /// the server offers it (`signInThroughStravaApp`), and otherwise through
    /// the hosted `ASWebAuthenticationSession` sheet
    /// (`signInThroughWebSession`). Each generates its own `state` and PKCE
    /// verifier/challenge, and only one attempt is ever in flight.
    ///
    /// That handoff matters once the token is actually saved: at that point
    /// authentication has already succeeded and persisted, so a timeout or
    /// `5xx` on the confirming `/api/v1/me` call must not be treated as a
    /// sign-in failure whose retry starts a whole new OAuth round trip —
    /// `restoreSession()` already draws that 401-versus-transient
    /// distinction and gives a transient failure the right retry (itself,
    /// not a fresh `signIn()`).
    func signIn() async {
        guard !signingOut, !deletingAccount else { return }
        // Repeated taps while the hosted sheet is opening start nothing new.
        guard status != .signingIn else { return }
        revision += 1
        // A return still awaited from an earlier attempt belongs to it, not to
        // this one.
        abandonPendingStravaReturn()
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
        // A handoff that failed last time is not repeated: use the web sign-in.
        let tryStravaApp = !stravaAppHandoffFailed
        stravaAppHandoffFailed = false
        do {
            let handoff: StravaAppOutcome = tryStravaApp
                ? try await signInThroughStravaApp(forceConsent: reviewPermissions, attempt: attempt)
                : .unavailable

            let exchange: ActivityMapAPI.MobileExchangeResponse
            switch handoff {
            case .session(let response):
                exchange = response
            case .declined, .abandoned:
                // Declining in Strava, or coming back without approving, is the
                // person's choice, like closing the sheet: return quietly.
                guard attempt == revision else { return }
                status = .signedOut
                return
            case .unavailable:
                // No Strava app, or it could not be used: the system web
                // sign-in, with its own fresh state and PKCE pair.
                guard let response = try await signInThroughWebSession(
                    reviewPermissions: reviewPermissions, attempt: attempt)
                else { return }
                exchange = response
            }
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

    // MARK: - System web sign-in

    /// The hosted `ASWebAuthenticationSession` flow: generate `state` and a PKCE
    /// verifier/challenge, open the sign-in sheet, and exchange the one-time
    /// code it returns. `nil` when the person declined or the attempt was
    /// superseded (status is already settled).
    private func signInThroughWebSession(
        reviewPermissions: Bool, attempt: Int
    ) async throws -> ActivityMapAPI.MobileExchangeResponse? {
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
        guard attempt == revision else { return nil }

        let code: String
        switch Self.parseCallback(callbackURL, expectedState: state) {
        case .code(let value):
            code = value
        case .declined:
            // Declining on Strava's consent screen is the person's
            // choice, like closing the sheet: return quietly.
            status = .signedOut
            return nil
        case .failure(let error):
            throw error
        }

        return try await APIClient.post(
            "/api/v1/auth/mobile/exchange",
            body: ActivityMapAPI.MobileExchangeRequest(
                code: code, pkceVerifier: verifier, state: state),
            session: apiSession,
            as: ActivityMapAPI.MobileExchangeResponse.self)
    }

    // MARK: - Installed Strava app (issue #305)

    enum StravaAppOutcome {
        case session(ActivityMapAPI.MobileExchangeResponse)
        /// Strava's consent was declined in the Strava app.
        case declined
        /// The person came back without approving, or the attempt was superseded.
        case abandoned
        /// Strava is not installed or could not be used: fall back to the web.
        case unavailable
    }

    /// What Strava's app returns: `code` and the `scope` actually approved, or
    /// an error. Every outcome must carry the `state` this attempt sent.
    enum StravaAppReturn: Equatable {
        case code(String, scope: String?)
        case declined
        case failure(AuthError)
    }

    private enum StravaReturnResult {
        case url(URL)
        /// iOS could not open the Strava app.
        case openFailed
        case abandoned
    }

    private struct PendingStravaReturn {
        let state: String
        let continuation: CheckedContinuation<StravaReturnResult, Never>
    }

    /// Hands the sign-in to the installed Strava app and completes it with what
    /// the app returns. Strava returns to the *app*, not to a browser, so none
    /// of the web flow's cookies exist: the server registers this attempt
    /// (`state` and PKCE challenge) first and redeems it, with the verifier,
    /// only once, when the code comes back. The client secret never leaves the
    /// server, and a code taken from a hijacked redirect is useless without
    /// the verifier that stays here.
    ///
    /// Anything that goes wrong *before* Strava is opened (not installed, the
    /// handoff is unavailable on the server, offline, iOS refusing to open it)
    /// returns `.unavailable`, and the caller uses the web sign-in. A failure
    /// *after* that surfaces as an error, and the next attempt uses the web.
    func signInThroughStravaApp(
        forceConsent: Bool, attempt: Int
    ) async throws -> StravaAppOutcome {
        guard stravaApp.isInstalled() else { return .unavailable }

        let state = try Self.randomURLSafeString()
        let verifier = try Self.randomURLSafeString()
        let challenge = Self.s256Challenge(forVerifier: verifier)

        let registration: ActivityMapAPI.StravaAppAttemptResponse
        do {
            registration = try await APIClient.post(
                "/api/v1/auth/mobile/strava/attempt",
                body: ActivityMapAPI.StravaAppAttemptRequest(
                    state: state, codeChallenge: challenge, forceConsent: forceConsent ? true : nil),
                session: apiSession,
                as: ActivityMapAPI.StravaAppAttemptResponse.self)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // Not configured here (503), offline or failing: the web sign-in
            // works without any of it.
            return .unavailable
        }
        guard attempt == revision else { return .abandoned }
        guard let url = URL(string: registration.authorizationUrl), url.scheme == "strava" else {
            return .unavailable
        }

        switch await awaitStravaReturn(state: state, opening: url) {
        case .openFailed:
            return .unavailable
        case .abandoned:
            return .abandoned
        case .url(let returned):
            guard attempt == revision else { return .abandoned }
            do {
                switch Self.parseStravaAppReturn(returned, expectedState: state) {
                case .declined:
                    return .declined
                case .failure(let error):
                    throw error
                case .code(let code, let scope):
                    return .session(try await APIClient.post(
                        "/api/v1/auth/mobile/strava/complete",
                        body: ActivityMapAPI.StravaAppCompleteRequest(
                            code: code, scope: scope, state: state, pkceVerifier: verifier),
                        session: apiSession,
                        as: ActivityMapAPI.MobileExchangeResponse.self))
                }
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                stravaAppHandoffFailed = true
                throw error
            }
        }
    }

    /// Interprets the URL the Strava app opened: `code` and `scope`, or an
    /// `error`. A missing or different `state` is never accepted, so a stale or
    /// forged return can't end or complete another attempt.
    static func parseStravaAppReturn(_ url: URL, expectedState: String) -> StravaAppReturn {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let returnedState = value("state") else { return .failure(.missingCodeOrState) }
        guard returnedState == expectedState else { return .failure(.stateMismatch) }
        if let error = value("error") {
            return error == "access_denied" ? .declined : .failure(.provider(code: error, requestID: nil))
        }
        guard let code = value("code"), !code.isEmpty else { return .failure(.missingCodeOrState) }
        return .code(code, scope: value("scope"))
    }

    private func awaitStravaReturn(state: String, opening url: URL) async -> StravaReturnResult {
        await withCheckedContinuation { continuation in
            pendingStravaReturn = PendingStravaReturn(state: state, continuation: continuation)
            stravaReturnTimeoutTask = Task { [weak self, stravaReturnTimeout] in
                try? await Task.sleep(for: stravaReturnTimeout)
                guard !Task.isCancelled else { return }
                self?.resolveStravaReturn(.abandoned, state: state)
            }
            Task { [weak self, stravaApp] in
                if await stravaApp.open(url) == false {
                    self?.resolveStravaReturn(.openFailed, state: state)
                }
            }
        }
    }

    private func resolveStravaReturn(_ result: StravaReturnResult, state: String) {
        guard let pending = pendingStravaReturn, pending.state == state else { return }
        pendingStravaReturn = nil
        stravaReturnTimeoutTask?.cancel()
        stravaReturnTimeoutTask = nil
        pending.continuation.resume(returning: result)
    }

    private func abandonPendingStravaReturn() {
        if let pending = pendingStravaReturn { resolveStravaReturn(.abandoned, state: pending.state) }
    }

    /// Receives a URL the app was opened with, such as the return from the
    /// Strava app (a universal link on a device, a custom scheme elsewhere).
    /// Returns whether it was that return. One that matches no attempt
    /// awaiting it (a cold start after the app was killed in Strava, a
    /// duplicate or stale delivery, or a forged link) is ignored and leaves a
    /// waiting attempt untouched.
    @discardableResult
    func handleOpenURL(_ url: URL) -> Bool {
        guard APIConfiguration.isStravaAppReturn(url) else { return false }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let pending = pendingStravaReturn,
              items.first(where: { $0.name == "state" })?.value == pending.state
        else { return true }
        resolveStravaReturn(.url(url), state: pending.state)
        return true
    }

    /// The app came back to the foreground. If a sign-in is waiting in the
    /// Strava app and no return arrives within the grace period, the person
    /// came back without approving (the back button, or closing Strava).
    func applicationDidBecomeActive() {
        guard let state = pendingStravaReturn?.state else { return }
        Task { [weak self, stravaReturnGrace] in
            try? await Task.sleep(for: stravaReturnGrace)
            self?.resolveStravaReturn(.abandoned, state: state)
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
        let facts = error.facts
        switch error {
        case .transport:
            return "ActivityMap couldn’t be reached. Check your connection and try again."
        case .rateLimited:
            return "ActivityMap is busy. Try again \(retryPhrase(facts.retryAfter))."
        case .serviceUnavailable:
            return "ActivityMap is temporarily unavailable. Try again \(retryPhrase(facts.retryAfter))."
                + (facts.requestID.map { " Reference: \($0)" } ?? "")
        case .server(_, _, let status, _, _, _) where status == 429 || status >= 500:
            return "ActivityMap is temporarily unavailable. Try again \(retryPhrase(facts.retryAfter))."
                + (facts.requestID.map { " Reference: \($0)" } ?? "")
        case .schemaVersionMismatch:
            return "This version of ActivityMap needs an update to check your session."
        default:
            return "Something went wrong while checking your session. Try again."
        }
    }

    /// The server's `Retry-After`, if it sent one. Never invented here.
    static func retryAfter(_ error: Error) -> TimeInterval? {
        APIClient.errorFacts(for: error).retryAfter
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
        guard !signingOut, !deletingAccount else { return }
        signingOut = true
        defer { signingOut = false }
        revision += 1
        abandonPendingStravaReturn()
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

    /// Only a confirmed deletion clears the credential. Failures retain it so
    /// the person can retry; the server rechecks the session under its user lock.
    func deleteAccount() async throws {
        guard !signingOut, !deletingAccount, let token = SessionStore.load() else {
            throw APIClient.RequestError.unexpectedStatus(401)
        }
        deletingAccount = true
        revision += 1
        abandonPendingStravaReturn()
        let attempt = revision
        defer { deletingAccount = false }
        let result = try await APIClient.post(
            "/api/v1/account/delete",
            body: ActivityMapAPI.DeleteAccountRequest(confirmation: "DELETE"),
            bearerToken: token, as: ActivityMapAPI.DeleteAccountResult.self)
        guard result.status == "deleted" else {
            throw APIClient.RequestError.decoding("Account deletion was not confirmed.")
        }
        guard attempt == revision, SessionStore.load() == token else { return }
        SessionStore.clear()
        SessionIdentityStore.clear()
        currentUser = nil
        status = .signedOut
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
        APIClient.errorFacts(for: error).authenticationRejected
    }

    // MARK: - ASWebAuthenticationSession

    private func presentAuthSession(startingAt url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let finish: (URL?, Error?) -> Void = { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: AuthError.missingCodeOrState)
                }
            }
            // A device returns through an https universal link that only this
            // app can receive; a custom scheme (simulator, Dev) could be
            // claimed by any installed app (issue #482).
            let session: ASWebAuthenticationSession
            switch APIConfiguration.authCallback {
            case .customScheme(let scheme):
                session = ASWebAuthenticationSession(
                    url: url, callbackURLScheme: scheme, completionHandler: finish)
            case .https(let host, let path):
                session = ASWebAuthenticationSession(
                    url: url, callback: .https(host: host, path: path), completionHandler: finish)
            }
            session.presentationContextProvider = self
            // Each explicit sign-in allows choosing an account instead of
            // silently restoring retained Strava browser authentication.
            session.prefersEphemeralWebBrowserSession = true
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

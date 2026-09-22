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
        case signingIn
        case signedIn(ActivityMapAPI.CurrentUser)
        /// `restoreSession()` found a Keychain token but could not confirm it
        /// — a transport failure, timeout, `5xx`/`429`, or a decode error,
        /// anything short of the server explicitly rejecting the token. The
        /// token is left in the Keychain; retry with `restoreSession()`
        /// rather than starting a fresh sign-in, since the stored token may
        /// still be perfectly valid.
        case sessionRestoreFailed(String)
        /// `signOut()` could not confirm the server revoked the session — a
        /// transport failure, timeout, or `5xx`. The Keychain token is left
        /// in place: deleting the only copy here would leave a still-valid
        /// server session with nothing left to retry revocation with. Retry
        /// with `signOut()`.
        case signOutFailed(String)
        case failed(String)
    }

    enum AuthError: Error, CustomStringConvertible {
        case missingCodeOrState
        case stateMismatch
        case sessionFailedToStart
        case secureRandomUnavailable(OSStatus)

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
            }
        }
    }

    private(set) var status: Status = .signedOut

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
        guard let token = SessionStore.load() else { return }
        do {
            let user = try await APIClient.get(
                "/api/v1/me", bearerToken: token, as: ActivityMapAPI.CurrentUser.self)
            status = .signedIn(user)
        } catch {
            if Self.isExplicitlyUnauthenticated(error) {
                SessionStore.clear()
                status = .signedOut
            } else {
                status = .sessionRestoreFailed(String(describing: error))
            }
        }
    }

    /// Runs the full flow end to end: generate `state` and a PKCE
    /// verifier/challenge, open the hosted sign-in sheet, exchange the
    /// resulting one-time code, store the bearer token, then fetch
    /// `/api/v1/me` to prove the new session actually works before reporting
    /// success.
    func signIn() async {
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
            guard let url = startURL.url else { throw AuthError.missingCodeOrState }

            let callbackURL = try await presentAuthSession(startingAt: url)

            guard
                let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
                let returnedState = components.queryItems?.first(where: { $0.name == "state" })?
                    .value
            else {
                throw AuthError.missingCodeOrState
            }
            // Client-side CSRF check, in addition to the server checking
            // `state` again during the exchange below.
            guard returnedState == state else { throw AuthError.stateMismatch }

            let exchange = try await APIClient.post(
                "/api/v1/auth/mobile/exchange",
                body: ActivityMapAPI.MobileExchangeRequest(
                    code: code, pkceVerifier: verifier, state: state),
                as: ActivityMapAPI.MobileExchangeResponse.self)

            try SessionStore.save(exchange.sessionToken)

            let user = try await APIClient.get(
                "/api/v1/me", bearerToken: exchange.sessionToken,
                as: ActivityMapAPI.CurrentUser.self)
            status = .signedIn(user)
        } catch is CancellationError {
            // Swift-level task cancellation; not a failure to report.
            status = .signedOut
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // The person dismissed the sign-in sheet themselves. This is the
            // ordinary "changed their mind" path, not an error.
            status = .signedOut
        } catch {
            status = .failed(String(describing: error))
        }
    }

    /// Revokes the session server-side first — so a leaked token can never be
    /// replayed even if the local clear below is somehow never reached — then
    /// clears the Keychain only once that revocation is confirmed (or the
    /// server reports the token already invalid). A transport failure or
    /// `5xx` instead leaves the token in place and reports
    /// `.signOutFailed`: clearing it anyway would abandon a still-valid
    /// server session with no copy of the token left to retry revoking it.
    func signOut() async {
        guard let token = SessionStore.load() else {
            status = .signedOut
            return
        }
        do {
            _ = try await APIClient.post(
                "/api/v1/auth/logout", bearerToken: token, as: JSONValue.self)
            SessionStore.clear()
            status = .signedOut
        } catch {
            if Self.isExplicitlyUnauthenticated(error) {
                // Nothing left to revoke server-side either way.
                SessionStore.clear()
                status = .signedOut
            } else {
                status = .signOutFailed(String(describing: error))
            }
        }
    }

    /// True only for a server response that explicitly rejected the
    /// credential (`401`, `not_authenticated`) — never for a transport
    /// failure, timeout, decode error, or any other status, which must not
    /// be treated as equivalent to "this token is invalid". Left internal
    /// rather than private, like `APIClient.decodeResult`, so it can be
    /// exercised directly against crafted errors without a live server.
    static func isExplicitlyUnauthenticated(_ error: Error) -> Bool {
        guard case .server(let code, _, let status, _, _) = error as? APIClient.RequestError
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

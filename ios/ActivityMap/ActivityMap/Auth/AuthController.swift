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
        case failed(String)
    }

    enum AuthError: Error, CustomStringConvertible {
        case missingCodeOrState
        case stateMismatch

        var description: String {
            switch self {
            case .missingCodeOrState:
                "The sign-in callback was missing its code or state."
            case .stateMismatch:
                "The sign-in callback did not match the request that started it."
            }
        }
    }

    private(set) var status: Status = .signedOut

    /// Retained only for the duration of one sign-in attempt; `start()` needs
    /// its session kept alive, and there is nothing to keep once it finishes.
    private var authSession: ASWebAuthenticationSession?

    /// Attempts to resume a session already stored in the Keychain. Call once
    /// at launch. A missing or rejected token leaves `status` at
    /// `.signedOut` rather than `.failed`: there is nothing actionable for
    /// someone who has simply never signed in, and a stale token looks the
    /// same to them as never having signed in at all.
    func restoreSession() async {
        guard let token = SessionStore.load() else { return }
        do {
            let user = try await APIClient.get(
                "/api/v1/me", bearerToken: token, as: ActivityMapAPI.CurrentUser.self)
            status = .signedIn(user)
        } catch {
            SessionStore.clear()
            status = .signedOut
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
            let state = Self.randomURLSafeString()
            let verifier = Self.randomURLSafeString()
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
            // The person dismissed the sign-in sheet; not a failure to report.
            status = .signedOut
        } catch {
            status = .failed(String(describing: error))
        }
    }

    /// Revokes the session server-side first — so a leaked token can never be
    /// replayed even if the local clear below is somehow never reached — then
    /// clears the Keychain regardless of whether the network call succeeded.
    func signOut() async {
        if let token = SessionStore.load() {
            _ = try? await APIClient.post(
                "/api/v1/auth/logout", bearerToken: token, as: JSONValue.self)
        }
        SessionStore.clear()
        status = .signedOut
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
            session.start()
        }
    }

    // MARK: - PKCE

    private static func randomURLSafeString(byteCount: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        _ = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
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

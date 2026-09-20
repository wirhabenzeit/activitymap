// ActivityMapMobileAuthTestClient.swift
//
// Minimal iOS test client for issue #121 ("Implement secure mobile
// authentication and session revocation"): signs in through
// ActivityMap's mobile OAuth exchange flow and calls `GET /api/v1/me`.
//
// IMPORTANT - sandbox disclosure: this file was written in an environment
// with no Swift toolchain, no Xcode, and no network access to
// developers.apple.com/download.swift.org, so it has NOT been compiled or
// run. It is a best-effort, clearly-labeled artifact matching the flow
// documented in docs/swiftui-backend-preparation-plan.md
// ("Authentication design") and implemented server-side by
// `~/server/auth/mobile.ts` and the `/api/v1/auth/mobile/*` routes in this
// PR. It needs to be dropped into an actual iOS app target (or a small
// SwiftPM executable target with the right entitlements/Associated
// Domains for the universal link) and verified there - see the "What
// would still need real iOS/Xcode tooling to verify" note in the PR
// description for exactly what that verification covers.
//
// Flow implemented here, matching the plan doc:
//   1. Generate `state` and a PKCE verifier/challenge (S256).
//   2. Open `ASWebAuthenticationSession` on
//      `/api/v1/auth/mobile/start?state=...&code_challenge=...&redirect_uri=...`.
//   3. ActivityMap runs the existing Strava OAuth flow server-side and
//      redirects back to the allow-listed universal link with a one-time
//      `code` and the original `state`.
//   4. Exchange that code (plus the PKCE verifier and `state`) at
//      `POST /api/v1/auth/mobile/exchange` for an ActivityMap bearer
//      session token.
//   5. Store the token in the Keychain; send it as
//      `Authorization: Bearer <token>` on `GET /api/v1/me`.

import AuthenticationServices
import CryptoKit
import Foundation
#if canImport(SwiftUI)
  import SwiftUI
#endif

// MARK: - Configuration

enum ActivityMapMobileAuthConfig {
  /// The ActivityMap deployment to authenticate against.
  static let baseURL = URL(string: "https://activitymap.example")!

  /// Must be one of the entries in the server's
  /// `MOBILE_AUTH_REDIRECT_ALLOWLIST` env var, and registered as an
  /// Associated Domain / universal link for this app.
  static let redirectURI = "https://activitymap.example/auth/mobile-callback"

  /// The custom URL scheme `ASWebAuthenticationSession` watches for, if a
  /// universal link is not used for local testing (Apple recommends a
  /// universal link over a custom scheme for this flow where possible -
  /// see the plan doc's "Authentication design").
  static let callbackURLScheme = "https"
}

// MARK: - PKCE

enum PKCE {
  static func randomURLSafeString(byteCount: Int = 32) -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    _ = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
    return Data(bytes).base64URLEncodedString()
  }

  /// RFC 7636 PKCE "S256" challenge derivation, matching
  /// `computeS256PkceChallenge` in `~/server/auth/mobile.ts`.
  static func s256Challenge(forVerifier verifier: String) -> String {
    let digest = SHA256.hash(data: Data(verifier.utf8))
    return Data(digest).base64URLEncodedString()
  }
}

extension Data {
  func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

// MARK: - Keychain storage

/// Stores the ActivityMap bearer session token - never a Strava
/// credential - in the Keychain. See the plan doc's exit criterion: "the
/// Keychain contains an ActivityMap credential, not a Strava credential".
enum SessionTokenKeychain {
  private static let service = "com.activitymap.mobile-auth-test-client"
  private static let account = "activitymap-session-token"

  static func save(_ token: String) throws {
    let data = Data(token.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)

    var attributes = query
    attributes[kSecValueData as String] = data
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw MobileAuthTestClientError.keychainWriteFailed(status)
    }
  }

  static func load() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func clear() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }
}

enum MobileAuthTestClientError: Error {
  case authSessionFailed(Error)
  case missingCodeOrState
  case stateMismatch
  case exchangeFailed(statusCode: Int, body: String)
  case meRequestFailed(statusCode: Int, body: String)
  case keychainWriteFailed(OSStatus)
}

// MARK: - Wire types (mirrors src/contracts/v1/mobile-auth.ts and user.ts)

struct MobileExchangeRequestBody: Encodable {
  let code: String
  let pkceVerifier: String
  let state: String
}

struct MobileExchangeResponseEnvelope: Decodable {
  struct Data: Decodable {
    let sessionToken: String
    let tokenType: String
    let sessionExpiresAt: String
  }
  let schemaVersion: String
  let serverTime: String
  let data: Data
}

struct CurrentUserResponseEnvelope: Decodable {
  struct Authentication: Decodable {
    let method: String
    let sessionExpiresAt: String
  }
  struct Data: Decodable {
    let id: String
    let name: String?
    let email: String?
    let athleteId: String
    let stravaConnected: Bool
    let authentication: Authentication
  }
  let schemaVersion: String
  let serverTime: String
  let data: Data
}

// MARK: - Auth client

@MainActor
final class MobileAuthTestClient: NSObject, ASWebAuthenticationPresentationContextProviding {
  private var authSession: ASWebAuthenticationSession?

  /// Runs the full flow: opens the sign-in sheet, exchanges the resulting
  /// code, and stores the bearer token. Call `fetchCurrentUser()`
  /// afterwards to prove it works end to end.
  func signIn() async throws {
    let state = PKCE.randomURLSafeString()
    let verifier = PKCE.randomURLSafeString()
    let challenge = PKCE.s256Challenge(forVerifier: verifier)

    var startURL = URLComponents(
      url: ActivityMapMobileAuthConfig.baseURL.appendingPathComponent(
        "/api/v1/auth/mobile/start"),
      resolvingAgainstBaseURL: false)!
    startURL.queryItems = [
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "code_challenge", value: challenge),
      URLQueryItem(name: "redirect_uri", value: ActivityMapMobileAuthConfig.redirectURI),
    ]

    let callbackURL = try await presentAuthSession(startingAt: startURL.url!)

    guard
      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
      let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
      let returnedState = components.queryItems?.first(where: { $0.name == "state" })?.value
    else {
      throw MobileAuthTestClientError.missingCodeOrState
    }

    // Client-side CSRF check, in addition to the server checking `state`
    // again during the exchange below.
    guard returnedState == state else {
      throw MobileAuthTestClientError.stateMismatch
    }

    let sessionToken = try await exchange(code: code, verifier: verifier, state: state)
    try SessionTokenKeychain.save(sessionToken)
  }

  /// Calls `POST /api/v1/auth/logout` to revoke the session server-side
  /// (so the token can never be used again, even if it leaked), then
  /// clears the local Keychain copy either way.
  func logOut() async {
    defer { SessionTokenKeychain.clear() }
    guard let token = SessionTokenKeychain.load() else { return }

    var request = URLRequest(
      url: ActivityMapMobileAuthConfig.baseURL.appendingPathComponent("/api/v1/auth/logout"))
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    _ = try? await URLSession.shared.data(for: request)
  }

  /// Proves the exit criterion: "a fresh iOS installation can sign in and
  /// call an authenticated endpoint".
  func fetchCurrentUser() async throws -> CurrentUserResponseEnvelope {
    guard let token = SessionTokenKeychain.load() else {
      throw MobileAuthTestClientError.missingCodeOrState
    }

    var request = URLRequest(
      url: ActivityMapMobileAuthConfig.baseURL.appendingPathComponent("/api/v1/me"))
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

    let (data, response) = try await URLSession.shared.data(for: request)
    let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
    guard statusCode == 200 else {
      throw MobileAuthTestClientError.meRequestFailed(
        statusCode: statusCode, body: String(data: data, encoding: .utf8) ?? "")
    }

    return try JSONDecoder().decode(CurrentUserResponseEnvelope.self, from: data)
  }

  private func exchange(code: String, verifier: String, state: String) async throws -> String {
    var request = URLRequest(
      url: ActivityMapMobileAuthConfig.baseURL.appendingPathComponent(
        "/api/v1/auth/mobile/exchange"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(
      MobileExchangeRequestBody(code: code, pkceVerifier: verifier, state: state))

    let (data, response) = try await URLSession.shared.data(for: request)
    let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
    guard statusCode == 200 else {
      throw MobileAuthTestClientError.exchangeFailed(
        statusCode: statusCode, body: String(data: data, encoding: .utf8) ?? "")
    }

    let decoded = try JSONDecoder().decode(MobileExchangeResponseEnvelope.self, from: data)
    return decoded.data.sessionToken
  }

  private func presentAuthSession(startingAt url: URL) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      let session = ASWebAuthenticationSession(
        url: url,
        callbackURLScheme: ActivityMapMobileAuthConfig.callbackURLScheme
      ) { callbackURL, error in
        if let error {
          continuation.resume(throwing: MobileAuthTestClientError.authSessionFailed(error))
        } else if let callbackURL {
          continuation.resume(returning: callbackURL)
        } else {
          continuation.resume(throwing: MobileAuthTestClientError.missingCodeOrState)
        }
      }
      session.presentationContextProvider = self
      session.prefersEphemeralWebBrowserSession = false
      self.authSession = session
      session.start()
    }
  }

  nonisolated func presentationAnchor(for session: ASWebAuthenticationSession)
    -> ASPresentationAnchor
  {
    ASPresentationAnchor()
  }
}

// MARK: - Minimal SwiftUI test view

#if canImport(SwiftUI)
  /// A minimal view to drive the flow manually during verification: tap
  /// "Sign in", complete Strava auth in the sheet, then tap "Call
  /// /api/v1/me". Not a real app screen - just enough to prove the flow
  /// end to end, per issue #121's "minimal iOS test client" ask.
  struct MobileAuthTestView: View {
    @State private var client = MobileAuthTestClient()
    @State private var statusText = "Not signed in"

    var body: some View {
      VStack(spacing: 16) {
        Text(statusText)
          .font(.body)
          .multilineTextAlignment(.center)

        Button("Sign in with Strava") {
          Task {
            do {
              try await client.signIn()
              statusText = "Signed in - token stored in Keychain"
            } catch {
              statusText = "Sign-in failed: \(error)"
            }
          }
        }

        Button("Call GET /api/v1/me") {
          Task {
            do {
              let me = try await client.fetchCurrentUser()
              statusText = "Signed in as \(me.data.name ?? me.data.id)"
            } catch {
              statusText = "Request failed: \(error)"
            }
          }
        }

        Button("Log out") {
          Task {
            await client.logOut()
            statusText = "Logged out (server session revoked, Keychain cleared)"
          }
        }
      }
      .padding()
    }
  }
#endif

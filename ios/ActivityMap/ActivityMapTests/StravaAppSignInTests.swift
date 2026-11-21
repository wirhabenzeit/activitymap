import CryptoKit
import Foundation
import Testing
@testable import ActivityMap

/// Separate from the other URL protocols so suites cannot race on one handler.
nonisolated final class StravaAppURLProtocol: URLProtocol, @unchecked Sendable {
    final class Box: @unchecked Sendable {
        let lock = NSLock()
        var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
        var requests: [URLRequest] = []
    }
    static let box = Box()
    static func setHandler(_ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)) {
        box.lock.lock(); defer { box.lock.unlock() }
        box.handler = handler
        box.requests = []
    }
    static var requests: [URLRequest] {
        box.lock.lock(); defer { box.lock.unlock() }; return box.requests
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.box.lock.lock()
        let handler = Self.box.handler
        Self.box.requests.append(request)
        Self.box.lock.unlock()
        do {
            let (response, data) = try handler!(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

/// Sign-in through the installed Strava app (issue #305): the handoff, the
/// return, and every way it can end or fall back.
@Suite(.serialized)
@MainActor
struct StravaAppSignInTests {
    private let redirect = APIConfiguration.stravaAppRedirectURI

    // MARK: Fakes

    @MainActor final class Strava {
        var installed = true
        var opens = true
        var opened: [URL] = []
        /// Runs when the Strava app is "opened", to deliver (or not) a return.
        var onOpen: (URL) -> Void = { _ in }
        var launcher: StravaAppLauncher {
            StravaAppLauncher(
                isInstalled: { self.installed },
                open: { url in
                    self.opened.append(url)
                    self.onOpen(url)
                    return self.opens
                })
        }
    }

    private nonisolated static func json(_ request: URLRequest, _ status: Int, _ body: String) -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                         headerFields: ["Content-Type": "application/json"])!, Data(body.utf8))
    }

    private nonisolated static func envelope(_ data: String) -> String {
        #"{"schemaVersion":"1","serverTime":"2026-11-21T10:00:00.000Z","data":\#(data)}"#
    }

    private nonisolated static func requestBody(_ request: URLRequest) -> [String: Any] {
        var data = request.httpBody
        if data == nil, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var collected = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                collected.append(buffer, count: count)
            }
            data = collected
        }
        return ((try? JSONSerialization.jsonObject(with: data ?? Data())) as? [String: Any]) ?? [:]
    }

    private nonisolated static func s256(_ verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// A server that registers attempts (answering with a Strava app URL that
    /// carries the attempt's state) and completes them.
    private func serve(
        attempt: @escaping @Sendable (URLRequest) -> (HTTPURLResponse, Data) = { request in
            let state = StravaAppSignInTests.requestBody(request)["state"] as? String ?? ""
            return StravaAppSignInTests.json(request, 200, StravaAppSignInTests.envelope(
                #"{"authorizationUrl":"strava://oauth/mobile/authorize?state=\#(state)","expiresAt":"2026-11-21T10:10:00.000Z"}"#))
        },
        complete: @escaping @Sendable (URLRequest) -> (HTTPURLResponse, Data) = { request in
            StravaAppSignInTests.json(request, 200, StravaAppSignInTests.envelope(
                #"{"sessionToken":"signed-token","tokenType":"Bearer","sessionExpiresAt":"2026-12-21T10:00:00.000Z"}"#))
        }
    ) -> URLSession {
        StravaAppURLProtocol.setHandler { request in
            switch request.url?.path {
            case "/api/v1/auth/mobile/strava/attempt": attempt(request)
            case "/api/v1/auth/mobile/strava/complete": complete(request)
            default: StravaAppSignInTests.json(request, 404, "{}")
            }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StravaAppURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func controller(
        _ strava: Strava, _ session: URLSession,
        grace: Duration = .milliseconds(40), timeout: Duration = .seconds(30)
    ) -> AuthController {
        AuthController(stravaApp: strava.launcher, session: session,
                       stravaReturnGrace: grace, stravaReturnTimeout: timeout)
    }

    private func paths() -> [String] { StravaAppURLProtocol.requests.compactMap { $0.url?.path } }

    private func returnURL(_ query: String) -> URL { URL(string: "\(redirect.absoluteString)?\(query)")! }

    /// What Strava's app does: open the redirect with the state it was given.
    private func approve(_ strava: Strava, auth: @escaping () -> AuthController, scope: String = "read,activity:read_all") {
        strava.onOpen = { url in
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "state" }?.value ?? ""
            Task { @MainActor in
                auth().handleOpenURL(self.returnURL("state=\(state)&code=strava-code&scope=\(scope)"))
            }
        }
    }

    // MARK: Return parsing

    @Test func aReturnWithTheRightStateCarriesTheCodeAndTheApprovedScope() {
        let url = returnURL("state=s1&code=c1&scope=read,activity:read")
        #expect(AuthController.parseStravaAppReturn(url, expectedState: "s1") == .code("c1", scope: "read,activity:read"))
        #expect(AuthController.parseStravaAppReturn(returnURL("state=s1&code=c1"), expectedState: "s1") == .code("c1", scope: nil))
    }

    @Test func decliningInTheStravaAppIsACancellationNotAFailure() {
        #expect(AuthController.parseStravaAppReturn(returnURL("state=s1&error=access_denied"), expectedState: "s1") == .declined)
    }

    @Test func aReturnForAnotherAttemptOrWithoutStateNeverCompletesThisOne() {
        #expect(AuthController.parseStravaAppReturn(returnURL("state=other&code=c1"), expectedState: "s1") == .failure(.stateMismatch))
        #expect(AuthController.parseStravaAppReturn(returnURL("code=c1"), expectedState: "s1") == .failure(.missingCodeOrState))
        #expect(AuthController.parseStravaAppReturn(returnURL("state=s1"), expectedState: "s1") == .failure(.missingCodeOrState))
        #expect(AuthController.parseStravaAppReturn(returnURL("state=s1&code="), expectedState: "s1") == .failure(.missingCodeOrState))
    }

    @Test func otherProviderErrorsKeepTheirCode() {
        #expect(AuthController.parseStravaAppReturn(returnURL("state=s1&error=server_error"), expectedState: "s1")
            == .failure(.provider(code: "server_error", requestID: nil)))
    }

    // MARK: Which URLs are the return

    @Test func onlyTheConfiguredRedirectIsTheStravaReturn() {
        let configured = URL(string: "https://activitymap.cc/auth/strava")!
        #expect(APIConfiguration.isStravaAppReturn(URL(string: "https://activitymap.cc/auth/strava?code=c&state=s")!, redirectURI: configured))
        #expect(APIConfiguration.isStravaAppReturn(URL(string: "HTTPS://ActivityMap.CC/auth/strava")!, redirectURI: configured))
        for other in ["https://activitymap.cc/auth/callback", "https://activitymap.cc/auth/strava/x",
                      "https://evil.example/auth/strava", "http://activitymap.cc/auth/strava", "activitymap://auth/strava"] {
            #expect(!APIConfiguration.isStravaAppReturn(URL(string: other)!, redirectURI: configured), Comment(rawValue: other))
        }
    }

    @Test func theSimulatorTestHostReturnsThroughTheCustomScheme() {
        #expect(APIConfiguration.stravaAppRedirectURI.absoluteString == "activitymap://auth/strava")
    }

    @Test func theSignInReturnIsNotTreatedAsTheStravaReturn() {
        let auth = AuthController(stravaApp: .unavailable)
        #expect(auth.handleOpenURL(URL(string: "activitymap://auth/callback?code=c&state=s")!) == false)
        #expect(auth.handleOpenURL(URL(string: "https://example.com")!) == false)
    }

    @Test func aReturnWithNoWaitingAttemptIsIgnored() {
        // Cold start after the app was killed in Strava, a duplicate or a stale delivery.
        let auth = AuthController(stravaApp: .unavailable)
        #expect(auth.handleOpenURL(returnURL("state=s1&code=c1")) == true)
        #expect(auth.status == .signedOut)
    }

    // MARK: The handoff

    @Test func withoutTheStravaAppNothingIsRegisteredAndTheWebSignInTakesOver() async throws {
        let strava = Strava(); strava.installed = false
        let session = serve()
        let outcome = try await controller(strava, session).signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .unavailable = outcome else { Issue.record("expected unavailable, got \(outcome)"); return }
        #expect(paths().isEmpty)
        #expect(strava.opened.isEmpty)
    }

    @Test func aServerWithoutTheHandoffFallsBackToTheWebSignIn() async throws {
        let strava = Strava()
        let session = serve(attempt: { request in
            StravaAppSignInTests.json(request, 503, #"{"error":{"code":"strava_app_sign_in_unavailable","message":"x","retryable":false,"requestId":"r1"}}"#)
        })
        let outcome = try await controller(strava, session).signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .unavailable = outcome else { Issue.record("expected unavailable, got \(outcome)"); return }
        #expect(strava.opened.isEmpty)
    }

    @Test func aNetworkFailureRegisteringTheAttemptFallsBackToTheWebSignIn() async throws {
        let strava = Strava()
        StravaAppURLProtocol.setHandler { _ in throw URLError(.notConnectedToInternet) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StravaAppURLProtocol.self]
        let outcome = try await controller(strava, URLSession(configuration: configuration))
            .signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .unavailable = outcome else { Issue.record("expected unavailable, got \(outcome)"); return }
    }

    @Test func aRefusedLaunchFallsBackToTheWebSignInWithoutWaiting() async throws {
        let strava = Strava(); strava.opens = false
        let outcome = try await controller(strava, serve(), timeout: .seconds(30))
            .signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .unavailable = outcome else { Issue.record("expected unavailable, got \(outcome)"); return }
        #expect(strava.opened.count == 1)
        #expect(paths() == ["/api/v1/auth/mobile/strava/attempt"])
    }

    @Test func aWrongSchemeFromTheServerIsNeverOpened() async throws {
        let strava = Strava()
        let session = serve(attempt: { request in
            StravaAppSignInTests.json(request, 200, StravaAppSignInTests.envelope(
                #"{"authorizationUrl":"https://evil.example/authorize","expiresAt":"2026-11-21T10:10:00.000Z"}"#))
        })
        let outcome = try await controller(strava, session).signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .unavailable = outcome else { Issue.record("expected unavailable, got \(outcome)"); return }
        #expect(strava.opened.isEmpty)
    }

    @Test func approvingInStravaCompletesWithTheVerifierThatMatchesTheRegisteredChallenge() async throws {
        let strava = Strava()
        var auth: AuthController!
        approve(strava, auth: { auth })
        auth = controller(strava, serve())

        let outcome = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .session(let response) = outcome else { Issue.record("expected a session, got \(outcome)"); return }
        #expect(response.sessionToken == "signed-token")

        #expect(paths() == ["/api/v1/auth/mobile/strava/attempt", "/api/v1/auth/mobile/strava/complete"])
        let attempt = Self.requestBody(StravaAppURLProtocol.requests[0])
        let complete = Self.requestBody(StravaAppURLProtocol.requests[1])
        #expect(attempt["forceConsent"] == nil)
        #expect(complete["code"] as? String == "strava-code")
        #expect(complete["scope"] as? String == "read,activity:read_all")
        #expect(complete["state"] as? String == attempt["state"] as? String)
        let verifier = try #require(complete["pkceVerifier"] as? String)
        #expect(Self.s256(verifier) == attempt["codeChallenge"] as? String)
        // The credential never travels with the attempt, and neither request is authenticated.
        #expect(attempt["pkceVerifier"] == nil)
        for request in StravaAppURLProtocol.requests { #expect(request.value(forHTTPHeaderField: "Authorization") == nil) }
    }

    @Test func reconnectingAsksStravaToShowItsConsentScreen() async throws {
        let strava = Strava()
        var auth: AuthController!
        approve(strava, auth: { auth })
        auth = controller(strava, serve())
        _ = try await auth.signInThroughStravaApp(forceConsent: true, attempt: 0)
        #expect(Self.requestBody(StravaAppURLProtocol.requests[0])["forceConsent"] as? Bool == true)
    }

    @Test func aReturnForAnotherAttemptIsIgnoredAndTheRealOneStillCompletes() async throws {
        let strava = Strava()
        var auth: AuthController!
        strava.onOpen = { url in
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value ?? ""
            Task { @MainActor in
                auth.handleOpenURL(self.returnURL("state=forged&code=attacker-code"))
                auth.handleOpenURL(self.returnURL("code=no-state"))
                auth.handleOpenURL(self.returnURL("state=\(state)&code=strava-code"))
            }
        }
        auth = controller(strava, serve())
        let outcome = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .session = outcome else { Issue.record("expected a session, got \(outcome)"); return }
        let complete = Self.requestBody(StravaAppURLProtocol.requests[1])
        #expect(complete["code"] as? String == "strava-code")
    }

    @Test func aDuplicateReturnAfterCompletionIsIgnored() async throws {
        let strava = Strava()
        var auth: AuthController!
        strava.onOpen = { url in
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value ?? ""
            Task { @MainActor in
                auth.handleOpenURL(self.returnURL("state=\(state)&code=strava-code"))
                auth.handleOpenURL(self.returnURL("state=\(state)&code=strava-code"))
            }
        }
        auth = controller(strava, serve())
        _ = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        #expect(paths().filter { $0.hasSuffix("/complete") }.count == 1)
    }

    @Test func decliningInStravaEndsQuietlyWithoutContactingTheServerAgain() async throws {
        let strava = Strava()
        var auth: AuthController!
        strava.onOpen = { url in
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value ?? ""
            Task { @MainActor in auth.handleOpenURL(self.returnURL("state=\(state)&error=access_denied")) }
        }
        auth = controller(strava, serve())
        let outcome = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .declined = outcome else { Issue.record("expected declined, got \(outcome)"); return }
        #expect(paths() == ["/api/v1/auth/mobile/strava/attempt"])
    }

    @Test func comingBackWithoutApprovingIsAbandonedAfterTheGracePeriod() async throws {
        let strava = Strava()
        var auth: AuthController!
        strava.onOpen = { _ in Task { @MainActor in auth.applicationDidBecomeActive() } }
        auth = controller(strava, serve(), grace: .milliseconds(30))
        let outcome = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .abandoned = outcome else { Issue.record("expected abandoned, got \(outcome)"); return }
        #expect(paths() == ["/api/v1/auth/mobile/strava/attempt"])
    }

    @Test func aReturnArrivingWithinTheGraceStillCompletes() async throws {
        let strava = Strava()
        var auth: AuthController!
        strava.onOpen = { url in
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value ?? ""
            Task { @MainActor in
                auth.applicationDidBecomeActive()
                try? await Task.sleep(for: .milliseconds(10))
                auth.handleOpenURL(self.returnURL("state=\(state)&code=strava-code"))
            }
        }
        auth = controller(strava, serve(), grace: .milliseconds(300))
        let outcome = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .session = outcome else { Issue.record("expected a session, got \(outcome)"); return }
    }

    @Test func aSignInLeftWaitingGivesUpAfterTheAttemptLifetime() async throws {
        let strava = Strava()
        let outcome = try await controller(strava, serve(), timeout: .milliseconds(60))
            .signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .abandoned = outcome else { Issue.record("expected abandoned, got \(outcome)"); return }
    }

    @Test func signingOutWhileWaitingEndsTheAttemptAndAFreshApprovalIsIgnored() async throws {
        let strava = Strava()
        var auth: AuthController!
        strava.onOpen = { _ in Task { @MainActor in await auth.signOut() } }
        auth = controller(strava, serve())
        let outcome = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        guard case .abandoned = outcome else { Issue.record("expected abandoned, got \(outcome)"); return }
        // Strava's approval arriving afterwards finds nothing waiting.
        let state = try #require(Self.requestBody(StravaAppURLProtocol.requests[0])["state"] as? String)
        #expect(auth.handleOpenURL(returnURL("state=\(state)&code=late")) == true)
        #expect(paths() == ["/api/v1/auth/mobile/strava/attempt"])
    }

    @Test func aCodeTheServerRejectsSurfacesAsAFailure() async throws {
        let strava = Strava()
        var auth: AuthController!
        approve(strava, auth: { auth })
        let session = serve(complete: { request in
            StravaAppSignInTests.json(request, 401, #"{"error":{"code":"strava_code_rejected","message":"x","retryable":false,"requestId":"r2"}}"#)
        })
        auth = controller(strava, session)
        await #expect(throws: (any Error).self) {
            _ = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        }
    }

    @Test func eachAttemptRegistersItsOwnStateAndChallenge() async throws {
        let strava = Strava()
        var auth: AuthController!
        approve(strava, auth: { auth })
        auth = controller(strava, serve())
        _ = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        _ = try await auth.signInThroughStravaApp(forceConsent: false, attempt: 0)
        let attempts = StravaAppURLProtocol.requests.filter { $0.url?.path.hasSuffix("/attempt") == true }
            .map { Self.requestBody($0) }
        #expect(attempts.count == 2)
        #expect(attempts[0]["state"] as? String != attempts[1]["state"] as? String)
        #expect(attempts[0]["codeChallenge"] as? String != attempts[1]["codeChallenge"] as? String)
    }
}

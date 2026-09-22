import Foundation
import Testing
@testable import ActivityMap

nonisolated final class SyncURLProtocol: URLProtocol, @unchecked Sendable {
    final class HandlerBox: @unchecked Sendable {
        let lock = NSLock()
        var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
    }
    static let box = HandlerBox()
    static func setHandler(_ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)) {
        box.lock.lock(); defer { box.lock.unlock() }; box.handler = handler
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.box.lock.lock(); let handler = Self.box.handler; Self.box.lock.unlock()
        do {
            let (response, data) = try handler!(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@Suite(.serialized)
@MainActor
struct SyncAPITests {
    @Test func realHTTPClientEscapesCursorsAndUnwrapsContractEnvelope() async throws {
        let cursor = "opaque+/=&? cursor"
        SyncURLProtocol.setHandler { request in
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
            #expect(components.path == "/api/v1/sync/changes")
            #expect(components.queryItems?.first?.value == cursor)
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret-for-test")
            #expect(!request.httpShouldHandleCookies)
            let json = """
            {"schemaVersion":"1","serverTime":"2026-09-22T00:00:00.000Z","data":{
              "items":[],"nextCursor":"next","retention":{"retentionDays":30,"cursorValidUntil":"2026-10-22T00:00:00.000Z"},
              "freshness":{"lastSummaryReconciledAt":null}}}
            """
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(json.utf8))
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SyncURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let api = SyncAPI(baseURL: Fixtures.scope.deployment, token: "secret-for-test", session: session)
        #expect(try await api.changes(cursor: cursor).nextCursor == "next")
    }

    @Test func retryAfterIsPreservedAndUnauthorizedWithoutEnvelopeIsRecognized() throws {
        let response = HTTPURLResponse(url: Fixtures.scope.deployment, statusCode: 429, httpVersion: nil,
                                       headerFields: ["Retry-After": "120", "X-Request-Id": "r"])!
        do {
            _ = try APIClient.decodeResult(data: Data(), httpResponse: response, as: JSONValue.self)
            Issue.record("Expected rate limit")
        } catch APIClient.RequestError.rateLimited(let delay, let requestID) {
            #expect(delay == 120 && requestID == "r")
        }
        #expect(AuthController.isExplicitlyUnauthenticated(APIClient.RequestError.unexpectedStatus(401)))
        #expect(!AuthController.isExplicitlyUnauthenticated(APIClient.RequestError.unexpectedStatus(500)))
    }

    @Test func persistedIdentityIsBoundToTokenAndDeployment() throws {
        let name = "activitymap-tests-\(UUID())"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let session = SyncFixtures.session()
        try SessionIdentityStore.save(session.user, token: session.token, deployment: session.deployment, defaults: defaults)
        #expect(SessionIdentityStore.load(token: session.token, deployment: session.deployment, defaults: defaults) == session.user)
        #expect(SessionIdentityStore.load(token: "other", deployment: session.deployment, defaults: defaults) == nil)
        #expect(SessionIdentityStore.load(token: session.token, deployment: URL(string: "http://localhost:3000")!, defaults: defaults) == nil)
        SessionIdentityStore.clear(defaults: defaults)
        #expect(SessionIdentityStore.load(token: session.token, deployment: session.deployment, defaults: defaults) == nil)
    }
}

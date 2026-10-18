import Foundation
import Testing
@testable import ActivityMap

nonisolated private final class ShareLinksURLProtocol: URLProtocol, @unchecked Sendable {
    private final class Box: @unchecked Sendable {
        let lock = NSLock()
        var requests: [URLRequest] = []
    }
    private static let box = Box()
    static var requests: [URLRequest] {
        box.lock.lock(); defer { box.lock.unlock() }; return box.requests
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.box.lock.lock(); Self.box.requests.append(request); Self.box.lock.unlock()
        let json: String
        switch (request.httpMethod, request.url!.path) {
        case ("POST", "/api/v1/share-links"):
            json = #"{"id":"8f75ec62-e2e8-4a0e-93aa-bc06268a72cb","token":"capability","expiresAt":"2026-10-25T12:00:00Z"}"#
        case ("GET", "/api/v1/share-links"):
            json = #"{"links":[{"id":"8f75ec62-e2e8-4a0e-93aa-bc06268a72cb","createdAt":"2026-10-18T12:00:00Z","expiresAt":"2026-10-25T12:00:00Z","revokedAt":null,"fields":{"showRouteEnds":true},"activityCount":2,"status":"active"}]}"#
        case ("POST", "/api/v1/share-links/revoke"): json = #"{"status":"revoked"}"#
        default: json = "{}"
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: request.httpMethod == "POST" ? 201 : 200,
                                       httpVersion: nil, headerFields: ["Cache-Control": "private, no-store"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: StreamFixtures.envelope(json))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

@MainActor
struct ShareLinksAPITests {
    @Test func createListAndRevokeUseCapturedDeploymentBearerAndWireContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ShareLinksURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let api = ShareLinksAPI(baseURL: URL(string: "https://sharing.example.test")!, token: "sharing-test-token", session: session)
        let created = try await api.create(.init(activityIds: ["123", "456"], expiresInMs: 604800000, fields: .init(showRouteEnds: false)))
        #expect(created.token == "capability")
        let links = try await api.list()
        let summary = try #require(links.first)
        #expect(links.count == 1 && summary.id == created.id && summary.activityCount == 2)
        #expect(summary.fields.showRouteEnds && summary.revokedAt == nil && summary.status == .active)
        try await api.revoke(id: created.id)
        let requests = ShareLinksURLProtocol.requests
        #expect(requests.count == 3)
        #expect(requests.map(\.httpMethod) == ["POST", "GET", "POST"])
        #expect(requests.map { $0.url!.path } == ["/api/v1/share-links", "/api/v1/share-links", "/api/v1/share-links/revoke"])
        #expect(requests.allSatisfy { $0.url?.host == "sharing.example.test"
            && $0.value(forHTTPHeaderField: "Authorization") == "Bearer sharing-test-token" && !$0.httpShouldHandleCookies })
        func body(_ request: URLRequest) throws -> [String: Any] {
            var data = request.httpBody ?? Data()
            if data.isEmpty, let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count))
                }
            }
            return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        let input = try body(requests[0])
        #expect(input["activityIds"] as? [String] == ["123", "456"])
        #expect((input["fields"] as? [String: Bool]) == ["showRouteEnds": false])
        #expect(try body(requests[2])["id"] as? String == created.id)
    }
}

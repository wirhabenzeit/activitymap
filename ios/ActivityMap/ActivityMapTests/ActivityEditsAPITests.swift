import Foundation
import Testing
@testable import ActivityMap

nonisolated final class ActivityEditsURLProtocol: URLProtocol, @unchecked Sendable {
    private final class Box: @unchecked Sendable {
        let lock = NSLock()
        var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
        var requests: [URLRequest] = []
    }
    private static let box = Box()
    static func configure(_ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)) {
        box.lock.lock(); defer { box.lock.unlock() }
        box.handler = handler; box.requests = []
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

@MainActor @Suite(.serialized)
struct ActivityEditsAPITests {
    private func api() -> (ActivityEditsAPI, URLSession) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ActivityEditsURLProtocol.self]
        let session = URLSession(configuration: configuration)
        return (ActivityEditsAPI(baseURL: Fixtures.scope.deployment, token: "edit-test-token", session: session), session)
    }

    @Test func patchUsesCapturedDeploymentBearerAndExplicitEmptyDescription() async throws {
        let activity = try Fixtures.activity(["description": ""])
        let json = String(data: try ActivityMapAPI.makeEncoder().encode(activity), encoding: .utf8)!
        let body = StreamFixtures.envelope(json)
        ActivityEditsURLProtocol.configure { request in
            (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, body)
        }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        let result = try await api.update(activityID: activity.id, fields: .init(name: nil, description: "", sportType: nil))
        let request = try #require(ActivityEditsURLProtocol.requests.first)
        // Compare with the wire DTO rather than re-formatting fractional Date values.
        let expected = try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.Activity.self, from: Data(json.utf8))
        #expect(result == expected)
        #expect(request.httpMethod == "PATCH" && request.url?.host == "example.test")
        #expect(request.url?.path == "/api/v1/activities/9007199254740993")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer edit-test-token")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json" && !request.httpShouldHandleCookies)
        let data = try #require(request.httpBody ?? request.httpBodyStream.flatMap { stream in
            stream.open(); defer { stream.close() }
            var result = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }; result.append(contentsOf: buffer.prefix(count))
            }
            return result
        })
        let fields = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        #expect(fields == ["description": ""])
    }

    @Test func invalidIDAndMismatchedResponseNeverCommit() async throws {
        let json = String(data: try ActivityMapAPI.makeEncoder().encode(Fixtures.activity(["id": "2"])), encoding: .utf8)!
        let body = StreamFixtures.envelope(json)
        ActivityEditsURLProtocol.configure { request in
            (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, body)
        }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        let fields = ActivityMapAPI.UpdateActivityRequest(name: "New", description: nil, sportType: nil)
        await #expect(throws: APIClient.RequestError.self) { try await api.update(activityID: "1/../2", fields: fields) }
        #expect(ActivityEditsURLProtocol.requests.isEmpty)
        await #expect(throws: APIClient.RequestError.self) { try await api.update(activityID: "1", fields: fields) }
    }
}

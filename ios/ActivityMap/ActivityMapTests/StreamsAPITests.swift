import Foundation
import Testing
@testable import ActivityMap

/// Separate from `SyncURLProtocol` so the two suites cannot race on one handler.
nonisolated final class StreamsURLProtocol: URLProtocol, @unchecked Sendable {
    final class Box: @unchecked Sendable {
        let lock = NSLock()
        var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?
        var requests: [URLRequest] = []
        var holdResponse = false
    }
    static let box = Box()
    static func setHandler(holdResponse: Bool = false, _ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)) {
        box.lock.lock(); defer { box.lock.unlock() }
        box.handler = handler
        box.requests = []
        box.holdResponse = holdResponse
    }
    static var requests: [URLRequest] {
        box.lock.lock(); defer { box.lock.unlock() }; return box.requests
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.box.lock.lock()
        let handler = Self.box.handler
        let holdResponse = Self.box.holdResponse
        Self.box.requests.append(request)
        Self.box.lock.unlock()
        do {
            let (response, data) = try handler!(request)
            if holdResponse { return }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@Suite(.serialized)
@MainActor
struct StreamsAPITests {
    private func api() -> (StreamsAPI, URLSession) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StreamsURLProtocol.self]
        let session = URLSession(configuration: configuration)
        return (StreamsAPI(baseURL: Fixtures.scope.deployment, token: "secret-for-test", session: session), session)
    }

    private nonisolated static func response(_ request: URLRequest, _ status: Int, _ headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
    }

    @Test func fetchModesMapToTheContractQuery() async throws {
        let body = StreamFixtures.rawBody()
        StreamsURLProtocol.setHandler { request in (Self.response(request, 200), body) }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        for mode in [StreamFetchMode.auto, .storedOnly, .refresh] {
            _ = try await api.rawStreams(activityID: StreamFixtures.activityID, mode: mode)
        }
        let queries = StreamsURLProtocol.requests.map {
            URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
        }
        #expect(queries == [[URLQueryItem(name: "fetch", value: "auto")], [URLQueryItem(name: "fetch", value: "none")], [URLQueryItem(name: "fetch", value: "auto"), URLQueryItem(name: "refresh", value: "true")]])
        let request = try #require(StreamsURLProtocol.requests.first)
        #expect(request.url?.path == "/api/v1/activities/\(StreamFixtures.activityID)/streams")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret-for-test")
    }

    @Test func rawResponseKeepsStatusRetryAfterAndExactBody() async throws {
        let body = StreamFixtures.rawBody(state: "stale")
        StreamsURLProtocol.setHandler { request in (Self.response(request, 202, ["Retry-After": "3", "X-Request-Id": "pending-request"]), body) }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        let pending = try await api.rawStreams(activityID: StreamFixtures.activityID, mode: .auto)
        #expect(pending.isPending && pending.statusCode == 202)
        #expect(pending.retryAfter == 3 && pending.requestID == "pending-request")
        #expect(pending.body == body)
        #expect(pending.payload.metadata.state == .stale)
    }

    @Test func summaryUsesItsOwnEndpoint() async throws {
        let body = StreamFixtures.envelope(StreamFixtures.summaryJSON(summary: StreamFixtures.timeSummary))
        StreamsURLProtocol.setHandler { request in (Self.response(request, 200), body) }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        let result = try await api.summary(activityID: StreamFixtures.activityID, mode: .storedOnly)
        #expect(!result.isPending && result.retryAfter == nil)
        #expect(result.payload.summary?.basis == .time)
        #expect(result.payload.summary?.distance == nil)
        #expect(result.payload.summary?.time == "?AO")
        #expect(result.payload.summary?.algorithmVersion == 1)
        #expect(StreamsURLProtocol.requests.first?.url?.path
                == "/api/v1/activities/\(StreamFixtures.activityID)/streams/summary/compact")
    }

    @Test func storedSummariesAreBatchedDeduplicatedAndMappedByID() async throws {
        let ids = (1...150).map(String.init)
        StreamsURLProtocol.setHandler { request in
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
            let requested = query.first { $0.name == "ids" }!.value!.split(separator: ",").map(String.init)
            // Reverse order, skip one ID (e.g. another athlete's), add one never asked for.
            let entries = (requested.filter { $0 != "7" }.reversed() + ["999999"])
                .map { StreamFixtures.summaryJSON(id: $0) }
            return (Self.response(request, 200),
                    StreamFixtures.envelope(#"{"summaries":["# + entries.joined(separator: ",") + "]}"))
        }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        let result = try await api.storedSummaries(activityIDs: ids + ids.prefix(20))
        let batches = StreamsURLProtocol.requests.map {
            URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)!.queryItems!
                .first { $0.name == "ids" }!.value!.split(separator: ",").count
        }
        #expect(batches == [100, 50])
        #expect(StreamsURLProtocol.requests.allSatisfy { $0.url?.path == "/api/v1/stream-summaries/compact" })
        #expect(result.count == 149)
        #expect(result["7"] == nil && result["999999"] == nil)
        #expect(result["42"]?.activityID == "42")
    }

    @Test func invalidActivityIDsNeverReachTheNetwork() async throws {
        StreamsURLProtocol.setHandler { request in (Self.response(request, 200), StreamFixtures.rawBody()) }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        for id in ["", "12/../34", "1,2", "abc", "0", "01", "9223372036854775808", "١"] {
            await #expect(throws: APIClient.RequestError.self) {
                _ = try await api.rawStreams(activityID: id, mode: .auto)
            }
        }
        #expect(StreamsURLProtocol.requests.isEmpty)
    }

    @Test func retryTimingIsKeptForRetryableFailures() throws {
        let unavailable = HTTPURLResponse(url: Fixtures.scope.deployment, statusCode: 503, httpVersion: nil,
                                          headerFields: ["Retry-After": "60"])!
        let body = Data(#"{"error":{"code":"streams_fetch_failed","message":"Later","requestId":"r","retryable":true}}"#.utf8)
        do {
            _ = try APIClient.decodeResponse(data: body, httpResponse: unavailable, as: ActivityMapAPI.ActivityStreams.self)
            Issue.record("Expected a server error")
        } catch APIClient.RequestError.server(let code, _, let status, _, let retryable, let retryAfter) {
            #expect(code == "streams_fetch_failed" && status == 503 && retryable && retryAfter == 60)
        }

        let limited = HTTPURLResponse(url: Fixtures.scope.deployment, statusCode: 429, httpVersion: nil,
                                      headerFields: ["Retry-After": "900"])!
        do {
            _ = try APIClient.decodeResponse(data: Data(), httpResponse: limited, as: ActivityMapAPI.ActivityStreams.self)
            Issue.record("Expected rate limit")
        } catch APIClient.RequestError.rateLimited(let delay, _) {
            #expect(delay == 900)
        }

        let missing = HTTPURLResponse(url: Fixtures.scope.deployment, statusCode: 404, httpVersion: nil, headerFields: nil)!
        let notFound = Data(#"{"error":{"code":"activity_unavailable","message":"Gone","requestId":"r","retryable":false}}"#.utf8)
        do {
            _ = try APIClient.decodeResponse(data: notFound, httpResponse: missing, as: ActivityMapAPI.ActivityStreams.self)
            Issue.record("Expected not found")
        } catch APIClient.RequestError.server(let code, _, let status, _, let retryable, let retryAfter) {
            #expect(code == "activity_unavailable" && status == 404 && !retryable && retryAfter == nil)
        }
    }

    @Test func retryAfterNeverShortensToZeroAndIgnoresGarbage() {
        func parse(_ value: String?) -> TimeInterval? {
            APIClient.parseRetryAfter(HTTPURLResponse(
                url: Fixtures.scope.deployment, statusCode: 202, httpVersion: nil,
                headerFields: value.map { ["Retry-After": $0] })!)
        }
        #expect(parse("3") == 3)
        #expect(parse("0") == 1)
        #expect(parse(nil) == nil)
        #expect(parse("soon") == nil)
        #expect(parse("nan") == nil)
        #expect(parse("inf") == nil)
        #expect(parse("-3") == nil)
        #expect(parse(" 900.5 ") == 900.5)
        #expect(parse("Wed, 21 Oct 2015 07:28:00 GMT") == 1)
    }

    @Test func compactSummaryFetchModesAreExplicitAndRefreshIsDeliberate() async throws {
        StreamsURLProtocol.setHandler { request in
            (Self.response(request, 200), StreamFixtures.envelope(StreamFixtures.summaryJSON()))
        }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        for mode in [StreamFetchMode.storedOnly, .auto, .refresh] {
            _ = try await api.summary(activityID: StreamFixtures.activityID, mode: mode)
        }
        let queries = StreamsURLProtocol.requests.map {
            URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
        }
        #expect(queries == [StreamFetchMode.storedOnly.queryItems, StreamFetchMode.auto.queryItems,
                            StreamFetchMode.refresh.queryItems])
        #expect(queries.prefix(2).allSatisfy { !$0.contains { $0.name == "refresh" } })
    }

    @Test func storedBatchPreservesHTTPMetadataAndValidatesBeforeNetwork() async throws {
        StreamsURLProtocol.setHandler { request in
            (Self.response(request, 200, ["X-Request-Id": "batch"]), StreamFixtures.envelope(#"{"summaries":[]}"#))
        }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        #expect(try await api.storedSummaries(activityIDs: []).isEmpty)
        for ids in [[], (1...101).map(String.init), ["42", "01"]] {
            await #expect(throws: APIClient.RequestError.self) {
                _ = try await api.storedSummaryBatch(activityIDs: ids)
            }
        }
        #expect(StreamsURLProtocol.requests.isEmpty)
        let result = try await api.storedSummaryBatch(activityIDs: ["42", "42"])
        #expect(result.requestID == "batch" && result.statusCode == 200 && result.payload.summaries.isEmpty)
        let query = URLComponents(url: try #require(StreamsURLProtocol.requests.first?.url),
                                  resolvingAgainstBaseURL: false)!.queryItems
        #expect(query == [URLQueryItem(name: "ids", value: "42")])
    }

    @Test func dateRetryHeadersPreserveFullWaitDespiteClockSkew() throws {
        let now = try Date.ISO8601FormatStyle().parse("2026-09-29T12:00:00Z")
        let response = HTTPURLResponse(url: Fixtures.scope.deployment, statusCode: 202, httpVersion: nil,
            headerFields: ["Retry-After": "Tue, 29 Sep 2026 12:05:00 GMT"])!
        #expect(APIClient.parseRetryAfter(response, now: now) == 300)
        let skewed = HTTPURLResponse(url: Fixtures.scope.deployment, statusCode: 503, httpVersion: nil,
            headerFields: ["Retry-After": "Tue, 29 Sep 2026 12:05:00 GMT", "Date": "Tue, 29 Sep 2026 11:59:00 GMT"])!
        #expect(APIClient.parseRetryAfter(skewed, now: now) == 360)
    }

    @Test(arguments: [200, 202])
    func successfulResponseRejectsMalformedEnvelopesAndSchemaMismatch(status: Int) throws {
        let response = HTTPURLResponse(url: Fixtures.scope.deployment, statusCode: status, httpVersion: nil,
                                       headerFields: nil)!
        for body in ["{}", #"{"data":{}}"#, "not JSON"] {
            #expect(throws: APIClient.RequestError.self) {
                try APIClient.decodeResponse(data: Data(body.utf8), httpResponse: response, as: JSONValue.self)
            }
        }
        let mismatched = Data(#"{"schemaVersion":"2","serverTime":"2026-09-22T12:00:01Z","data":{}}"#.utf8)
        do {
            _ = try APIClient.decodeResult(data: mismatched, httpResponse: response, as: JSONValue.self)
            Issue.record("Expected schema version mismatch")
        } catch APIClient.RequestError.schemaVersionMismatch(let expected, let actual) {
            #expect(expected == "1" && actual == "2")
        }
    }

    @Test func failedResponsesKeepRequestIdentityEvenWithoutEnvelope() throws {
        let body = Data(#"{"error":{"code":"limited","message":"Later","requestId":"body-id","retryable":true}}"#.utf8)
        let response = HTTPURLResponse(url: Fixtures.scope.deployment, statusCode: 429, httpVersion: nil, headerFields: nil)!
        do {
            _ = try APIClient.decodeResponse(data: body, httpResponse: response, as: JSONValue.self)
            Issue.record("Expected rate limit")
        } catch APIClient.RequestError.rateLimited(let delay, let id) {
            #expect(delay == 60 && id == "body-id")
        }
        let unavailable = HTTPURLResponse(url: Fixtures.scope.deployment, statusCode: 503, httpVersion: nil,
                                         headerFields: ["Retry-After": "180", "X-Request-Id": "proxy-id"])!
        do {
            _ = try APIClient.decodeResult(data: Data("<html>unavailable</html>".utf8), httpResponse: unavailable, as: JSONValue.self)
            Issue.record("Expected service unavailable")
        } catch APIClient.RequestError.serviceUnavailable(let delay, let id) {
            #expect(delay == 180 && id == "proxy-id")
        }
    }

    @Test func mismatchedActivityIdentityIsRejected() async throws {
        StreamsURLProtocol.setHandler { request in
            (Self.response(request, 200), StreamFixtures.envelope(StreamFixtures.summaryJSON(id: "2")))
        }
        let (api, session) = api()
        defer { session.invalidateAndCancel() }
        await #expect(throws: APIClient.RequestError.self) {
            _ = try await api.summary(activityID: "1", mode: .auto)
        }
    }

    @Test func cancellationBeforeRequestAndDuringFlightRemainsCancellation() async throws {
        let (started, signal) = AsyncStream<Void>.makeStream()
        StreamsURLProtocol.setHandler(holdResponse: true) { request in
            signal.yield(())
            return (Self.response(request, 200), StreamFixtures.rawBody())
        }
        let (api, session) = api()
        defer { session.invalidateAndCancel(); signal.finish() }
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await api.summary(activityID: StreamFixtures.activityID, mode: .auto)
        }
        await #expect(throws: CancellationError.self) { _ = try await cancelled.value }
        #expect(StreamsURLProtocol.requests.isEmpty)

        let pending = Task { try await api.rawStreams(activityID: StreamFixtures.activityID, mode: .auto) }
        for await _ in started { break }
        pending.cancel()
        await #expect(throws: CancellationError.self) { _ = try await pending.value }
        #expect(StreamsURLProtocol.requests.count == 1)
    }
}

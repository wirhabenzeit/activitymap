import Foundation
import Testing
@testable import ActivityMap

struct APIErrorFactsTests {
    @Test func serverFactsKeepTheCompleteDelayAndExplicitRetryability() {
        let retryable = APIClient.RequestError.server(
            code: "upstream_error", message: "Wait", status: 503,
            requestID: "request-1", retryable: true, retryAfter: 7200)
        #expect(retryable.facts == .init(requestID: "request-1", retryAfter: 7200,
                                        authenticationRejected: false, serverRetryable: true))
        let terminal = APIClient.RequestError.server(
            code: "activity_unavailable", message: "Gone", status: 404,
            requestID: "request-2", retryable: false, retryAfter: 120)
        #expect(terminal.facts == .init(requestID: "request-2", retryAfter: 120,
                                       authenticationRejected: false, serverRetryable: false))
    }

    @Test func proxyAndRateLimitFactsDoNotInventAnEnvelopeRetryFlag() {
        let limited = APIClient.RequestError.rateLimited(retryAfter: 3600, requestID: "limited")
        #expect(limited.facts == .init(requestID: "limited", retryAfter: 3600))
        let proxy = APIClient.RequestError.serviceUnavailable(retryAfter: 600, requestID: "proxy")
        #expect(proxy.facts == .init(requestID: "proxy", retryAfter: 600))
        let noDelay = APIClient.RequestError.serviceUnavailable(retryAfter: nil, requestID: nil)
        #expect(noDelay.facts == .init())
    }

    @Test func onlyAnExplicitCredentialRejectionRequiresAuthentication() {
        for error in [
            APIClient.RequestError.unexpectedStatus(401),
            .server(code: "other", message: "Rejected", status: 401, requestID: nil, retryable: false),
            .server(code: "not_authenticated", message: "Rejected", status: 403, requestID: nil, retryable: false),
        ] {
            #expect(error.facts.authenticationRejected)
        }
        for error in [
            APIClient.RequestError.transport("offline", code: URLError.notConnectedToInternet.rawValue),
            .encoding("invalid"), .decoding("invalid"), .unexpectedStatus(403),
            .unexpectedStatus(500), .schemaVersionMismatch(expected: "v1", actual: "v2"),
            .server(code: "forbidden", message: "Denied", status: 403, requestID: nil, retryable: false),
        ] {
            #expect(!error.facts.authenticationRejected)
        }
    }

    @Test func localAndCancellationErrorsHaveNoServerFacts() {
        #expect(APIClient.errorFacts(for: CancellationError()) == .init())
        #expect(APIClient.errorFacts(for: URLError(.notConnectedToInternet)) == .init())
        #expect(APIClient.errorFacts(for: APIClient.RequestError.transport("offline")) == .init())
    }

    @Test func decodedFactsKeepHeaderPrecedenceAndDoNotDiscardRetryableFalse() throws {
        let response = HTTPURLResponse(url: URL(string: "https://example.test/api/v1/me")!,
            statusCode: 503, httpVersion: nil,
            headerFields: ["X-Request-Id": "header-id", "Retry-After": "180"])!
        let body = Data(#"{"error":{"code":"terminal","message":"Stop","requestId":"body-id","retryable":false}}"#.utf8)
        do {
            let _: JSONValue = try APIClient.decodeResult(data: body, httpResponse: response, as: JSONValue.self)
            Issue.record("Expected a server error")
        } catch let error as APIClient.RequestError {
            #expect(APIClient.errorFacts(for: error) == .init(requestID: "header-id", retryAfter: 180,
                                                              serverRetryable: false))
        }
    }
}

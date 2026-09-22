import Foundation

/// Minimal v1 HTTP client: builds a request against `APIConfiguration.baseURL`,
/// injects a bearer token when given one, and unwraps the response envelope or
/// error envelope from `ActivityMapAPI` (`Networking/DTO/`).
///
/// This is deliberately small. The sync engine (a later phase) will extend it
/// with pagination helpers rather than replace it — `Auth/AuthController.swift`
/// and the sync engine should share one request/error path so a server error
/// is never handled two different ways.
nonisolated enum APIClient {
    enum RequestError: Error, CustomStringConvertible, Sendable {
        /// The request never reached the server, or the server never
        /// responded — string rather than the original `Error` so this stays
        /// `Sendable` without depending on `URLError`/`Error` being one.
        case transport(String)
        case encoding(String)
        case decoding(String)
        case server(code: String, message: String, status: Int, requestID: String?, retryable: Bool)
        case unexpectedStatus(Int)
        case rateLimited(retryAfter: TimeInterval, requestID: String?)
        /// The response parsed fine, but its `schemaVersion` does not match
        /// this build's `ActivityMapAPI.schemaVersion`. This exists to be
        /// checked, not just carried: see `decodeResult`.
        case schemaVersionMismatch(expected: String, actual: String)

        var description: String {
            switch self {
            case .transport(let message):
                "Network error: \(message)"
            case .encoding(let message):
                "Could not encode the request body: \(message)"
            case .decoding(let message):
                "Could not decode the server's response: \(message)"
            case .server(let code, let message, let status, let requestID, _):
                "\(message) (\(code), HTTP \(status)"
                    + (requestID.map { ", request \($0)" } ?? "") + ")"
            case .unexpectedStatus(let status):
                "Unexpected HTTP status \(status)"
            case .rateLimited:
                "Too many requests. Please wait before trying again."
            case .schemaVersionMismatch(let expected, let actual):
                "Server schema version \(actual) does not match the version this build expects (\(expected))"
            }
        }
    }

    static func get<Payload: Decodable & Sendable>(
        _ path: String,
        query: [URLQueryItem] = [],
        bearerToken: String? = nil,
        baseURL: URL = APIConfiguration.baseURL,
        session: URLSession = .shared,
        as payloadType: Payload.Type
    ) async throws -> Payload {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.isEmpty ? nil : query
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "GET"
        applyCommonHeaders(&request, bearerToken: bearerToken)
        return try await perform(request, session: session, as: payloadType)
    }

    static func post<Body: Encodable, Payload: Decodable & Sendable>(
        _ path: String,
        body: Body,
        bearerToken: String? = nil,
        as payloadType: Payload.Type
    ) async throws -> Payload {
        var request = URLRequest(url: APIConfiguration.endpoint(path))
        request.httpMethod = "POST"
        applyCommonHeaders(&request, bearerToken: bearerToken)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try ActivityMapAPI.makeEncoder().encode(body)
        } catch {
            throw RequestError.encoding(String(describing: error))
        }
        return try await perform(request, as: payloadType)
    }

    /// A body-less `POST`, e.g. `/api/v1/auth/logout`.
    static func post<Payload: Decodable & Sendable>(
        _ path: String,
        bearerToken: String? = nil,
        as payloadType: Payload.Type
    ) async throws -> Payload {
        var request = URLRequest(url: APIConfiguration.endpoint(path))
        request.httpMethod = "POST"
        applyCommonHeaders(&request, bearerToken: bearerToken)
        return try await perform(request, as: payloadType)
    }

    private static func applyCommonHeaders(_ request: inout URLRequest, bearerToken: String?) {
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearerToken {
            request.httpShouldHandleCookies = false
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
    }

    private static func perform<Payload: Decodable & Sendable>(
        _ request: URLRequest,
        session: URLSession = .shared,
        as payloadType: Payload.Type
    ) async throws -> Payload {
        let data: Data
        let response: URLResponse
        do {
            try Task.checkCancellation()
            (data, response) = try await session.data(for: request)
        } catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw RequestError.transport(String(describing: error))
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw RequestError.unexpectedStatus(-1)
        }
        return try decodeResult(data: data, httpResponse: httpResponse, as: payloadType)
    }

    /// The decode/error-mapping half of `perform`, split out and left
    /// non-private so it can be exercised directly against crafted
    /// `Data`/`HTTPURLResponse` pairs without a live server — see
    /// `docs/ios-data-ingestion-plan.md` for why this project favours that
    /// kind of contract-shaped verification over mocking `URLSession`.
    static func decodeResult<Payload: Decodable & Sendable>(
        data: Data,
        httpResponse: HTTPURLResponse,
        as payloadType: Payload.Type
    ) throws -> Payload {
        let decoder = ActivityMapAPI.makeDecoder()

        if httpResponse.statusCode == 429 {
            let raw = httpResponse.value(forHTTPHeaderField: "Retry-After")
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
            let delay = raw.flatMap(Double.init)
                ?? raw.flatMap { formatter.date(from: $0)?.timeIntervalSinceNow } ?? 60
            throw RequestError.rateLimited(
                retryAfter: delay.isFinite ? max(1, delay) : 60,
                requestID: httpResponse.value(forHTTPHeaderField: "X-Request-Id"))
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            if let failure = try? decoder.decode(ActivityMapAPI.ErrorEnvelope.self, from: data) {
                throw RequestError.server(
                    code: failure.error.code,
                    message: failure.error.message,
                    status: httpResponse.statusCode,
                    requestID: failure.error.requestID,
                    retryable: failure.error.retryable
                )
            }
            throw RequestError.unexpectedStatus(httpResponse.statusCode)
        }

        let envelope: ActivityMapAPI.Envelope<Payload>
        do {
            envelope = try decoder.decode(ActivityMapAPI.Envelope<Payload>.self, from: data)
        } catch {
            throw RequestError.decoding(String(describing: error))
        }

        // The version marker exists specifically to detect contract
        // divergence (see ActivityMapAPI.schemaVersion's doc comment); a
        // mismatch here means the payload above was decoded against a
        // contract shape this build cannot actually trust.
        guard envelope.schemaVersion == ActivityMapAPI.schemaVersion else {
            throw RequestError.schemaVersionMismatch(
                expected: ActivityMapAPI.schemaVersion, actual: envelope.schemaVersion)
        }

        return envelope.data
    }
}

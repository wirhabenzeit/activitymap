import Foundation

/// Hand-written companions to `ActivityMapAPI.generated.swift`.
///
/// These exist because JSON Schema flattens generics: `responseEnvelope(T)` and
/// `paginatedSchema(T)` in `src/contracts/v1` are generic wrappers, but each
/// instantiation projects to its own concrete schema. Modelling them once here
/// as Swift generics is both smaller and closer to the contract's intent than
/// generating `CurrentUserResponse`, `ActivityPageResponse`, and so on.
///
/// Everything is `nonisolated` for the same reason as the generated file: the
/// target defaults to `MainActor` isolation and the sync engine decodes off the
/// main actor.
nonisolated extension ActivityMapAPI {
    /// Mirrors `responseEnvelope` in `src/contracts/v1/envelope.ts`, which wraps
    /// every successful v1 response.
    struct Envelope<Payload: Decodable & Sendable>: Decodable, Sendable {
        let schemaVersion: String
        let serverTime: Date
        let data: Payload
    }

    /// Mirrors `paginatedSchema` in `src/contracts/v1/pagination.ts`, used by the
    /// `/api/v1/activities` and `/api/v1/photos` list endpoints. `nextCursor` is
    /// `nil` once pagination is exhausted, and is opaque: pass it back verbatim.
    struct Page<Item: Decodable & Sendable>: Decodable, Sendable {
        let items: [Item]
        let nextCursor: String?
    }
}

nonisolated extension ActivityMapAPI {
    /// The server emits timestamps with `Date.toISOString()`, which always
    /// includes milliseconds. The non-fractional format is accepted as well so a
    /// hand-written fixture or a future serializer change cannot break decoding.
    private static let fractionalSecondsFormat = Date.ISO8601FormatStyle(
        includingFractionalSeconds: true
    )
    private static let wholeSecondsFormat = Date.ISO8601FormatStyle(
        includingFractionalSeconds: false
    )

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = try? fractionalSecondsFormat.parse(raw) { return date }
            if let date = try? wholeSecondsFormat.parse(raw) { return date }
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Expected an ISO 8601 UTC timestamp, got \(raw)"
                )
            )
        }
        return decoder
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(fractionalSecondsFormat.format(date))
        }
        return encoder
    }
}

/// A decoded but uninterpreted JSON value, used for contract fields typed as
/// `z.unknown()` — currently only the error envelope's `details`, which is
/// diagnostic payload the client forwards to logs rather than branches on.
nonisolated enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Unsupported JSON value"
                )
            )
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

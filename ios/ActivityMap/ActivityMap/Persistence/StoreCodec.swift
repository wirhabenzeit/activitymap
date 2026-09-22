import Foundation

/// Internal storage format, independent of the ISO-8601 HTTP representation.
/// Default Codable dates round-trip their Double value exactly. Reformatting
/// through milliseconds can lose precision (e.g. .456 -> .455 in Foundation).
nonisolated enum StoreCodec {
    static func encode<T: Encodable>(_ value: T) throws -> Data {
        try JSONEncoder().encode(value)
    }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try JSONDecoder().decode(type, from: data)
    }
}

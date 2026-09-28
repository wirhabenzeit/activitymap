import Foundation

/// Portable polyline-v1 codec. Keep the generated compact DTO encoded in the
/// cache; call decode from a background task only for a visible consumer.
nonisolated enum CompactStreamCodec {
    enum Failure: Error { case invalid }
    static let maxValue: Int64 = 1_099_511_627_775
    static let maxPoints = 300

    private static func decodeValues(_ text: String?, count: Int, scale: Double, stride: Int = 1) throws -> [Double]? {
        guard let text else { return nil }
        guard text.utf8.count <= count * 9 else { throw Failure.invalid }
        let bytes = Array(text.utf8)
        var previous = Array(repeating: Int64(0), count: stride)
        var values: [Double] = []
        values.reserveCapacity(count)
        var offset = 0
        for index in 0..<count {
            var unsigned: Int64 = 0
            var multiplier: Int64 = 1
            var chunks = 0
            while true {
                chunks += 1
                guard offset < bytes.count, chunks <= 9, (63...126).contains(bytes[offset]) else { throw Failure.invalid }
                let chunk = Int64(bytes[offset]) - 63
                offset += 1
                unsigned += (chunk % 32) * multiplier
                guard unsigned <= 4 * maxValue else { throw Failure.invalid }
                if chunk < 32 {
                    guard chunks == 1 || chunk != 0 else { throw Failure.invalid }
                    break
                }
                multiplier *= 32
            }
            let delta = unsigned % 2 == 0 ? unsigned / 2 : -(unsigned + 1) / 2
            let component = index % stride
            let value = previous[component] + delta
            guard abs(value) <= maxValue else { throw Failure.invalid }
            previous[component] = value
            values.append(Double(value) / scale)
        }
        guard offset == bytes.count else { throw Failure.invalid }
        return values
    }

    static func decode(_ summary: ActivityMapAPI.CompactStreamSummary) throws -> ActivityMapAPI.StreamSummary {
        guard summary.codec == "polyline-v1", summary.algorithmVersion > 0, summary.algorithmVersion <= 9_007_199_254_740_991, (0...maxPoints).contains(summary.count) else { throw Failure.invalid }
        switch summary.basis {
        case .distance: guard summary.distance != nil else { throw Failure.invalid }
        case .time: guard summary.time != nil else { throw Failure.invalid }
        case nil: guard summary.count == 0 else { throw Failure.invalid }
        }
        let coordinates = try decodeValues(summary.latlng, count: summary.count * 2, scale: 100_000, stride: 2)
        var latlng: [[Double]]? = coordinates == nil ? nil : []
        if let coordinates {
            for index in Swift.stride(from: 0, to: coordinates.count, by: 2) {
                let lat = coordinates[index], lng = coordinates[index + 1]
                guard abs(lat) <= 90, abs(lng) <= 180 else { throw Failure.invalid }
                latlng?.append([lat, lng])
            }
        }
        return try ActivityMapAPI.StreamSummary(
            version: summary.algorithmVersion, basis: summary.basis,
            time: decodeValues(summary.time, count: summary.count, scale: 1),
            distance: decodeValues(summary.distance, count: summary.count, scale: 10),
            latlng: latlng,
            altitude: decodeValues(summary.altitude, count: summary.count, scale: 10),
            watts: decodeValues(summary.watts, count: summary.count, scale: 1),
            heartrate: decodeValues(summary.heartrate, count: summary.count, scale: 1))
    }

    private static func encodeValues(_ values: [Double]?, count: Int, scale: Double, stride: Int = 1) throws -> String? {
        guard let values else { return nil }
        guard values.count == count else { throw Failure.invalid }
        var previous = Array(repeating: Int64(0), count: stride)
        var bytes: [UInt8] = []
        for (index, value) in values.enumerated() {
            let scaled = (value * scale).rounded()
            guard scaled.isFinite, abs(scaled) <= Double(maxValue), scaled / scale == value else { throw Failure.invalid }
            let integer = Int64(scaled)
            let component = index % stride
            let delta = integer - previous[component]
            previous[component] = integer
            var unsigned = delta < 0 ? -2 * delta - 1 : 2 * delta
            while unsigned >= 32 {
                bytes.append(UInt8(63 + 32 + unsigned % 32))
                unsigned /= 32
            }
            bytes.append(UInt8(63 + unsigned))
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    static func encode(_ summary: ActivityMapAPI.StreamSummary) throws -> ActivityMapAPI.CompactStreamSummary {
        guard summary.version > 0, summary.version <= 9_007_199_254_740_991 else { throw Failure.invalid }
        let count: Int
        switch summary.basis {
        case .distance: guard let axis = summary.distance else { throw Failure.invalid }; count = axis.count
        case .time: guard let axis = summary.time else { throw Failure.invalid }; count = axis.count
        case nil: count = 0
        }
        guard count <= maxPoints else { throw Failure.invalid }
        if let coordinates = summary.latlng {
            guard coordinates.count == count, coordinates.allSatisfy({
                $0.count == 2 && abs($0[0]) <= 90 && abs($0[1]) <= 180
            }) else { throw Failure.invalid }
        }
        return try ActivityMapAPI.CompactStreamSummary(
            codec: "polyline-v1", algorithmVersion: summary.version, basis: summary.basis, count: count,
            time: encodeValues(summary.time, count: count, scale: 1),
            distance: encodeValues(summary.distance, count: count, scale: 10),
            altitude: encodeValues(summary.altitude, count: count, scale: 10),
            watts: encodeValues(summary.watts, count: count, scale: 1),
            heartrate: encodeValues(summary.heartrate, count: count, scale: 1),
            latlng: encodeValues(summary.latlng?.flatMap { $0 }, count: count * 2, scale: 100_000, stride: 2))
    }
}

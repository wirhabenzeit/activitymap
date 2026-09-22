import CoreLocation

/// Google encoded polyline, precision 5 (the Strava wire format).
nonisolated enum Polyline {
    enum DecodeError: Error { case invalidEncoding }

    static func decode(_ encoded: String) throws -> [CLLocationCoordinate2D] {
        let bytes = Array(encoded.utf8)
        var index = 0
        func component() throws -> Int64 {
            var result: Int64 = 0
            // At most 6 groups for a coordinate delta within +/-360 degrees.
            for shift in stride(from: 0, through: 25, by: 5) {
                guard index < bytes.count, (63...126).contains(bytes[index]) else {
                    throw DecodeError.invalidEncoding
                }
                let value = Int64(bytes[index] - 63)
                index += 1
                result |= (value & 31) << shift
                if value < 32 { return result & 1 == 0 ? result >> 1 : ~(result >> 1) }
            }
            throw DecodeError.invalidEncoding
        }
        var latitude: Int64 = 0
        var longitude: Int64 = 0
        var coordinates: [CLLocationCoordinate2D] = []
        while index < bytes.count {
            latitude += try component()
            longitude += try component()
            let coordinate = CLLocationCoordinate2D(
                latitude: Double(latitude) / 100_000, longitude: Double(longitude) / 100_000)
            guard CLLocationCoordinate2DIsValid(coordinate) else { throw DecodeError.invalidEncoding }
            coordinates.append(coordinate)
        }
        return coordinates
    }
}

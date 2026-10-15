import CoreLocation
import Foundation

/// A detached snapshot of the already chosen cached geometry. No stream fetch,
/// timestamps or elevation estimates are needed to export a route.
nonisolated struct ActivityGPX: Sendable {
    struct Point: Sendable {
        let latitude: Double
        let longitude: Double
    }

    let name: String
    let description: String?
    let points: [Point]
    let simplified: Bool

    @MainActor init(activity: Activity) {
        name = activity.name
        description = activity.description
        points = activity.coordinates.map { Point(latitude: $0.latitude, longitude: $0.longitude) }
        simplified = activity.geometrySource != .detailed
    }

    enum ExportError: LocalizedError {
        case noGeometry, invalidCoordinate

        var errorDescription: String? {
            switch self {
            case .noGeometry: "This activity has no GPS route to export."
            case .invalidCoordinate: "The saved route contains invalid coordinates. Sync the activity and try again."
            }
        }
    }

    func data() throws -> Data {
        guard !points.isEmpty else { throw ExportError.noGeometry }
        try Task.checkCancellation()
        var xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="ActivityMap" xmlns="http://www.topografix.com/GPX/1/1">
          <trk>
            <name>\(Self.escape(name))</name>
        """
        if let description, !description.isEmpty {
            xml += "\n    <desc>\(Self.escape(description))</desc>"
        }
        xml += "\n    <src>ActivityMap cached \(simplified ? "simplified" : "detailed") route</src>\n    <trkseg>"
        let locale = Locale(identifier: "en_US_POSIX")
        for (index, point) in points.enumerated() {
            if index.isMultiple(of: 1024) { try Task.checkCancellation() }
            guard point.latitude.isFinite, point.longitude.isFinite,
                  (-90...90).contains(point.latitude), (-180...180).contains(point.longitude) else {
                throw ExportError.invalidCoordinate
            }
            let latitude = String(format: "%.8f", locale: locale, point.latitude)
            var longitude = String(format: "%.8f", locale: locale, point.longitude)
            // GPX 1.1 uses [-180, 180). Both values describe the same meridian.
            if longitude == "180.00000000" { longitude = "-180.00000000" }
            xml += "\n      <trkpt lat=\"\(latitude)\" lon=\"\(longitude)\"/>"
        }
        xml += "\n    </trkseg>\n  </trk>\n</gpx>\n"
        return Data(xml.utf8)
    }

    func write(in temporaryDirectory: URL = FileManager.default.temporaryDirectory) throws -> ActivityGPXFile {
        let data = try data()
        let directory = temporaryDirectory.appendingPathComponent("activitymap-gpx-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent(Self.filename(name))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        do {
            try Task.checkCancellation()
            try data.write(to: url, options: .atomic)
            try Task.checkCancellation()
            return ActivityGPXFile(url: url, directory: directory)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    static func filename(_ name: String) -> String {
        var stem = ""
        for character in name.precomposedStringWithCanonicalMapping {
            let next = character.isLetter || character.isNumber || character == "_" ? String(character) : "-"
            if next == "-", stem.isEmpty || stem.hasSuffix("-") { continue }
            guard stem.utf8.count + next.utf8.count <= 120 else { break }
            stem += next
        }
        stem = stem.trimmingCharacters(in: CharacterSet(charactersIn: "-_"))
        return (stem.isEmpty ? "activity" : stem) + ".gpx"
    }

    private static func escape(_ value: String) -> String {
        // XML 1.0 forbids most control characters even when entity-escaped.
        let legal = value.unicodeScalars.filter {
            $0.value == 9 || $0.value == 10 || $0.value == 13
                || (0x20...0xD7FF).contains($0.value) || (0xE000...0xFFFD).contains($0.value)
                || (0x10000...0x10FFFF).contains($0.value)
        }
        return String(String.UnicodeScalarView(legal))
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }
}

/// The share presenter retains this lease until completion or dismissal. The
/// unique directory is removed on cancellation, errors and ordinary completion.
nonisolated final class ActivityGPXFile: Sendable {
    let url: URL
    let directory: URL

    init(url: URL, directory: URL) { self.url = url; self.directory = directory }
    // SwiftUI can retain a removed view's state during presentation teardown.
    // Explicit completion cleanup must not depend on that state's ARC lifetime.
    func remove() { try? FileManager.default.removeItem(at: directory) }
    deinit { remove() }
}

import CoreLocation
import Foundation

/// Synced metadata, independent of image-byte availability.
nonisolated struct Photo: Identifiable, Sendable {
    let id: String
    let activityID: String
    let caption: String?
    let urls: [String: String]
    let location: CLLocationCoordinate2D?
    let createdAt: Date?
    var sizes: [String: [Double]] = [:]

    struct Variant: Equatable, Sendable {
        let url: URL
        let width: Double?
        let height: Double?
    }

    enum ImageUse { case thumbnail, full }

    func variant(_ use: ImageUse) -> Variant? {
        let variants: [(key: String, edge: Double, variant: Variant)] = urls.compactMap { key, raw in
            guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
            let size = sizes[key]
            let validSize = size?.count == 2 && size!.allSatisfy { $0.isFinite && $0 > 0 }
            let numericKey = Double(key) ?? .infinity
            let edge = validSize ? size!.max()! : (numericKey.isFinite && numericKey > 0 ? numericKey : .infinity)
            return (key, edge, Variant(url: url, width: validSize ? size![0] : nil, height: validSize ? size![1] : nil))
        }.sorted { a, b in
            a.edge == b.edge ? a.key.unicodeScalars.lexicographicallyPrecedes(b.key.unicodeScalars) : a.edge < b.edge
        }
        let known = variants.filter { $0.edge.isFinite }
        switch use {
        case .thumbnail: return (known.first { $0.edge >= 256 } ?? known.last ?? variants.first)?.variant
        case .full: return (known.last { $0.edge <= 2048 } ?? known.first ?? variants.first)?.variant
        }
    }

    static func ordered(_ photos: [Photo]) -> [Photo] {
        photos.sorted { a, b in
            let left = a.createdAt?.timeIntervalSince1970 ?? .infinity, right = b.createdAt?.timeIntervalSince1970 ?? .infinity
            return left == right ? a.id.unicodeScalars.lexicographicallyPrecedes(b.id.unicodeScalars) : left < right
        }
    }
}

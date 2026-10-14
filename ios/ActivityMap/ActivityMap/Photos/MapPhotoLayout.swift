import CoreLocation
import Foundation

/// Same screen-space policy as web; shared fixture: map-photos.v1.json.
nonisolated enum MapPhotoLayout {
    static let thumbnailZoom: CGFloat = 12
    static let pinSpacing: CGFloat = 48
    static let thumbnailSpacing: CGFloat = 72
    static let viewportMargin: CGFloat = 44
    static let maxMarkers = 80

    struct Point: Equatable { let id: String; let x: CGFloat; let y: CGFloat }
    struct Group: Identifiable, Equatable {
        let id: String
        let x: CGFloat
        let y: CGFloat
        var photoIDs: [String]
    }
    private struct Cell: Hashable { let x: Int; let y: Int }

    static func validLocation(_ location: CLLocationCoordinate2D?) -> Bool {
        guard let location else { return false }
        return location.latitude.isFinite && location.longitude.isFinite &&
            abs(location.latitude) <= 90 && abs(location.longitude) <= 180
    }

    static func groups(_ points: [Point], size: CGSize, zoom: CGFloat) -> [Group] {
        guard size.width > 0, size.height > 0, zoom.isFinite else { return [] }
        var seen = Set<String>()
        let visible = points.filter {
            $0.x.isFinite && $0.y.isFinite && $0.x >= -viewportMargin && $0.y >= -viewportMargin &&
                $0.x <= size.width + viewportMargin && $0.y <= size.height + viewportMargin &&
                seen.insert($0.id).inserted
        }.sorted { $0.id.unicodeScalars.lexicographicallyPrecedes($1.id.unicodeScalars) }
        var spacing = zoom >= thumbnailZoom ? thumbnailSpacing : pinSpacing
        while true {
            var groups: [Group] = []
            var cells: [Cell: [Int]] = [:]
            for point in visible {
                let cx = Int(floor(point.x / spacing)), cy = Int(floor(point.y / spacing))
                var nearest: Int?
                var distance = spacing * spacing
                for x in (cx - 1)...(cx + 1) {
                    for y in (cy - 1)...(cy + 1) {
                        for index in cells[Cell(x: x, y: y)] ?? [] {
                            let anchor = groups[index]
                            let dx = point.x - anchor.x, dy = point.y - anchor.y
                            let d = dx * dx + dy * dy
                            if d < distance || (d == distance && (nearest == nil || index < nearest!)) {
                                nearest = index
                                distance = d
                            }
                        }
                    }
                }
                if let nearest { groups[nearest].photoIDs.append(point.id) }
                else {
                    cells[Cell(x: cx, y: cy), default: []].append(groups.count)
                    groups.append(Group(id: point.id, x: point.x, y: point.y, photoIDs: [point.id]))
                }
            }
            if groups.count <= maxMarkers { return groups }
            spacing *= 1.5
        }
    }
}

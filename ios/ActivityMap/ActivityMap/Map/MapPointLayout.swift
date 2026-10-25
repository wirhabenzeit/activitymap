import Foundation

/// Deterministic screen-space grouping shared by photo and place markers.
nonisolated enum MapPointLayout {
    struct Point: Equatable { let id: String; let x: CGFloat; let y: CGFloat }
    struct Group: Identifiable, Equatable {
        let id: String
        let x: CGFloat
        let y: CGFloat
        var pointIDs: [String]
    }
    private struct Cell: Hashable { let x: Int; let y: Int }

    static func groups(_ points: [Point], size: CGSize, spacing initialSpacing: CGFloat, maxMarkers: Int, viewportMargin: CGFloat) -> [Group] {
        guard size.width > 0, size.height > 0, initialSpacing.isFinite, initialSpacing > 0, maxMarkers > 0 else { return [] }
        var seen = Set<String>()
        let visible = points.filter {
            $0.x.isFinite && $0.y.isFinite && $0.x >= -viewportMargin && $0.y >= -viewportMargin &&
                $0.x <= size.width + viewportMargin && $0.y <= size.height + viewportMargin &&
                seen.insert($0.id).inserted
        }.sorted { $0.id.unicodeScalars.lexicographicallyPrecedes($1.id.unicodeScalars) }
        var spacing = initialSpacing
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
                if let nearest { groups[nearest].pointIDs.append(point.id) }
                else {
                    cells[Cell(x: cx, y: cy), default: []].append(groups.count)
                    groups.append(Group(id: point.id, x: point.x, y: point.y, pointIDs: [point.id]))
                }
            }
            if groups.count <= maxMarkers { return groups }
            spacing *= 1.5
        }
    }
}

import Foundation
import CoreGraphics
import MapLibre

/// Screen-space tolerance and ordering are independent of the map's tile order.
enum RouteHitTesting {
    static let radius: CGFloat = 22

    static func orderedIDs(
        features: [MLNFeature], at point: CGPoint, eligibleIDs: Set<Int>,
        project: ([CLLocationCoordinate2D]) -> [CGPoint]
    ) -> [Int] {
        var distances: [Int: CGFloat] = [:]
        for feature in features {
            guard let rawID = feature.attribute(forKey: "id") as? String,
                  let id = Int(rawID), String(id) == rawID, eligibleIDs.contains(id) else { continue }
            func coordinates(_ line: MLNPolyline) -> [CLLocationCoordinate2D] {
                var values = [CLLocationCoordinate2D](repeating: .init(), count: Int(line.pointCount))
                line.getCoordinates(&values, range: NSRange(location: 0, length: values.count))
                return values
            }
            let lines: [[CLLocationCoordinate2D]]
            if let line = feature as? MLNPolyline { lines = [coordinates(line)] }
            else if let multi = feature as? MLNMultiPolyline { lines = multi.polylines.map(coordinates) }
            else { continue }
            let distance = lines.map { distance(to: project($0), from: point) }.min() ?? .infinity
            guard distance <= radius else { continue }
            distances[id] = min(distances[id] ?? .infinity, distance)
        }
        return distances.keys.sorted {
            let lhs = distances[$0]!, rhs = distances[$1]!
            return lhs == rhs ? $0 > $1 : lhs < rhs
        }
    }

    static func distance(to line: [CGPoint], from point: CGPoint) -> CGFloat {
        guard line.count > 1 else { return .infinity }
        return zip(line, line.dropFirst()).reduce(CGFloat.infinity) { nearest, segment in
            let (a, b) = segment
            guard a.x.isFinite, a.y.isFinite, b.x.isFinite, b.y.isFinite else { return nearest }
            let dx = b.x - a.x, dy = b.y - a.y
            let lengthSquared = dx * dx + dy * dy
            let t = lengthSquared == 0 ? 0 : max(0, min(1,
                ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
            return min(nearest, hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)))
        }
    }
}

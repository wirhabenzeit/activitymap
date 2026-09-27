import Foundation
import CoreGraphics
import MapboxMaps

/// Screen-space tolerance and ordering are independent of the map's tile order.
enum RouteHitTesting {
    static let radius: CGFloat = 22

    static func orderedIDs(
        features: [Feature], at point: CGPoint, eligibleIDs: Set<Int>,
        project: ([CLLocationCoordinate2D]) -> [CGPoint]
    ) -> [Int] {
        var distances: [Int: CGFloat] = [:]
        for feature in features {
            guard case let .string(rawID) = feature.properties?["id"],
                  let id = Int(rawID), String(id) == rawID, eligibleIDs.contains(id)
            else { continue }
            let lines: [[CLLocationCoordinate2D]]
            switch feature.geometry {
            case let .lineString(line): lines = [line.coordinates]
            case let .multiLineString(linesGeometry): lines = linesGeometry.coordinates
            default: continue
            }
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

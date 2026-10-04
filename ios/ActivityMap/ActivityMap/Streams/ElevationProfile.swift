import Foundation
import CoreLocation

/// Presentation retains every supplied sample, including repeated distances.
/// No sorting, smoothing, synthetic altitude or route-length interpolation.
nonisolated struct ElevationProfile: Equatable, Sendable {
    struct Point: Identifiable, Equatable, Sendable {
        let id: Int
        let distance: Double
        let altitude: Double
        let latitude: Double?
        let longitude: Double?
    }
    let points: [Point]
    let samplingBasis: ActivityMapAPI.StreamSeriesType
    let span: Double
    let minimum: Double
    let maximum: Double
    var usesKilometres: Bool { span >= 1_000 }
    var distanceDivisor: Double { usesKilometres ? 1_000 : 1 }
    var distanceUnit: String { usesKilometres ? "km" : "m" }
    var altitudeDomain: ClosedRange<Double> {
        let padding = max(5, (maximum - minimum) * 0.1)
        return (minimum - padding)...(maximum + padding)
    }
    var hasLocations: Bool { points.first?.latitude != nil }

    static func decode(_ cached: CachedStreamSummary) -> Self? {
        guard cached.isCurrent, cached.metadata.state == .current,
              cached.hasElevationProfileCandidate, let compact = cached.dto.summary,
              let summary = try? CompactStreamCodec.decode(compact) else { return nil }
        return make(summary)
    }

    static func make(_ summary: ActivityMapAPI.StreamSummary) -> Self? {
        guard summary.version == 1, let basis = summary.basis,
              let distance = summary.distance, let altitude = summary.altitude,
              distance.count > 1, distance.count == altitude.count,
              distance.allSatisfy({ $0.isFinite && $0 >= 0 }), altitude.allSatisfy(\.isFinite),
              zip(distance, distance.dropFirst()).allSatisfy({ $0 <= $1 }),
              let start = distance.first, let end = distance.last, end > start,
              let minimum = altitude.min(), let maximum = altitude.max() else { return nil }
        let locations = summary.latlng.flatMap { values -> [[Double]]? in
            guard values.count == distance.count, values.allSatisfy({
                $0.count == 2 && $0[0].isFinite && $0[1].isFinite
                    && abs($0[0]) <= 90 && abs($0[1]) <= 180
            }) else { return nil }
            return values
        }
        return Self(points: distance.indices.map { index in
            Point(id: index, distance: distance[index] - start, altitude: altitude[index],
                  latitude: locations?[index][0], longitude: locations?[index][1])
        }, samplingBasis: basis, span: end - start, minimum: minimum, maximum: maximum)
    }

    func nearest(to distance: Double) -> Point {
        // At most 300 points; ties select the first supplied sample consistently.
        points.min { abs($0.distance - distance) < abs($1.distance - distance) }!
    }

    func distanceLabel(_ metres: Double) -> String {
        "\((metres / distanceDivisor).formatted(.number.precision(.fractionLength(0...(usesKilometres ? 1 : 0))))) \(distanceUnit)"
    }
    var description: String {
        "\(distanceLabel(span)), elevation \(minimum.formatted(.number.precision(.fractionLength(0...1)))) to \(maximum.formatted(.number.precision(.fractionLength(0...1)))) m"
    }
    func selectionLabel(_ point: Point) -> String {
        "\(distanceLabel(point.distance)) · \(point.altitude.formatted(.number.precision(.fractionLength(0)))) m"
    }
    func valueLabel(_ point: Point) -> String {
        "\(distanceLabel(point.distance)) · \(point.altitude.formatted(.number.precision(.fractionLength(0...1)))) m elevation"
    }
}

/// The encoded identity fences markers against source invalidation and logout.
nonisolated struct ElevationCursor: Equatable {
    let owner: UUID
    let activityID: Int
    let cached: CachedStreamSummary
    let point: ElevationProfile.Point
}

@MainActor extension ActivityStore {
    var elevationCoordinate: CLLocationCoordinate2D? {
        guard selectedTab == .map, let cursor = elevationCursor,
              cursor.activityID == activeActivityID, visibleActivityIDs.contains(cursor.activityID),
              activity(id: cursor.activityID) != nil,
              streamSummaries?.currentSummary(for: String(cursor.activityID)) == cursor.cached,
              let latitude = cursor.point.latitude, let longitude = cursor.point.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

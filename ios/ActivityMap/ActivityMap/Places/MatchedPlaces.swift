import Foundation
import SwiftUI

nonisolated struct DisplayMatchedPlace: Identifiable {
    let place: ActivityMapAPI.MatchedPlace
    let activityIDs: [String]
    var id: String { place.id }
    static func aggregate(_ results: [ActivityMapAPI.ActivityPlaces]) -> [Self] {
        var places: [String: ActivityMapAPI.MatchedPlace] = [:]
        var owners: [String: Set<String>] = [:]
        for result in results where result.status == .complete {
            for place in result.places {
                places[place.id] = place
                owners[place.id, default: []].insert(result.activityID)
            }
        }
        return places.values.map { Self(place: $0, activityIDs: owners[$0.id, default: []].sorted()) }
            .sorted { $0.id < $1.id }
    }
}

nonisolated struct ProfilePlace: Identifiable, Equatable {
    let id: String
    let place: ActivityMapAPI.MatchedPlace
    let distance: Double
    let altitude: Double
    static func project(_ result: ActivityMapAPI.ActivityPlaces?, onto profile: ElevationProfile,
                        metadata: ActivityMapAPI.StreamMetadata) -> [Self] {
        guard let result, result.status == .complete, result.streamGeneration == metadata.generation,
              result.streamRevision == metadata.revision else { return [] }
        return result.places.flatMap { place in
            place.visits.enumerated().compactMap { index, visit in
                guard let distance = visit.distanceM, distance.isFinite else { return nil }
                let x = distance - profile.providerDistanceStart
                guard x >= 0, x <= profile.span else { return nil }
                let exact = profile.points.filter { $0.distance == x }
                let altitude: Double
                if let first = exact.first {
                    guard exact.allSatisfy({ $0.altitude == first.altitude }) else { return nil }
                    altitude = first.altitude
                } else {
                    guard let right = profile.points.firstIndex(where: { $0.distance > x }), right > 0 else { return nil }
                    let a = profile.points[right - 1], b = profile.points[right]
                    guard b.distance > a.distance else { return nil }
                    altitude = a.altitude + (b.altitude - a.altitude) * (x - a.distance) / (b.distance - a.distance)
                }
                return Self(id: "\(place.id):\(index)", place: place, distance: x, altitude: altitude)
            }
        }
    }
}

extension ActivityMapAPI.MatchedPlace {
    var kind: ActivityMapAPI.PlaceKind { kinds.contains(.peak) ? .peak : kinds.contains(.pass) ? .pass : .hut }
    var kindLabel: String { kind == .peak ? "Peak" : kind == .pass ? "Pass" : "Hut" }
}

struct MatchedPlaceSymbol: View {
    let place: ActivityMapAPI.MatchedPlace
    var active = false
    var body: some View {
        Group {
            if place.kind == .pass {
                MountainPassGlyph().frame(width: 18, height: 18)
            } else {
                Image(systemName: place.kind == .peak ? "mountain.2.fill" : "house.fill")
                    .font(.system(size: 14, weight: .semibold)).symbolRenderingMode(.monochrome)
            }
        }
        .foregroundStyle(active ? Color(uiColor: .systemBackground) : Color.primary)
        .frame(width: 26, height: 26)
        .background(active ? Color.primary : Color(uiColor: .systemBackground), in: Circle())
        .overlay(Circle().stroke(Color.primary.opacity(active ? 1 : 0.3), lineWidth: active ? 2 : 1))
        .accessibilityHidden(true)
    }
}

struct MatchedPlaceCard: View {
    let place: ActivityMapAPI.MatchedPlace
    var routeCount = 1
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(place.name).font(.headline)
            Text(place.kindLabel).font(.subheadline).foregroundStyle(.secondary)
            if let elevation = place.elevationM {
                let units = preferences?.units ?? .metric
                Text("\((elevation / units.elevationScale).formatted(.number.precision(.fractionLength(0)))) \(units.elevationUnit)")
                    .font(.subheadline)
            }
            if routeCount > 1 { Text("\(routeCount) selected routes").font(.caption) }
            Link("© OpenStreetMap contributors", destination: URL(string: "https://www.openstreetmap.org/copyright")!)
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(12).frame(maxWidth: 250, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
    }
}

/// Two offset, angular strokes: the conventional map symbol for a pass.
/// Drawn as a vector so the same neutral glyph stays sharp on map and profile.
nonisolated struct MountainPassGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 120
        let origin = CGPoint(x: rect.midX - 60 * scale, y: rect.midY - 60 * scale)
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
        }
        var path = Path()
        path.move(to: point(10, 70)); path.addLine(to: point(30, 70))
        path.addLine(to: point(70, 30)); path.addLine(to: point(70, 10))
        path.move(to: point(50, 110)); path.addLine(to: point(50, 90))
        path.addLine(to: point(90, 50)); path.addLine(to: point(110, 50))
        return path.strokedPath(StrokeStyle(lineWidth: 14 * scale, lineCap: .butt, lineJoin: .miter))
    }
}

import Foundation
import SwiftUI

nonisolated struct DisplayMatchedPlace: Identifiable, Equatable {
    let place: ActivityMapAPI.MatchedPlace
    let activityIDs: [String]
    var id: String { place.id }
    static func clusterKind(_ places: [Self]) -> ActivityMapAPI.PlaceKind? {
        let kinds = Set(places.flatMap { $0.place.kinds })
        return kinds.count == 1 ? kinds.first : nil
    }
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
                // Summary endpoint buckets are averaged, so raw encounters may
                // fall outside their domain. Keep those visits at the plot edge.
                let x = min(profile.span, max(0, distance - profile.providerDistanceStart))
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
    var mapMarker = false
    var body: some View {
        PlaceGlyph(kind: place.kind).fill(active || mapMarker ? Color.white : Color(uiColor: .systemBackground))
            .frame(width: PlaceGlyph.chartSymbol(for: place.kind).size,
                   height: PlaceGlyph.chartSymbol(for: place.kind).size)
            .frame(width: PlaceGlyph.chartSymbol(for: place.kind).diameter,
                   height: PlaceGlyph.chartSymbol(for: place.kind).diameter)
            .background(Circle().fill(active ? AppTheme.accent : mapMarker ? MapMarkerPalette.ink : Color.primary))
            .overlay { if mapMarker { Circle().stroke(.white, lineWidth: 1.5) } }
            .accessibilityHidden(true)
    }
}

/// The place filter on the map: an accent pin whose tip marks the place.
/// Taps pass through to the routes and places beneath.
struct PlaceFilterPin: View {
    let place: ActivityMapAPI.MatchedPlace
    var body: some View {
        VStack(spacing: -2) {
            PlaceGlyph(kind: place.kind).fill(Color.white)
                .frame(width: PlaceGlyph.chartSymbol(for: place.kind).size, height: PlaceGlyph.chartSymbol(for: place.kind).size)
                .frame(width: 32, height: 32)
                .background(Circle().fill(AppTheme.accent))
                .overlay { Circle().stroke(.white, lineWidth: 2) }
            Image(systemName: "arrowtriangle.down.fill").font(.system(size: 10)).foregroundStyle(AppTheme.accent)
        }
        .shadow(color: .black.opacity(0.3), radius: 3, y: 1)
        .allowsHitTesting(false)
        .accessibilityElement()
        .accessibilityLabel("Place filter: \(place.name)")
        .accessibilityIdentifier("place-filter-pin")
    }
}

struct MatchedPlaceCard: View {
    let place: ActivityMapAPI.MatchedPlace
    var routeCount = 1
    var overview = false
    var onClose: () -> Void = {}
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(place.name).font(.caption.weight(.semibold)).foregroundStyle(AppTheme.accent)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 4) {
                    if let elevation = place.elevationM {
                        let units = preferences?.units ?? .metric
                        Text("\((elevation / units.elevationScale).formatted(.number.precision(.fractionLength(0)))) \(units.elevationUnit)")
                    }
                    if routeCount > 1 { Text("\(place.elevationM == nil ? "" : "· ")\(routeCount) \(overview ? "activities" : "selected routes")") }
                }.font(.caption2).foregroundStyle(.secondary)
            }.padding(.vertical, 6).padding(.leading, 10)
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 12, weight: .medium))
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain).foregroundStyle(.secondary)
            .accessibilityLabel("Close place").accessibilityIdentifier("close-place")
        }
        .frame(maxWidth: 220).fixedSize(horizontal: true, vertical: true)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
    }
}

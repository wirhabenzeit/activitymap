import MapboxMaps
import SwiftUI
import UIKit

/// All routes live in one GeoJSON source (mirroring the web map's
/// `routeSource`); filtering and highlighting are layer filters over it, so
/// changing filters never re-uploads geometry.
enum RouteSource {
    static let id = "routeSource"
    static let ordinaryLayerID = "routeLayer"

    static func data(for activities: [Activity]) -> GeoJSONSourceData {
        let features = activities.compactMap { activity -> Feature? in
            guard activity.coordinates.count > 1 else { return nil }
            var feature = Feature(geometry: .lineString(LineString(activity.coordinates)))
            feature.identifier = .string(String(activity.id))
            feature.properties = [
                "id": .string(String(activity.id)),
                "sport_type": .string(activity.sportType.rawValue),
            ]
            return feature
        }
        return .featureCollection(FeatureCollection(features: features))
    }

    /// `match` on `sport_type`, grouped by category, falling back to black.
    static let lineColor: Exp = {
        var arguments: [Exp.Argument] = [.expression(Exp(.get) { "sport_type" })]
        for category in ActivityCategory.allCases {
            let sportTypes = SportType.allCases.filter { $0.category == category }
            guard !sportTypes.isEmpty else { continue }
            arguments.append(.stringArray(sportTypes.map(\.rawValue)))
            arguments.append(.string(StyleColor(UIColor(category.color)).rawValue))
        }
        arguments.append(.string("#000000"))
        return Exp(.match, arguments)
    }()

    /// Matches features whose `id` is in `ids`. `match` needs at least one
    /// label, so an empty set becomes a constant `false`.
    static func filter(ids: [Int]) -> Exp {
        guard !ids.isEmpty else { return Exp(.literal) { false } }
        return Exp(.match) {
            Exp(.get) { "id" }
            ids.map(String.init)
            true
            false
        }
    }
}

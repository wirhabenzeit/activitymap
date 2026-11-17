import MapLibre
import UIKit

enum RouteSource {
    static let id = "routeSource"
    static let ordinaryLayerID = "routeLayer"
    static func data(for activities: [Activity]) -> MLNShape {
        MLNShapeCollectionFeature(shapes: activities.compactMap { activity in
            guard activity.coordinates.count > 1 else { return nil }
            var coordinates = activity.coordinates
            let feature = MLNPolylineFeature(coordinates: &coordinates, count: UInt(coordinates.count))
            feature.identifier = String(activity.id)
            feature.attributes = ["id": String(activity.id), "sport_type": activity.sportType.rawValue]
            return feature
        })
    }
    /// An explicit match preserves UIColor outputs as style colours. A generic
    /// dictionary lookup treats its values as untyped literals in MapLibre.
    static let lineColor: NSExpression = {
        var matches: [NSExpression: NSExpression] = [:]
        for sport in SportType.allCases {
            let color = UIColor(named: sport.category.assetName) ?? .black
            matches[NSExpression(forConstantValue: sport.rawValue)] = NSExpression(forConstantValue: color)
        }
        return NSExpression(forMLNMatchingKey: NSExpression(forKeyPath: "sport_type"),
                            in: matches, default: NSExpression(forConstantValue: UIColor.black))
    }()
    static func filter(ids: [Int]) -> NSPredicate {
        NSPredicate(format: "id IN %@", ids.map(String.init))
    }
}

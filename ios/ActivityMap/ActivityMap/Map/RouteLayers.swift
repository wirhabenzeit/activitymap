import MapLibre
import UIKit

struct RouteLayers {
    private static let sources = NSMapTable<MLNStyle, MLNShapeSource>.weakToStrongObjects()
    let data: MLNShape
    let visibleIDs: Set<Int>
    let selectedIDs: Set<Int>
    let activeID: Int?

    func sync(style: MLNStyle) {
        let source: MLNShapeSource
        if let existing = Self.sources.object(forKey: style) {
            source = existing
            if existing.shape !== data { existing.shape = data }
        } else {
            let created = MLNShapeSource(identifier: RouteSource.id, shape: data, options: nil)
            Self.sources.setObject(created, forKey: style)
            source = created
            style.addSource(source)
        }
        let visible = RouteSource.filter(ids: visibleIDs.sorted())
        let selected = RouteSource.filter(ids: selectedIDs.intersection(visibleIDs).sorted())
        let active = RouteSource.filter(ids: activeID.flatMap { visibleIDs.contains($0) ? [$0] : nil } ?? [])
        let definitions: [(String, CGFloat, UIColor?, NSPredicate)] = [
            (RouteSource.ordinaryLayerID, 3, nil, visible),
            ("routeSelectedCasing", 8, .white, selected), ("routeSelected", 5, nil, selected),
            ("routeActiveCasing", 12, .black, active), ("routeActiveHalo", 9, .white, active),
            ("routeActive", 6, nil, active)
        ]
        for (id, width, color, filter) in definitions {
            let layer = style.layer(withIdentifier: id) as? MLNLineStyleLayer ?? MLNLineStyleLayer(identifier: id, source: source)
            layer.predicate = filter
            layer.lineWidth = NSExpression(forConstantValue: width)
            layer.lineColor = color.map { NSExpression(forConstantValue: $0) } ?? RouteSource.lineColor
            layer.lineJoin = NSExpression(forConstantValue: "round")
            layer.lineCap = NSExpression(forConstantValue: "round")
            if style.layer(withIdentifier: id) == nil { style.addLayer(layer) }
        }
    }
}

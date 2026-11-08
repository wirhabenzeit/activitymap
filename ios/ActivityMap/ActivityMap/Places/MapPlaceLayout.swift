import Foundation

/// Same policy and grouping as web; see shared/parity/map-places.v1.json.
nonisolated enum MapPlaceLayout {
    static let labelZoom: CGFloat = 12
    static let pinSpacing: CGFloat = 48
    static let viewportMargin: CGFloat = 44
    static let maxMarkers = 80
    static let chooserZoom: CGFloat = 18
    typealias Point = MapPointLayout.Point
    typealias Group = MapPointLayout.Group

    static func groups(_ points: [Point], size: CGSize, focusedID: String? = nil) -> [Group] {
        let focused = points.first { $0.id == focusedID }
        var groups = MapPointLayout.groups(points.filter { $0.id != focusedID }, size: size,
            spacing: pinSpacing, maxMarkers: maxMarkers - (focused == nil ? 0 : 1), viewportMargin: viewportMargin)
        if let focused {
            groups += MapPointLayout.groups([focused], size: size,
                spacing: pinSpacing, maxMarkers: 1, viewportMargin: viewportMargin)
        }
        return groups
    }
}

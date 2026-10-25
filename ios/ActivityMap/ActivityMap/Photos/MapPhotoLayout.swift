import CoreLocation
import Foundation

/// Same screen-space policy as web; shared fixture: map-photos.v1.json.
nonisolated enum MapPhotoLayout {
    static let thumbnailZoom: CGFloat = 12
    static let pinSpacing: CGFloat = 48
    static let thumbnailSpacing: CGFloat = 72
    static let viewportMargin: CGFloat = 44
    static let maxMarkers = 80

    typealias Point = MapPointLayout.Point
    struct Group: Identifiable, Equatable {
        let id: String
        let x: CGFloat
        let y: CGFloat
        var photoIDs: [String]
    }
    static func validLocation(_ location: CLLocationCoordinate2D?) -> Bool {
        guard let location else { return false }
        return location.latitude.isFinite && location.longitude.isFinite &&
            abs(location.latitude) <= 90 && abs(location.longitude) <= 180
    }

    static func groups(_ points: [Point], size: CGSize, zoom: CGFloat) -> [Group] {
        guard zoom.isFinite else { return [] }
        return MapPointLayout.groups(points, size: size,
            spacing: zoom >= thumbnailZoom ? thumbnailSpacing : pinSpacing,
            maxMarkers: maxMarkers, viewportMargin: viewportMargin).map {
                Group(id: $0.id, x: $0.x, y: $0.y, photoIDs: $0.pointIDs)
            }
    }
}

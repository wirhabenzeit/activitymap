import MapboxMaps
import UIKit

/// Tight geographic envelope, using the shortest longitude arc rather than
/// the world-spanning min/max interval for routes crossing ±180°.
struct RouteExtent {
    let west: Double
    let east: Double
    let south: Double
    let north: Double

    init?(coordinates: some Sequence<CLLocationCoordinate2D>) {
        let valid = coordinates.filter {
            $0.latitude.isFinite && $0.longitude.isFinite
                && (-90...90).contains($0.latitude) && (-180...180).contains($0.longitude)
        }
        guard !valid.isEmpty else { return nil }
        south = max(-85, min(85, valid.map(\.latitude).min()!))
        north = max(-85, min(85, valid.map(\.latitude).max()!))
        let longitudes = valid.map { $0.longitude < 0 ? $0.longitude + 360 : $0.longitude }.sorted()
        var largestGap = -Double.infinity
        var gapIndex = 0
        for i in longitudes.indices {
            let next = i + 1 < longitudes.count ? longitudes[i + 1] : longitudes[0] + 360
            let gap = next - longitudes[i]
            if gap > largestGap { largestGap = gap; gapIndex = i }
        }
        var start = longitudes[(gapIndex + 1) % longitudes.count]
        if start > 180 { start -= 360 }
        west = start
        east = start + 360 - largestGap
    }

    var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: (south + north) / 2, longitude: (west + east) / 2)
    }
    var corners: [CLLocationCoordinate2D] {
        // A tiny nonzero extent plus the fitting zoom cap makes point/short
        // routes useful without zooming to an extreme or dividing by zero.
        let dx = max(east - west, 0.0001) / 2
        let dy = max(north - south, 0.0001) / 2
        return [
            CLLocationCoordinate2D(latitude: center.latitude - dy, longitude: center.longitude - dx),
            CLLocationCoordinate2D(latitude: center.latitude + dy, longitude: center.longitude - dx),
            CLLocationCoordinate2D(latitude: center.latitude - dy, longitude: center.longitude + dx),
            CLLocationCoordinate2D(latitude: center.latitude + dy, longitude: center.longitude + dx),
        ]
    }
}

enum RouteCameraFitter {
    static func padding(safeArea: UIEdgeInsets, sheetHeight: CGFloat, topOcclusion: CGFloat = 0) -> UIEdgeInsets {
        UIEdgeInsets(top: max(safeArea.top + 64, topOcclusion + 16), left: safeArea.left + 24,
                     bottom: max(safeArea.bottom + 80, sheetHeight + 24), right: safeArea.right + 80)
    }

    static func camera(extent: RouteExtent, map: MapboxMap, padding: UIEdgeInsets, size: CGSize,
                       current: MapCamera) throws -> CameraOptions {
        // Explicit Mercator supports native camera fitting for all catalogue
        // styles, including the low-zoom default style's globe projection.
        try map.setProjection(StyleProjection(name: .mercator))
        let fitted = try map.camera(
            for: extent.corners,
            camera: CameraOptions(center: extent.center, padding: .zero, zoom: 0,
                                  bearing: current.bearing, pitch: current.pitch),
            coordinatesPadding: padding, maxZoom: 16, offset: nil
        )
        // The first SDK fit can clip the near edge of a pitched route behind
        // asymmetric padding. Refine against the actual unobscured screen rect.
        var refined = map.camera(for: extent.corners, camera: fitted,
                                 rect: CGRect(origin: .zero, size: size).inset(by: padding))
        refined.zoom = min(refined.zoom ?? fitted.zoom ?? 16, fitted.zoom ?? 16, 16)
        return refined
    }
}

/// Resolves only explicit requests. No fit is triggered by selection changes,
/// geometry refreshes, repeated body evaluation or sheet detent changes.
@MainActor
enum MapNavigation {
    static func resolve(store: ActivityStore, map: MapboxMap, size: CGSize,
                        safeArea: UIEdgeInsets, sheetHeight: CGFloat, topOcclusion: CGFloat = 0) -> CameraOptions? {
        let context = store.mapContext
        guard let request = context.pendingRequest, map.isStyleLoaded,
              size.width > 0, size.height > 0 else { return nil }
        let current = context.camera
        switch request.action {
        case .resetView:
            context.consume(request)
            let initial = MapCamera.initial
            return CameraOptions(center: initial.center, padding: .zero, zoom: initial.zoom,
                                 bearing: initial.bearing, pitch: initial.pitch)
        case .resetBearing:
            context.consume(request)
            return CameraOptions(center: current.center, zoom: current.zoom, bearing: 0, pitch: current.pitch)
        case let .pitch(pitch):
            context.consume(request)
            return CameraOptions(center: current.center, zoom: current.zoom, bearing: current.bearing, pitch: pitch)
        default: break
        }
        let activities: [Activity]
        switch request.action {
        case let .activity(id):
            guard let activity = store.activities.first(where: { $0.id == id }) else {
                context.consume(request); return nil
            }
            guard store.selection.visibleIDs.contains(id) else {
                context.hiddenTargetID = id
                context.consume(request); return nil
            }
            activities = [activity]
        case .fitSelection:
            activities = store.filteredActivities.filter { store.selectedActivityIDs.contains($0.id) }
        case .fitFiltered:
            activities = store.filteredActivities
        default: return nil
        }
        guard let extent = RouteExtent(coordinates: activities.flatMap(\.coordinates)) else {
            context.navigationError = "These activities have no GPS route to frame."
            context.consume(request); return nil
        }
        let padding = RouteCameraFitter.padding(safeArea: safeArea, sheetHeight: sheetHeight, topOcclusion: topOcclusion)
        // Wait for a large sheet to shrink/dismiss instead of fitting into a
        // sliver or consuming a request before usable map space exists.
        guard size.width - padding.left - padding.right >= 80,
              size.height - padding.top - padding.bottom >= 80,
              CGRect(origin: .zero, size: size).inset(by: padding)
                .contains(CGPoint(x: size.width / 2, y: size.height / 2)) else { return nil }
        do {
            let camera = try RouteCameraFitter.camera(extent: extent, map: map, padding: padding, size: size, current: current)
            guard camera.center != nil, let zoom = camera.zoom, zoom.isFinite else { throw CameraError.invalidFit }
            context.consume(request)
            return camera
        } catch {
            context.navigationError = "The route could not be framed. Try again once the map has loaded."
            context.consume(request)
            return nil
        }
    }

    private enum CameraError: Error { case invalidFit }
}

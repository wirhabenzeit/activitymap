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
    static func padding(safeArea: UIEdgeInsets, sheetHeight: CGFloat, topOcclusion: CGFloat = 0,
                        leadingOcclusion: CGFloat = 0, trailingOcclusion: CGFloat = 0) -> UIEdgeInsets {
        UIEdgeInsets(top: max(safeArea.top + 64, topOcclusion + 16), left: max(safeArea.left + 24, leadingOcclusion + 16),
                     bottom: max(safeArea.bottom + 80, sheetHeight + 24), right: max(safeArea.right + 80, trailingOcclusion + 16))
    }

    static func camera(extent: RouteExtent, map: MapboxMap, padding: UIEdgeInsets, size: CGSize,
                       current: MapCamera) throws -> CameraOptions {
        // Explicit Mercator supports native camera fitting for all catalogue
        // styles, including the low-zoom default style's globe projection.
        if map.projection?.name != .mercator {
            try map.setProjection(StyleProjection(name: .mercator))
        }
        let fitted = try map.camera(
            for: extent.corners,
            camera: CameraOptions(center: extent.center, padding: padding, zoom: 0,
                                  bearing: current.bearing, pitch: current.pitch),
            coordinatesPadding: .zero, maxZoom: 16, offset: nil
        )
        // Keep the projection's principal point inside the visible rectangle.
        // Coordinate-only padding leaves it at the physical map center, where
        // the SDK's pitched refinement fails when a sheet covers that point.
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
                        safeArea: UIEdgeInsets, sheetHeight: CGFloat, topOcclusion: CGFloat = 0,
                        leadingOcclusion: CGFloat = 0, trailingOcclusion: CGFloat = 0) -> CameraOptions? {
        let context = store.mapContext
        guard let request = context.pendingRequest, map.isStyleLoaded,
              size.width > 0, size.height > 0 else { return nil }
        let current = context.camera
        switch request.action {
        case let .locate(latitude, longitude):
            context.consume(request)
            let coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            guard latitude.isFinite, longitude.isFinite, CLLocationCoordinate2DIsValid(coordinate) else {
                context.navigationError = "Your current location is unavailable. Try again outdoors."
                return nil
            }
            context.recordLocatedPosition(coordinate)
            // Show the nearby streets without pulling an already closer view back out.
            return CameraOptions(center: coordinate, padding: current.padding, zoom: max(current.zoom, 15),
                                 bearing: current.bearing, pitch: current.pitch)
        case let .place(latitude, longitude, sheetFraction):
            context.consume(request)
            let coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            guard CLLocationCoordinate2DIsValid(coordinate) else { return nil }
            let fitted = RouteCameraFitter.padding(safeArea: safeArea, sheetHeight: max(sheetHeight, size.height * sheetFraction),
                                                   topOcclusion: topOcclusion)
            // Centred between the side insets, close enough to see the routes around it.
            let padding = UIEdgeInsets(top: fitted.top, left: max(safeArea.left, leadingOcclusion), bottom: fitted.bottom,
                                       right: max(safeArea.right, trailingOcclusion))
            return CameraOptions(center: coordinate, padding: padding, zoom: min(max(current.zoom, 13), 15),
                                 bearing: current.bearing, pitch: current.pitch)
        case .resetView:
            context.consume(request)
            let initial = MapCamera.initial
            return CameraOptions(center: initial.center, padding: .zero, zoom: initial.zoom,
                                 bearing: initial.bearing, pitch: initial.pitch)
        case .resetBearing:
            context.consume(request)
            return CameraOptions(center: current.center, padding: current.padding, zoom: current.zoom, bearing: 0, pitch: current.pitch)
        case let .pitch(pitch):
            context.consume(request)
            return CameraOptions(center: current.center, padding: current.padding, zoom: current.zoom, bearing: current.bearing, pitch: pitch)
        default: break
        }
        let activities: [Activity]
        switch request.action {
        case let .activity(id), let .fitActivity(id):
            guard let activity = store.activities.first(where: { $0.id == id }) else {
                context.consume(request); return nil
            }
            guard store.visibleActivityIDs.contains(id) else {
                if case .activity = request.action { context.hiddenTargetID = id }
                context.consume(request); return nil
            }
            activities = [activity]
        case .fitSelection:
            activities = store.browsingActivities.filter { store.selectedActivityIDs.contains($0.id) }
        case .fitFiltered:
            activities = store.browsingActivities
        default: return nil
        }
        guard let extent = RouteExtent(coordinates: activities.flatMap(\.coordinates)) else {
            context.navigationError = "These activities have no GPS route to frame."
            context.consume(request); return nil
        }
        let padding = RouteCameraFitter.padding(safeArea: safeArea, sheetHeight: sheetHeight, topOcclusion: topOcclusion,
                                                leadingOcclusion: leadingOcclusion, trailingOcclusion: trailingOcclusion)
        // Fitting never resizes results. Let the user shrink an occluding sheet.
        guard size.width - padding.left - padding.right >= 80,
              size.height - padding.top - padding.bottom >= 80 else {
            // Show on map can arrive during a tab/navigation-bar resize. Keep
            // its request until the destination has a usable rendered layout.
            if case .activity = request.action { return nil }
            context.navigationError = "Shrink results to leave room for the route, then try Fit again."
            context.consume(request)
            return nil
        }
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

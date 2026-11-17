import MapLibre
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
    private enum FitError: Error { case invalid }
    static func padding(safeArea: UIEdgeInsets, sheetHeight: CGFloat, topOcclusion: CGFloat = 0,
                        leadingOcclusion: CGFloat = 0, trailingOcclusion: CGFloat = 0) -> UIEdgeInsets {
        UIEdgeInsets(top: max(safeArea.top + 64, topOcclusion + 16), left: max(safeArea.left + 24, leadingOcclusion + 16),
                     bottom: max(safeArea.bottom + 80, sheetHeight + 24), right: max(safeArea.right + 80, trailingOcclusion + 16))
    }

    static func camera(extent: RouteExtent, map: MapController, padding: UIEdgeInsets, size: CGSize,
                       current: MapCamera) throws -> MapCamera {
        // Native shape bounds normalize longitudes separately. Fit a translated
        // envelope when it crosses the date line, then restore its longitude.
        if extent.corners.contains(where: { abs($0.longitude) > 180 }) {
            let shift = extent.center.longitude >= 0 ? 180.0 : -180.0
            let shifted = RouteExtent(coordinates: extent.corners.map {
                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude - shift)
            })!
            var result = try camera(extent: shifted, map: map, padding: padding, size: size, current: current)
            result.center.longitude += shift
            if result.center.longitude > 180 { result.center.longitude -= 360 }
            if result.center.longitude < -180 { result.center.longitude += 360 }
            return result
        }
        var corners = extent.corners.map { coordinate in
            CLLocationCoordinate2D(latitude: coordinate.latitude,
                longitude: (coordinate.longitude + 540).truncatingRemainder(dividingBy: 360) - 180)
        }
        let shape = MLNPolyline(coordinates: &corners, count: UInt(corners.count))
        var seed = current
        seed.center = extent.center
        // Native fitting adds contentInset to edgePadding. Supply only the
        // difference so repeated fits never double the existing panel padding.
        let inset = map.view.contentInset
        let additional = UIEdgeInsets(top: padding.top - inset.top, left: padding.left - inset.left,
                                      bottom: padding.bottom - inset.bottom, right: padding.right - inset.right)
        let native = map.view.camera(map.nativeCamera(seed), fitting: shape, edgePadding: additional)
        native.pitch = current.pitch
        let projection = MLNMapProjection(mapView: map.view)
        let visible = CGRect(origin: .zero, size: size).inset(by: padding)
        // Refine in an independent projection. Fix the geographic center so
        // the result does not depend on the map's previous world copy/padding.
        native.centerCoordinate = extent.center
        var lower = 0.0, upper = 16.0
        var zoom = min(16, max(0, MLNZoomLevelForAltitude(native.altitude, native.pitch, native.centerCoordinate.latitude, size)))
        for _ in 0..<24 {
            native.altitude = MLNAltitudeForZoomLevel(zoom, native.pitch, native.centerCoordinate.latitude, size)
            projection.setCamera(native, with: padding)
            let points = corners.map { projection.convert($0) }
            guard points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { throw FitError.invalid }
            if points.allSatisfy({ visible.contains($0) }) { lower = zoom }
            else { upper = zoom }
            zoom = (lower + upper) / 2
        }
        zoom = max(0, lower - 0.001)
        return MapCamera(center: native.centerCoordinate, zoom: zoom, bearing: current.bearing,
                         pitch: current.pitch, padding: padding)

    }
}

/// Resolves only explicit requests. No fit is triggered by selection changes,
/// geometry refreshes, repeated body evaluation or sheet detent changes.
@MainActor
enum MapNavigation {
    static func resolve(store: ActivityStore, map: MapController, size: CGSize,
                        safeArea: UIEdgeInsets, sheetHeight: CGFloat, topOcclusion: CGFloat = 0,
                        leadingOcclusion: CGFloat = 0, trailingOcclusion: CGFloat = 0) -> MapCamera? {
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
            return MapCamera(center: coordinate, zoom: max(current.zoom, 15), bearing: current.bearing, pitch: current.pitch, padding: current.padding)
        case let .place(latitude, longitude, sheetFraction):
            context.consume(request)
            let coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            guard CLLocationCoordinate2DIsValid(coordinate) else { return nil }
            let fitted = RouteCameraFitter.padding(safeArea: safeArea, sheetHeight: max(sheetHeight, size.height * sheetFraction),
                                                   topOcclusion: topOcclusion)
            // Centred between the side insets, close enough to see the routes around it.
            let padding = UIEdgeInsets(top: fitted.top, left: max(safeArea.left, leadingOcclusion), bottom: fitted.bottom,
                                       right: max(safeArea.right, trailingOcclusion))
            return MapCamera(center: coordinate, zoom: min(max(current.zoom, 13), 15), bearing: current.bearing, pitch: current.pitch, padding: padding)
        case .resetView:
            context.consume(request)
            let initial = MapCamera.initial
            return MapCamera(center: initial.center, zoom: initial.zoom, bearing: initial.bearing, pitch: initial.pitch, padding: .zero)
        case .resetBearing:
            context.consume(request)
            return MapCamera(center: current.center, zoom: current.zoom, bearing: 0, pitch: current.pitch, padding: current.padding)
        case let .pitch(pitch):
            context.consume(request)
            return MapCamera(center: current.center, zoom: current.zoom, bearing: current.bearing, pitch: pitch, padding: current.padding)
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
            guard camera.zoom.isFinite else { throw CameraError.invalidFit }
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

import MapLibre
import Observation
import SwiftUI

/// Test styles use the same loading path as bundled and remote styles.
struct MapStyle: Equatable {
    var json: String?
    var url: URL?
    var globe = false
    init(json: String) { self.json = json }
    init(url: URL, globe: Bool = false) { self.url = url; self.globe = globe }
}

final class MapProxy {
    weak var map: MapController?
}

@MainActor
final class MapController {
    let view: MLNMapView
    var isStyleLoaded = false
    private static let controllers = NSMapTable<MLNMapView, MapController>.weakToWeakObjects()
    static func existing(for view: MLNMapView) -> MapController? { controllers.object(forKey: view) }
    init(view: MLNMapView) { self.view = view; Self.controllers.setObject(self, forKey: view) }
    var cameraState: MapCamera {
        MapCamera(center: view.centerCoordinate, zoom: view.zoomLevel, bearing: view.direction,
                  pitch: view.camera.pitch, padding: view.cameraEdgeInsets)
    }
    func point(for coordinate: CLLocationCoordinate2D) -> CGPoint {
        guard coordinate.latitude.isFinite, coordinate.longitude.isFinite,
              (-90...90).contains(coordinate.latitude) else { return CGPoint(x: CGFloat.nan, y: CGFloat.nan) }
        // Clustering can supply a neighbouring world copy at the date line.
        // The globe's visibility API requires a normalized longitude.
        let normalized = CLLocationCoordinate2D(latitude: coordinate.latitude,
            longitude: (coordinate.longitude + 180).truncatingRemainder(dividingBy: 360) + (coordinate.longitude < -180 ? 180 : -180))
        guard !view.isCoordinateOccluded(normalized) else { return CGPoint(x: CGFloat.nan, y: CGFloat.nan) }
        return view.convert(normalized, toPointTo: view)
    }
    func points(for coordinates: [CLLocationCoordinate2D]) -> [CGPoint] { coordinates.map(point(for:)) }
    func triggerRepaint() { view.setNeedsDisplay() }
    func nativeCamera(_ camera: MapCamera) -> MLNMapCamera {
        MLNMapCamera(lookingAtCenter: camera.center,
                     altitude: MLNAltitudeForZoomLevel(camera.zoom, camera.pitch, camera.center.latitude, view.bounds.size),
                     pitch: camera.pitch, heading: camera.bearing)
    }
    func move(to camera: MapCamera, duration: Double = 0.5, fly: Bool = false) {
        // Fitting reserves camera space without moving SDK ornaments. A map
        // contentInset also moves attribution and leaves it floating after Fit.
        let target = nativeCamera(camera)
        if fly { view.fly(to: target, edgePadding: camera.padding, withDuration: duration, completionHandler: nil) }
        else { view.setCamera(target, withDuration: duration, animationTimingFunction: CAMediaTimingFunction(name: .easeOut),
                              edgePadding: camera.padding, completionHandler: nil) }
    }
}

/// SwiftUI may load a cached style before assigning the map's first frame.
/// Position ornaments and restore the initial camera only once layout is usable.
final class ActivityMapLibreMapView: MLNMapView {
    var compassCenter: CGPoint? { didSet { setNeedsLayout() } }
    var cameraWhenLaidOut: (() -> Void)? { didSet { setNeedsLayout() } }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0, bounds.height > 0 else { return }
        if let center = compassCenter {
            let size = compassView.intrinsicContentSize
            let margins = CGPoint(x: bounds.width - center.x - size.width / 2 - safeAreaInsets.right,
                                  y: center.y - size.height / 2 - safeAreaInsets.top)
            if compassViewPosition != .topRight { compassViewPosition = .topRight }
            if compassViewMargins != margins { compassViewMargins = margins }
        }
        if let callback = cameraWhenLaidOut {
            cameraWhenLaidOut = nil
            callback()
        }
    }
}

struct MapLibreView: UIViewRepresentable {
    let proxy: MapProxy
    let initialCamera: MapCamera
    let style: MapStyle
    let bottomInset: CGFloat
    var compassCenter: CGPoint? = nil
    let sync: (MLNStyle) -> Void
    let styleLoaded: () -> Void
    let cameraMoved: (MapCamera) -> Void
    let idle: () -> Void
    let frameDrawn: () -> Void
    let gestureStarted: () -> Void
    let tap: (CGPoint) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> MLNMapView {
        let view = ActivityMapLibreMapView(frame: .zero, styleURL: nil)
        view.automaticallyAdjustsContentInset = false
        view.isRotateEnabled = false
        view.toleranceForSnappingToNorth = 10
        view.showsCompassView = true
        view.compassView.compassVisibility = .adaptive
        view.compassView.accessibilityIdentifier = "map-compass"
        let rotation = UIRotationGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.rotated(_:)))
        rotation.name = "ActivityMap.IntentionalRotation"
        rotation.delegate = context.coordinator
        view.addGestureRecognizer(rotation)
        let controller = MapController(view: view)
        context.coordinator.controller = controller
        proxy.map = controller
        view.delegate = context.coordinator
        let recognizer = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        recognizer.delegate = context.coordinator
        view.addGestureRecognizer(recognizer)
        for existing in view.gestureRecognizers ?? [] where existing !== recognizer {
            if let tap = existing as? UITapGestureRecognizer, tap.numberOfTapsRequired > 1 { recognizer.require(toFail: tap) }
        }
        return view
    }
    func updateUIView(_ view: MLNMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        MapAttributionLayout(bottomInset: bottomInset).apply(to: view)
        view.showsCompassView = compassCenter != nil
        (view as? ActivityMapLibreMapView)?.compassCenter = compassCenter
        if coordinator.loadedStyle != style {
            coordinator.loadedStyle = style
            coordinator.controller?.isStyleLoaded = false
            coordinator.load(style, into: view)
        }
        if let loaded = view.style, coordinator.controller?.isStyleLoaded == true { sync(loaded) }
    }
    static func dismantleUIView(_ view: MLNMapView, coordinator: Coordinator) {
        coordinator.styleTask?.cancel()
        view.delegate = nil
        coordinator.parent.proxy.map = nil
    }
    final class Coordinator: NSObject, MLNMapViewDelegate, UIGestureRecognizerDelegate {
        var parent: MapLibreView
        var controller: MapController?
        var rotation = MapRotationGesture()
        var rotationStarted = false
        @objc func rotated(_ recognizer: UIRotationGestureRecognizer) {
            guard let map = controller?.view else { return }
            switch recognizer.state {
            case .began:
                rotation.startingBearing = map.direction
                rotationStarted = false
            case .changed:
                guard let bearing = rotation.bearing(rotation: recognizer.rotation, engaged: rotationStarted) else { return }
                if !rotationStarted { rotationStarted = true; parent.gestureStarted() }
                map.direction = bearing
            case .ended, .cancelled:
                if rotationStarted && MapRotationGesture.shouldSnapToNorth(map.direction) { map.setDirection(0, animated: true) }
                rotationStarted = false
            default: break
            }
        }
        var loadedStyle: MapStyle?
        var styleTask: Task<Void, Never>?
        func load(_ style: MapStyle, into view: MLNMapView) {
            styleTask?.cancel()
            if let json = style.json { view.styleJSON = json; return }
            guard style.globe, let url = style.url else { view.styleURL = style.url; return }
            styleTask = Task { [weak view] in
                do {
                    let (data, response) = try await URLSession.shared.data(from: url)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        throw URLError(.badServerResponse)
                    }
                    let json = try MapStyleProjection.globeJSON(String(decoding: data, as: UTF8.self), relativeTo: response.url ?? url)
                    guard !Task.isCancelled else { return }
                    view?.styleJSON = json
                } catch {
                    guard !Task.isCancelled else { return }
                    // Let the SDK retry the original URL and report loading
                    // errors through its normal path if preparation failed.
                    view?.styleURL = url
                }
            }
        }
        init(_ parent: MapLibreView) { self.parent = parent }
        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            let restore = { [weak self] in
                guard let self else { return }
                // Geometry may change between a cached style loading and the
                // first layout. Install the latest snapshot when ready.
                self.parent.sync(style)
                self.controller?.isStyleLoaded = true
                self.controller?.move(to: self.parent.initialCamera, duration: 0)
                DispatchQueue.main.async { [weak self] in self?.parent.styleLoaded() }
            }
            if mapView.bounds.width > 0, mapView.bounds.height > 0 { restore() }
            else { (mapView as? ActivityMapLibreMapView)?.cameraWhenLaidOut = restore }
        }

        func mapViewRegionIsChanging(_ mapView: MLNMapView) {
            if let camera = controller?.cameraState { parent.cameraMoved(camera) }
        }
        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            if let camera = controller?.cameraState { parent.cameraMoved(camera) }
        }
        func mapView(_ mapView: MLNMapView, regionWillChangeWith reason: MLNCameraChangeReason, animated: Bool) {
            if reason.contains(.gesturePan) || reason.contains(.gesturePinch) || reason.contains(.gestureRotate) || reason.contains(.gestureTilt) || reason.contains(.gestureZoomIn) || reason.contains(.gestureZoomOut) || reason.contains(.gestureOneFingerZoom) {
                parent.gestureStarted()
            }
        }
        func mapViewDidBecomeIdle(_ mapView: MLNMapView) { parent.idle() }
        func mapViewDidFinishRenderingFrame(_ mapView: MLNMapView, fullyRendered: Bool) { parent.frameDrawn() }
        @objc func tapped(_ recognizer: UITapGestureRecognizer) { parent.tap(recognizer.location(in: recognizer.view)) }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}

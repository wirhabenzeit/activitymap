import MapLibre
import UIKit
@testable import ActivityMap

@MainActor
final class NativeMapTestDelegate: NSObject, MLNMapViewDelegate {
    weak var renderer: MapController?
    func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) { renderer?.isStyleLoaded = true }
}

extension MLNMapView {
    var renderer: MapController { MapController.existing(for: self)! }
}
extension MapController {
    func setCamera(to camera: MapCamera) { move(to: camera, duration: 0) }
    func layerExists(withId id: String) -> Bool { view.style?.layer(withIdentifier: id) != nil }
    func sourceExists(withId id: String) -> Bool { view.style?.source(withIdentifier: id) != nil }
}

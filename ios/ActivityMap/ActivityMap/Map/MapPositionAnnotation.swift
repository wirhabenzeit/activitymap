import MapboxMaps
import SwiftUI

/// View annotations stay above terrain and style layers, with a constant
/// point size instead of scaling or disappearing with the pitched map.
struct MapPositionAnnotation: MapContent {
    let coordinate: CLLocationCoordinate2D
    let label: String
    let identifier: String

    var body: some MapContent {
        MapViewAnnotation(coordinate: coordinate) {
            ZStack {
                Circle().fill(.white).frame(width: 26, height: 26)
                Circle().fill(Color(uiColor: .systemBlue)).frame(width: 20, height: 20)
            }
            .frame(width: 26, height: 26)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityIdentifier(identifier)
        }
        .allowOverlap(true)
        .allowOverlapWithPuck(true)
        .ignoreCameraPadding(true)
        .allowHitTesting(false)
        .priority(1000)
    }
}

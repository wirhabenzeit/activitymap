import MapboxMaps
import Observation
import SwiftUI
import UIKit

/// Observed only by the overlay, keeping frame updates out of MapScreen's body.
@Observable
final class MapPositionState {
    private(set) var located: CGPoint?
    private(set) var route: CGPoint?

    func update(map: MapboxMap, located: CLLocationCoordinate2D?, route: CLLocationCoordinate2D?) {
        func project(_ coordinate: CLLocationCoordinate2D?) -> CGPoint? {
            guard let coordinate else { return nil }
            let point = map.point(for: coordinate)
            guard point.x.isFinite, point.y.isFinite, point.x >= 0, point.y >= 0 else { return nil }
            return point
        }
        let newLocated = project(located), newRoute = project(route)
        if self.located != newLocated { self.located = newLocated }
        if self.route != newRoute { self.route = newRoute }
    }
}

/// SDK view annotations can be culled by steep terrain even when their screen
/// projection is visible. Draw the position indicators above the map instead.
struct MapPositionOverlay: View {
    let state: MapPositionState

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let point = state.located {
                MapPositionDot(label: "Last located position", identifier: "map-located-position")
                    .frame(width: 26, height: 26).position(point)
            }
            if let point = state.route {
                MapPositionDot(label: "Position on activity route", identifier: "map-route-position")
                    .frame(width: 26, height: 26).position(point)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .allowsHitTesting(false)
    }
}

private struct MapPositionDot: UIViewRepresentable {
    let label: String
    let identifier: String

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .systemBlue
        view.layer.cornerRadius = 13
        view.layer.borderColor = UIColor.white.cgColor
        view.layer.borderWidth = 3
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = true
        view.accessibilityLabel = label
        view.accessibilityIdentifier = identifier
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {}
}

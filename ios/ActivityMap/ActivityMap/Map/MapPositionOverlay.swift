import MapLibre
import Observation
import SwiftUI
import UIKit

/// Observed only by the overlay, keeping frame updates out of MapScreen's body.
@Observable
final class MapPositionState {
    private(set) var frame = 0
    private(set) var located: CGPoint?
    private(set) var route: CGPoint?

    func update(map: MapController, located: CLLocationCoordinate2D?, route: CLLocationCoordinate2D?) {
        frame &+= 1
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

/// The only reader of the elevation cursor on the map, so a scrub invalidates
/// this empty view rather than MapScreen.
struct ElevationCursorObserver: View {
    let store: ActivityStore
    let changed: () -> Void

    var body: some View {
        Color.clear
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onChange(of: store.elevationCursor) { _, _ in changed() }
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

/// Reads frame state in this small subtree, never in MapScreen.
struct GeographicOverlay<Content: View>: View {
    let coordinate: CLLocationCoordinate2D
    let positions: MapPositionState
    let proxy: MapProxy
    var anchor: UnitPoint = .center
    @ViewBuilder var content: () -> Content
    var body: some View {
        let _ = positions.frame
        if let map = proxy.map {
            let point = map.point(for: coordinate)
            if point.x.isFinite, point.y.isFinite {
                content()
                    .fixedSize()
                    .modifier(GeographicAnchor(point: point, anchor: anchor))
                    // Projection uses the native map's top-left origin. Claim
                    // the full overlay area so a small marker/card cannot make
                    // its parent stack shrink and center itself over the map.
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }
}
private struct GeographicAnchor: ViewModifier {
    let point: CGPoint
    let anchor: UnitPoint
    func body(content: Content) -> some View {
        content.visualEffect { view, geometry in
            view.offset(x: point.x - geometry.size.width * anchor.x,
                        y: point.y - geometry.size.height * anchor.y)
        }
    }
}

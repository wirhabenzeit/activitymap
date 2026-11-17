import MapLibre
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct MapCompassPreviewTests {
    @Test func rotationRequiresDeliberateTwistAndReturnsToStart() {
        let rotation = MapRotationGesture(startingBearing: 30)
        for degrees in [-10.0, -5, 0, 5, 10] { #expect(rotation.bearing(rotation: degrees * .pi / 180) == nil) }
        #expect(abs((rotation.bearing(rotation: 30 * .pi / 180) ?? 0) - 16) < 0.001)
        #expect(abs((rotation.bearing(rotation: -30 * .pi / 180) ?? 0) - 44) < 0.001)
        #expect(rotation.bearing(rotation: 0, engaged: true) == 30)
        #expect(MapRotationGesture.shouldSnapToNorth(355))
        #expect(MapRotationGesture.shouldSnapToNorth(-5))
        #expect(!MapRotationGesture.shouldSnapToNorth(40))
    }

    @Test func productionMapUsesNativeCompassAndDeliberateRotation() async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        let store = ActivityStore(activities: [])
        store.mapContext.restoreCamera(MapCamera(center: .init(latitude: 46, longitude: 8), zoom: 10, bearing: 40))
        let host = UIHostingController(rootView: MapScreen(store: store, topOcclusion: 80)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; previous?.makeKeyAndVisible() }
        func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap(descendants) }
        let deadline = Date().addingTimeInterval(10)
        var map: MLNMapView?
        repeat {
            map = descendants(host.view).first { $0 is MLNMapView } as? MLNMapView
            if map?.renderer.isStyleLoaded == true && map?.compassView.alpha ?? 0 > 0 { break }
            try await Task.sleep(for: .milliseconds(25))
        } while Date() < deadline
        let native = try #require(map)
        try #require(native.renderer.isStyleLoaded)
        #expect(native.showsCompassView && native.compassView.alpha > 0)
        #expect(!native.isRotateEnabled)
        #expect(native.gestureRecognizers?.contains { $0.name == "ActivityMap.IntentionalRotation" } == true)
        let frame = native.compassView.convert(native.compassView.bounds, to: native)
        #expect(native.bounds.contains(frame))
        #expect(frame.midX < native.bounds.width - 60, "Compass stays beside, rather than over, the map tools")
        #expect(frame.minY >= 80 && frame.maxY < 300)
    }

    @Test func renderNativeAndPreviousCompassesForReview() async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 700))
        defer { harness.close() }
        let map = harness.map
        map.showsCompassView = true
        map.compassView.isHidden = false
        map.compassView.compassVisibility = .visible
        map.compassViewMargins = CGPoint(x: 30, y: 70)
        harness.renderer.move(to: MapCamera(center: .init(latitude: 46, longitude: 8), zoom: 10, bearing: 40), duration: 0)
        let old = UIHostingController(rootView: MapCompassButton(state: MapCompassState(bearing: 40), reset: {}))
        old.view.backgroundColor = .clear
        old.view.frame = CGRect(x: 30, y: 70, width: 64, height: 64)
        harness.window.rootViewController?.addChild(old)
        harness.window.rootViewController?.view.addSubview(old.view)
        old.didMove(toParent: harness.window.rootViewController)
        harness.window.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(400))
        let directory = URL(fileURLWithPath: "/tmp/activitymap-compass-review")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        func capture(_ view: UIView, name: String) throws {
            let frame = view.convert(view.bounds, to: harness.window)
            let rect = CGRect(x: frame.midX - 36, y: frame.midY - 36, width: 72, height: 72)
            let image = UIGraphicsImageRenderer(size: rect.size).image { context in
                context.cgContext.translateBy(x: -rect.minX, y: -rect.minY)
                harness.window.drawHierarchy(in: harness.window.bounds, afterScreenUpdates: true)
            }
            try #require(image.pngData()).write(to: directory.appendingPathComponent(name + ".png"))
        }
        #expect(map.compassView.alpha > 0)
        try capture(map.compassView, name: "maplibre")
        try capture(old.view, name: "previous")
    }
}

import MapLibre
import Observation
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedMapToolsTests {
    @Test(arguments: [false, true])
    func locatedPositionStaysVisibleAtEveryZoomAndPitch(tablet: Bool) async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: tablet ? CGSize(width: 768, height: 1024) : CGSize(width: 390, height: 844))
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        store.replaceSelection(with: [1])
        let fixture = MapToolsStyleFixture()
        let host = UIHostingController(rootView: MapToolsFixtureView(store: store, picker: RoutePicker(), style: fixture))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        try await mapToolsWait { mapToolsDescendants(host.view, of: MLNMapView.self).first?.renderer.isStyleLoaded == true }
        let map = try #require(mapToolsDescendants(host.view, of: MLNMapView.self).first)
        store.mapContext.request(.resetView)
        try await mapToolsWait { store.mapContext.pendingRequest == nil }
        try await Task.sleep(for: .milliseconds(650))
        store.mapContext.request(.locate(latitude: 46.005, longitude: 8.005))
        try await mapToolsWait { store.mapContext.pendingRequest == nil && mapToolsPosition(in: host.view) != nil }
        try await Task.sleep(for: .milliseconds(650))
        #expect(abs(map.renderer.cameraState.zoom - 15) < 0.1, "Locate me animates from the overview to nearby streets")
        let coordinate = try #require(store.mapContext.locatedPosition)
        let selection = store.selectedActivityIDs, filters = store.activeSportTypes
        for zoom: CGFloat in [2, 6, 10, 14, 18, 22] {
            for pitch: CGFloat in [0, 50] {
                // Simulate manual map navigation, which leaves follow/viewport state idle.
                map.renderer.setCamera(to: MapCamera(center: coordinate, zoom: zoom, bearing: 25, pitch: pitch))
                try await mapToolsWait {
                    guard let view = mapToolsPosition(in: host.view) else { return false }
                    let frame = view.convert(view.bounds, to: map)
                    let projected = map.renderer.point(for: coordinate)
                    return !view.isHidden && view.alpha > 0 && frame.width >= 26 && frame.height >= 26
                        && map.bounds.contains(CGPoint(x: frame.midX, y: frame.midY))
                        && abs(frame.midX - projected.x) < 1 && abs(frame.midY - projected.y) < 1
                        && abs(map.renderer.cameraState.zoom - zoom) < 0.1
                }
                let view = try #require(mapToolsPosition(in: host.view))
                #expect(abs(view.bounds.width - 26) < 0.1 && abs(view.bounds.height - 26) < 0.1,
                        "Marker stays 26 points at zoom \(zoom), pitch \(pitch)")
                #expect(store.selectedActivityIDs == selection && store.activeSportTypes == filters)
                if zoom == 2 || zoom == 18 {
                    try await Task.sleep(for: .milliseconds(200))
                    try mapToolsSnapshot(window, name: "location-\(tablet ? "ipad" : "iphone")-z\(Int(zoom))-p\(Int(pitch))")
                }
            }
        }
        fixture.json = CameraHarness.style.replacingOccurrences(of: "#e5e8df", with: "#cfded8")
        store.mapContext.baseStyle = BaseStyle.all[1]
        try await mapToolsWait {
            map.renderer.isStyleLoaded && mapToolsPosition(in: host.view) != nil
                && mapToolsPosition(in: host.view)?.isHidden == false
        }
        #expect(store.mapContext.locatedPosition?.latitude == coordinate.latitude)
        map.renderer.setCamera(to: MapCamera(center: .init(latitude: 47, longitude: 9), zoom: 18))
        try await mapToolsWait { mapToolsPosition(in: host.view) == nil }
        map.renderer.setCamera(to: MapCamera(center: coordinate, zoom: 18))
        try await mapToolsWait { mapToolsPosition(in: host.view) != nil }
        store.clearScope()
        try await mapToolsWait { mapToolsPosition(in: host.view) == nil }
        #expect(store.mapContext.locatedPosition == nil)
    }

    @Test(arguments: [false, true])
    func geographicMarkersStayOnTheirCoordinateAfterPaddedRouteFit(bottomAnchored: Bool) async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 700))
        defer { harness.close() }
        // Match production: camera padding must not move native ornaments or
        // acquire a delayed UIKit navigation/safe-area inset after first layout.
        harness.map.automaticallyAdjustsContentInset = false
        let coordinate = CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005)
        let proxy = MapProxy()
        proxy.map = harness.renderer
        let positions = MapPositionState()
        let host = UIHostingController(rootView:
            ZStack(alignment: .topLeading) {
                GeographicOverlay(coordinate: coordinate, positions: positions, proxy: proxy,
                                  anchor: bottomAnchored ? .bottom : .center) {
                    Color.red.frame(width: bottomAnchored ? 160 : 44, height: bottomAnchored ? 64 : 44)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).ignoresSafeArea())
        let parent = try #require(harness.window.rootViewController)
        parent.addChild(host)
        host.view.frame = harness.map.frame
        host.view.backgroundColor = .clear
        parent.view.addSubview(host.view)
        host.didMove(toParent: parent)
        parent.view.layoutIfNeeded()
        host.view.layoutIfNeeded()
        for (padding, bearing, pitch): (UIEdgeInsets, Double, CGFloat) in [
            (.zero, 0, 0),
            (UIEdgeInsets(top: 80, left: 16, bottom: 280, right: 16), 35, 0),
            (UIEdgeInsets(top: 80, left: 16, bottom: 70, right: 120), 35, 50)
        ] {
            harness.renderer.move(to: MapCamera(center: coordinate, zoom: 13,
                bearing: bearing, pitch: pitch, padding: padding), duration: 0)
            positions.update(map: harness.renderer, located: nil, route: nil)
            try await Task.sleep(for: .milliseconds(120))
            let point = harness.renderer.point(for: coordinate)
            let bounds = try redMarkerBounds(in: host.view)
            #expect(abs(bounds.midX - point.x) <= 1,
                    "Geographic marker must share the native map's x origin, including padded fits")
            #expect(abs((bottomAnchored ? bounds.maxY : bounds.midY) - point.y) <= 1,
                    "Geographic marker must share the native map's y origin, including padded fits")
        }
    }

    @Test func pitchRemainsAvailableWithoutTerrain() async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 844))
        defer { harness.close() }
        let store = ActivityStore(activities: [])
        store.mapContext.request(.pitch(50))
        let target = try #require(MapNavigation.resolve(store: store, map: harness.renderer,
            size: harness.map.bounds.size, safeArea: .zero, sheetHeight: 0))
        harness.renderer.move(to: target, duration: 0)
        #expect(abs(harness.map.camera.pitch - 50) < 0.1)
        #expect(!MapTerrain.enabled)
    }
}

@Observable private final class MapToolsStyleFixture {
    var json = CameraHarness.style
}
private struct MapToolsFixtureView: View {
    let store: ActivityStore
    let picker: RoutePicker
    let style: MapToolsStyleFixture
    var body: some View {
        MapScreen(store: store, topOcclusion: 80, picker: picker)
            .environment(\.mapStyleOverride, MapStyle(json: style.json))
    }
}

@MainActor
private func mapToolsWait(sourceLocation: SourceLocation = #_sourceLocation, _ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(10)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
    try #require(condition(), "Map tools did not settle", sourceLocation: sourceLocation)
}

@MainActor
private func mapToolsPosition(in view: UIView) -> UIView? {
    mapToolsDescendants(view, of: UIView.self).first { $0.accessibilityIdentifier == "map-located-position" }
}

private func mapToolsDescendants<T: UIView>(_ view: UIView, of type: T.Type) -> [T] {
    ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap { mapToolsDescendants($0, of: type) }
}

@MainActor
private func mapToolsSnapshot(_ view: UIView, name: String) throws {
    view.layoutIfNeeded()
    let image = UIGraphicsImageRenderer(bounds: view.bounds).image { _ in
        view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
    }
    let directory = URL(fileURLWithPath: "/tmp/activitymap-map-tools-preview")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
}

/// Check rendered pixels: SwiftUI visual effects can leave layout frames in
/// their original positions, hiding a real on-screen displacement from UIKit.
@MainActor
private func redMarkerBounds(in view: UIView) throws -> CGRect {
    view.layoutIfNeeded()
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let image = UIGraphicsImageRenderer(bounds: view.bounds, format: format).image { _ in
        view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
    }
    let cgImage = try #require(image.cgImage)
    var pixels = [UInt8](repeating: 0, count: cgImage.width * cgImage.height * 4)
    try pixels.withUnsafeMutableBytes { bytes in
        let context = try #require(CGContext(data: bytes.baseAddress, width: cgImage.width, height: cgImage.height,
            bitsPerComponent: 8, bytesPerRow: cgImage.width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))
    }
    var minX = cgImage.width, minY = cgImage.height, maxX = -1, maxY = -1
    for y in 0..<cgImage.height {
        for x in 0..<cgImage.width {
            let offset = (y * cgImage.width + x) * 4
            if pixels[offset] > 200 && pixels[offset + 1] < 80 && pixels[offset + 2] < 80 && pixels[offset + 3] > 200 {
                minX = min(minX, x); maxX = max(maxX, x)
                minY = min(minY, y); maxY = max(maxY, y)
            }
        }
    }
    try #require(maxX >= minX && maxY >= minY, "Geographic marker must be visible")
    return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
}

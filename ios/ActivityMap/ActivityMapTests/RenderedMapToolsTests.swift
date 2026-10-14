import MapboxMaps
import Observation
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedMapToolsTests {
    @Test func terrainSourceFailureExplainsTiltAndAllowsRetry() async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        let store = ActivityStore()
        let fixture = try MapToolsStyleFixture()
        let validDEM = fixture.dem
        let invalidMetadata = FileManager.default.temporaryDirectory.appendingPathComponent("map-tools-invalid-dem.json")
        try Data("invalid TileJSON".utf8).write(to: invalidMetadata)
        fixture.dem = MapTerrainConfiguration(url: invalidMetadata.absoluteString)
        let host = UIHostingController(rootView: MapToolsFixtureView(store: store, picker: RoutePicker(), style: fixture))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        try await mapToolsWait { mapToolsDescendants(host.view, of: MapView.self).first?.mapboxMap.isStyleLoaded == true }
        let map = try #require(mapToolsDescendants(host.view, of: MapView.self).first)
        store.mapContext.request(.resetView)
        try await mapToolsWait { store.mapContext.pendingRequest == nil }
        try await Task.sleep(for: .milliseconds(650))
        store.mapContext.request(.pitch(50))
        try await mapToolsWait { store.mapContext.isPitched }
        try await mapToolsWait { host.presentedViewController is UIAlertController }
        let alert = try #require(host.presentedViewController as? UIAlertController)
        #expect(alert.title == "3D terrain" && alert.message?.contains("remains tilted") == true)
        try await mapToolsWait {
            let source: StylePropertyValue = map.mapboxMap.terrainProperty("source")
            return ((source.value as? String) ?? "").isEmpty && abs(map.mapboxMap.cameraState.pitch - 50) < 0.1
        }
        alert.dismiss(animated: false)
        store.mapContext.request(.pitch(0))
        try await mapToolsWait { !store.mapContext.isPitched }
        fixture.dem = validDEM
        store.mapContext.request(.pitch(50))
        try await mapToolsWait {
            (map.mapboxMap.elevation(at: MapCamera.initial.center) ?? 0) > 500
                && abs(map.mapboxMap.cameraState.pitch - 50) < 0.1
        }
        #expect(host.presentedViewController == nil)
    }

    @Test(arguments: [false, true])
    func terrainAndCompassPreserveCameraAcrossStyleReloads(tablet: Bool) async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        let size = tablet ? CGSize(width: 768, height: 1024) : CGSize(width: 390, height: 844)
        window.frame = CGRect(origin: .zero, size: size)
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        store.replaceSelection(with: [1])
        let picker = RoutePicker()
        let style = try MapToolsStyleFixture()
        let host = UIHostingController(rootView: MapToolsFixtureView(store: store, picker: picker, style: style))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        try await mapToolsWait { mapToolsDescendants(host.view, of: MapView.self).first?.mapboxMap.isStyleLoaded == true }
        let map = try #require(mapToolsDescendants(host.view, of: MapView.self).first)
        store.mapContext.request(.resetView)
        try await mapToolsWait { store.mapContext.pendingRequest == nil }
        try await Task.sleep(for: .milliseconds(650))
        map.mapboxMap.setCamera(to: CameraOptions(center: .init(latitude: 46.5, longitude: 8.5),
            padding: UIEdgeInsets(top: 110, left: 12, bottom: 80, right: 18), zoom: 10, bearing: 37, pitch: 0))
        try await mapToolsWait { abs(store.mapContext.camera.bearing - 37) < 0.1 }
        let original = map.mapboxMap.cameraState
        store.mapContext.request(.pitch(50))
        try await mapToolsWait {
            let source: StylePropertyValue = map.mapboxMap.terrainProperty("source")
            return (source.value as? String)?.hasPrefix("activitymap-dem-") == true
                && abs(map.mapboxMap.cameraState.pitch - 50) < 0.1
        }
        let first: StylePropertyValue = map.mapboxMap.terrainProperty("source")
        let sourceID = try #require(first.value as? String)
        let dem = try map.mapboxMap.source(withId: sourceID, type: RasterDemSource.self)
        #expect(dem.type == .rasterDem && dem.tileSize == 514 && dem.maxzoom == 14)
        #expect(map.mapboxMap.sourceExists(withId: RouteSource.id))
        #expect(map.mapboxMap.cameraState.padding == original.padding)
        #expect(abs(map.mapboxMap.cameraState.center.latitude - original.center.latitude) < 0.001)
        #expect(abs(map.mapboxMap.cameraState.zoom - original.zoom) < 0.01)
        #expect(abs(map.mapboxMap.cameraState.bearing - original.bearing) < 0.01)
        #expect(map.ornaments.options.compass.visibility == .hidden,
                "The default SDK compass must not compete with the custom control")
        picker.reviewSelection(store: store)
        picker.detent = .medium
        try await Task.sleep(for: .milliseconds(250))
        try mapToolsSnapshot(window, name: tablet ? "ipad-rotated-terrain" : "iphone-rotated-terrain")
        // Changing the environment uses the production declarative style path.
        // The offline DEM tests configuration and restoration, not real relief.
        style.json = CameraHarness.style.replacingOccurrences(of: "#e5e8df", with: "#cfded8")
        store.mapContext.baseStyle = BaseStyle.all[1]
        try await mapToolsWait {
            let source: StylePropertyValue = map.mapboxMap.terrainProperty("source")
            return (source.value as? String)?.hasPrefix("activitymap-dem-") == true
                && source.value as? String != sourceID
                && abs(map.mapboxMap.cameraState.pitch - 50) < 0.1
        }
        #expect(store.mapContext.isPitched && store.selectedActivityIDs == [1])
        #expect(map.mapboxMap.sourceExists(withId: RouteSource.id))
        #expect(map.ornaments.logoView.isHidden == false && map.ornaments.attributionButton.isHidden == false)
        #expect(abs(map.mapboxMap.cameraState.center.latitude - original.center.latitude) < 0.001)
        #expect(abs(map.mapboxMap.cameraState.zoom - original.zoom) < 0.01)
        #expect(abs(map.mapboxMap.cameraState.bearing - original.bearing) < 0.01)
        store.mapContext.request(.resetBearing)
        try await mapToolsWait { abs(map.mapboxMap.cameraState.bearing) < 0.1 }
        #expect(abs(map.mapboxMap.cameraState.pitch - 50) < 0.1)
        #expect(abs(map.mapboxMap.cameraState.zoom - original.zoom) < 0.01)
        try mapToolsSnapshot(window, name: tablet ? "ipad-north-up" : "iphone-north-up")
        store.mapContext.request(.pitch(0))
        try await mapToolsWait {
            let source: StylePropertyValue = map.mapboxMap.terrainProperty("source")
            return !store.mapContext.isPitched && ((source.value as? String) ?? "").isEmpty
        }
        #expect(store.selectedActivityIDs == [1])
        #expect(map.mapboxMap.cameraState.padding == original.padding)
    }
}

@MainActor @Observable
private final class MapToolsStyleFixture {
    var json = CameraHarness.style
    var dem: MapTerrainConfiguration

    init() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let size = CGSize(width: 514, height: 514)
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            // Mapbox RGB encoding of a flat 1,000 metre DEM, with padded edges.
            UIColor(red: 1 / 255, green: 173 / 255, blue: 176 / 255, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("map-tools-dem.png")
        try image.pngData()?.write(to: file)
        dem = MapTerrainConfiguration(url: nil, tiles: [file.absoluteString])
    }
}

private struct MapToolsFixtureView: View {
    let store: ActivityStore
    let picker: RoutePicker
    let style: MapToolsStyleFixture
    var body: some View {
        MapScreen(store: store, topOcclusion: 80, picker: picker)
            .environment(\.mapStyleOverride, MapStyle(json: style.json))
            .environment(\.mapTerrainOverride, style.dem)
    }
}

@MainActor
private func mapToolsWait(sourceLocation: SourceLocation = #_sourceLocation, _ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(10)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
    try #require(condition(), "Map tools did not settle", sourceLocation: sourceLocation)
}

@MainActor
private func mapToolsDescendants<T: UIView>(_ view: UIView, of type: T.Type) -> [T] {
    (view as? T).map { [$0] } ?? view.subviews.flatMap { mapToolsDescendants($0, of: type) }
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

nonisolated private enum LiveMapToolsEnvironment {
    static var enabled: Bool { ProcessInfo.processInfo.environment["ACTIVITYMAP_LIVE_MAP_TOOLS"] == "1" }
}

/// Opt-in network evidence using the configured public Mapbox token. Physical
/// device permission, touch and terrain acceptance remain a separate check.
@MainActor @Suite(.serialized, .enabled(if: LiveMapToolsEnvironment.enabled))
struct LiveMapTerrainTests {
    @Test func catalogueLoadsRealElevationWithoutCameraJumps() async throws {
        let token = Bundle.main.object(forInfoDictionaryKey: "MBXAccessToken") as? String
        try #require(token?.hasPrefix("pk.") == true, "Configure a public Mapbox token in Local.xcconfig")
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = token!
        defer { MapboxOptions.accessToken = oldToken }
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        let host = UIHostingController(rootView: MapScreen(store: store, topOcclusion: 80))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        try await mapToolsWait { mapToolsDescendants(host.view, of: MapView.self).first?.mapboxMap.isStyleLoaded == true }
        let map = try #require(mapToolsDescendants(host.view, of: MapView.self).first)
        store.mapContext.request(.resetView)
        try await mapToolsWait { store.mapContext.pendingRequest == nil }
        try await Task.sleep(for: .milliseconds(650))
        let center = CLLocationCoordinate2D(latitude: 46.57, longitude: 8.4)
        map.mapboxMap.setCamera(to: CameraOptions(center: center, zoom: 12, bearing: 25, pitch: 50))
        try await mapToolsWait { store.mapContext.isPitched }
        // Synchronize the declarative viewport after moving the renderer directly.
        store.mapContext.request(.pitch(50))
        try await mapToolsWait { store.mapContext.pendingRequest == nil }
        try await Task.sleep(for: .milliseconds(650))
        var previousSource = ""
        for style in BaseStyle.all {
            store.mapContext.baseStyle = style
            do {
                try await mapToolsWait {
                    let source: StylePropertyValue = map.mapboxMap.terrainProperty("source")
                    guard let id = source.value as? String, id != previousSource else { return false }
                    return id.hasPrefix("activitymap-dem-") && (map.mapboxMap.elevation(at: center) ?? 0) > 500
                        && abs(map.mapboxMap.cameraState.pitch - 50) < 0.1
                }
                let source: StylePropertyValue = map.mapboxMap.terrainProperty("source")
                previousSource = source.value as? String ?? ""
                // Source delivery precedes drawing. Capture a settled frame.
                try await Task.sleep(for: .milliseconds(650))
                let camera = map.mapboxMap.cameraState
                #expect(abs(camera.center.latitude - center.latitude) < 0.001, "Center retained for \(style.id)")
                #expect(abs(camera.center.longitude - center.longitude) < 0.001, "Center retained for \(style.id)")
                #expect(abs(camera.zoom - 12) < 0.01 && abs(camera.bearing - 25) < 0.1, "Camera retained for \(style.id)")
                #expect(map.mapboxMap.sourceExists(withId: RouteSource.id))
                try mapToolsSnapshot(window, name: "live-terrain-\(style.id)")
                print("Terrain loaded: \(style.id)")
            } catch {
                Issue.record("Terrain did not load for \(style.id)")
            }
        }
    }
}

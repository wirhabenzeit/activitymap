import CoreLocation
import Foundation
import MapboxMaps
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

// Share the serialized renderer suite: these tests intentionally manipulate
// a native window and the SDK token, and must not run over another map test.
extension RenderedRoutePickingTests {
    @Test(arguments: [false, true])
    func fitsRoutesWithinSafeAreaAndSheet(tablet: Bool) async throws {
        let size = tablet ? CGSize(width: 768, height: 1024) : CGSize(width: 390, height: 844)
        let harness = try await CameraHarness(size: size)
        defer { harness.close() }
        let routes = [
            [CLLocationCoordinate2D(latitude: 46.1, longitude: 8.1), CLLocationCoordinate2D(latitude: 46.5, longitude: 8.5)],
            [CLLocationCoordinate2D(latitude: -17, longitude: 179.8), CLLocationCoordinate2D(latitude: -16.8, longitude: -179.7)],
            [CLLocationCoordinate2D(latitude: 46, longitude: 8)],
        ]
        for coordinates in routes {
            let extent = try #require(RouteExtent(coordinates: coordinates))
            for sheet: CGFloat in [0, 340, tablet ? 478 : 388] {
                for pitch: CGFloat in [0, 40] {
                    var current = MapCamera.initial
                    current.pitch = pitch
                    current.bearing = pitch == 0 ? 0 : 25
                    let padding = RouteCameraFitter.padding(safeArea: UIEdgeInsets(top: 62, left: 0, bottom: 34, right: 0), sheetHeight: sheet)
                    let options = try RouteCameraFitter.camera(extent: extent, map: harness.map.mapboxMap,
                                                               padding: padding, size: size, current: current)
                    harness.map.mapboxMap.setCamera(to: options)
                    let rect = CGRect(origin: .zero, size: size).inset(by: padding).insetBy(dx: -2, dy: -2)
                    let points = harness.map.mapboxMap.points(for: coordinates)
                    #expect(points.allSatisfy { rect.contains($0) }, "Route must fit: coordinates=\(coordinates), sheet=\(sheet), pitch=\(pitch), points=\(points), rect=\(rect), camera=\(options)")
                    #expect((options.zoom ?? 99) <= 16)
                    if extent.east > 180 {
                        // Translation across ±180° must frame exactly like the same
                        // narrow geographic envelope around the prime meridian.
                        let translated = try #require(RouteExtent(coordinates: coordinates.map {
                            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude > 0 ? $0.longitude - 180 : $0.longitude + 180)
                        }))
                        let reference = try RouteCameraFitter.camera(extent: translated, map: harness.map.mapboxMap,
                                                                    padding: padding, size: size, current: current)
                        #expect(abs((options.zoom ?? 0) - (reference.zoom ?? 99)) < 0.01)
                    }
                }
            }
        }
    }

    @Test func explicitCameraCommandsAndDeferredOneShotFit() async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 844))
        defer { harness.close() }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        let map = try #require(harness.map.mapboxMap)
        let moved = CameraOptions(center: CLLocationCoordinate2D(latitude: 47.5, longitude: 9.5), zoom: 11, bearing: 35, pitch: 20)
        map.setCamera(to: moved)
        store.mapContext.record(map.cameraState)
        let recorded = store.mapContext.camera
        func resolve(_ sheet: CGFloat = 0) -> CameraOptions? {
            MapNavigation.resolve(store: store, map: map, size: harness.map.bounds.size,
                                  safeArea: UIEdgeInsets(top: 62, left: 0, bottom: 34, right: 0), sheetHeight: sheet)
        }
        store.mapContext.request(.pitch(50))
        let pitched = try #require(resolve())
        #expect(pitched.center?.latitude == recorded.center.latitude && pitched.zoom == recorded.zoom)
        #expect(pitched.bearing == recorded.bearing && pitched.pitch == 50)
        store.mapContext.request(.resetBearing)
        let north = try #require(resolve())
        #expect(north.zoom == recorded.zoom && north.pitch == recorded.pitch && north.bearing == 0)
        store.showOnMap(1)
        #expect(resolve(790) == nil && store.mapContext.pendingRequest != nil)
        #expect(resolve(500) == nil && store.mapContext.pendingRequest != nil)
        #expect(resolve(330) != nil && store.mapContext.pendingRequest == nil)
        #expect(resolve(0) == nil, "Dismissing/resizing sheet must not refit a consumed request")
        store.mapContext.request(.resetView)
        let reset = try #require(resolve())
        #expect(reset.center?.latitude == MapCamera.initial.center.latitude && reset.zoom == 6.5 && reset.pitch == 0)
    }

    @Test func queuedNavigationWaitsForStyleAndRejectsDeletedOrHiddenTargets() async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 844), loadImmediately: false)
        defer { harness.close() }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        func resolve() -> CameraOptions? {
            MapNavigation.resolve(store: store, map: harness.map.mapboxMap, size: harness.map.bounds.size,
                                  safeArea: .zero, sheetHeight: 0)
        }
        store.showOnMap(1)
        #expect(resolve() == nil && store.mapContext.pendingRequest != nil)
        try await harness.loadStyle()
        store.activeSportTypes = []
        #expect(resolve() == nil && store.mapContext.hiddenTargetID == 1)
        store.resetFilters()
        store.showOnMap(1)
        store.activities = []
        #expect(resolve() == nil && store.mapContext.pendingRequest == nil)
    }

    @Test func nativeTabRoundTripRestoresCameraAndListOffset() async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        let store = ActivityStore(activities: (1...200).map { ActivityStoreSelectionTests.activity($0) })
        store.selectedTab = .list
        let host = UIHostingController(rootView: NavigationStack { BrowseContent(store: store) })
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        try await cameraWait { descendants(host.view, of: UIScrollView.self).contains { $0.contentSize.height > $0.bounds.height * 2 } }
        let list = try #require(descendants(host.view, of: UIScrollView.self).first { $0.contentSize.height > $0.bounds.height * 2 })
        list.setContentOffset(CGPoint(x: 0, y: 1200), animated: false)
        let offset = list.contentOffset.y
        store.selectedTab = .map
        try await cameraWait { !descendants(host.view, of: MapView.self).isEmpty }
        let firstMap = try #require(descendants(host.view, of: MapView.self).first)
        firstMap.mapboxMap.loadStyle(CameraHarness.style)
        try await cameraWait { firstMap.mapboxMap.isStyleLoaded }
        try await Task.sleep(for: .milliseconds(150))
        firstMap.mapboxMap.setCamera(to: CameraOptions(center: CLLocationCoordinate2D(latitude: 47.1, longitude: 8.7),
                                                      zoom: 10, bearing: 25, pitch: 40))
        try await cameraWait { abs(store.mapContext.camera.zoom - 10) < 0.01 }
        store.selectedTab = .list
        try await cameraWait { descendants(host.view, of: MapView.self).isEmpty }
        #expect(abs(list.contentOffset.y - offset) < 1)
        #expect(descendants(host.view, of: UIScrollView.self).contains { $0 === list })
        store.selectedTab = .map
        try await cameraWait { !descendants(host.view, of: MapView.self).isEmpty }
        let secondMap = try #require(descendants(host.view, of: MapView.self).first)
        #expect(firstMap !== secondMap, "Retention must work even though the renderer is recreated")
        secondMap.mapboxMap.loadStyle(CameraHarness.style)
        try await cameraWait { secondMap.mapboxMap.isStyleLoaded }
        try await Task.sleep(for: .milliseconds(150))
        let restored = secondMap.mapboxMap.cameraState
        #expect(abs(restored.center.latitude - 47.1) < 0.001 && abs(restored.center.longitude - 8.7) < 0.001)
        #expect(abs(restored.zoom - 10) < 0.01 && abs(restored.bearing - 25) < 0.01 && abs(restored.pitch - 40) < 0.01)
        // Exercise the actual SwiftUI intent/viewport adapter, not only the fitter.
        store.showOnMap(150)
        try await cameraWait { store.mapContext.pendingRequest == nil }
        try await Task.sleep(for: .milliseconds(650))
        #expect(abs(secondMap.mapboxMap.cameraState.center.latitude - 46.005) < 0.03)
        let framed = secondMap.mapboxMap.points(for: try #require(store.activities.first { $0.id == 150 }).coordinates)
        #expect(framed.allSatisfy { $0.y >= secondMap.safeAreaInsets.top + 16 && $0.y <= secondMap.bounds.height - secondMap.safeAreaInsets.bottom - 80 })
        store.selectedTab = .list
        try await cameraWait { descendants(host.view, of: MapView.self).isEmpty }
        #expect(abs(list.contentOffset.y - offset) < 1)
    }
}

@MainActor
private final class CameraHarness {
    static let style = ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##
    let window: UIWindow
    let map: MapView
    let oldWindow: UIWindow?
    let oldToken: String
    init(size: CGSize, loadImmediately: Bool = true) async throws {
        oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        oldWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        window.rootViewController = controller
        window.makeKeyAndVisible()
        map = MapView(frame: CGRect(origin: .zero, size: size), mapInitOptions: MapInitOptions(styleURI: nil, styleJSON: loadImmediately ? Self.style : nil))
        controller.view.addSubview(map)
        if loadImmediately { try await cameraWait { self.map.mapboxMap.isStyleLoaded } }
    }
    func loadStyle() async throws {
        map.mapboxMap.loadStyle(Self.style)
        try await cameraWait { self.map.mapboxMap.isStyleLoaded }
    }
    func close() {
        window.isHidden = true
        oldWindow?.makeKeyAndVisible()
        MapboxOptions.accessToken = oldToken
    }
}

@MainActor
private func cameraWait(_ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(10)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
    try #require(condition(), "Native map/list state timed out")
}

@MainActor
private func descendants<T: UIView>(_ view: UIView, of type: T.Type) -> [T] {
    (view as? T).map { [$0] } ?? view.subviews.flatMap { descendants($0, of: type) }
}

import CoreLocation
import Foundation
import MapLibre
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
            for sheet: CGFloat in [0, 340, tablet ? 478 : 500] {
                for pitch: CGFloat in [0, 40] {
                    var current = MapCamera.initial
                    current.pitch = pitch
                    current.bearing = pitch == 0 ? 0 : 25
                    let padding = RouteCameraFitter.padding(safeArea: UIEdgeInsets(top: 62, left: 0, bottom: 34, right: 0), sheetHeight: sheet, trailingOcclusion: tablet && sheet == 0 ? 330 : 0)
                    let options = try RouteCameraFitter.camera(extent: extent, map: harness.map.renderer,
                                                               padding: padding, size: size, current: current)
                    harness.map.renderer.setCamera(to: options)
                    let rect = CGRect(origin: .zero, size: size).inset(by: padding).insetBy(dx: -2, dy: -2)
                    let points = harness.map.renderer.points(for: coordinates)
                    #expect(points.allSatisfy { rect.contains($0) }, "Route must fit: coordinates=\(coordinates), sheet=\(sheet), pitch=\(pitch), points=\(points), rect=\(rect), camera=\(options)")
                    #expect(options.zoom <= 16)
                    if extent.east > 180 {
                        // Translation across ±180° must frame exactly like the same
                        // narrow geographic envelope around the prime meridian.
                        let translated = try #require(RouteExtent(coordinates: coordinates.map {
                            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude > 0 ? $0.longitude - 180 : $0.longitude + 180)
                        }))
                        let reference = try RouteCameraFitter.camera(extent: translated, map: harness.map.renderer,
                                                                    padding: padding, size: size, current: current)
                        #expect(abs(options.zoom - reference.zoom) < 0.01)
                    }
                }
            }
        }
    }

    @Test func compactFitUsesCurrentFootprintAndResizingDoesNotRefit() async throws {
        let size = CGSize(width: 402, height: 874)
        let harness = try await CameraHarness(size: size)
        defer { harness.close() }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        store.replaceSelection(with: [1])
        let medium = MapResultsLayout(size: size, topInset: 116, bottomInset: 34, detent: .medium)
        let compact = MapResultsLayout(size: size, topInset: 116, bottomInset: 34, detent: .compact)
        store.mapContext.request(.fitSelection)
        let options = try #require(MapNavigation.resolve(store: store, map: harness.map.renderer,
            size: size, safeArea: UIEdgeInsets(top: 62, left: 0, bottom: 34, right: 0),
            sheetHeight: compact.bottomOcclusion, topOcclusion: 116))
        harness.map.renderer.setCamera(to: options)
        let padding = RouteCameraFitter.padding(safeArea: UIEdgeInsets(top: 62, left: 0, bottom: 34, right: 0),
                                               sheetHeight: compact.bottomOcclusion, topOcclusion: 116)
        let visible = CGRect(origin: .zero, size: size).inset(by: padding).insetBy(dx: -2, dy: -2)
        #expect(harness.map.renderer.points(for: store.activities[0].coordinates).allSatisfy { visible.contains($0) })
        #expect(MapNavigation.resolve(store: store, map: harness.map.renderer, size: size,
            safeArea: .zero, sheetHeight: medium.bottomOcclusion) == nil,
            "Revealing detail must not create another fit after the explicit command is consumed")
    }

    @Test func explicitCameraCommandsAndDeferredOneShotFit() async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 844))
        defer { harness.close() }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        let map = try #require(harness.map.renderer)
        let moved = MapCamera(center: CLLocationCoordinate2D(latitude: 47.5, longitude: 9.5), zoom: 11, bearing: 35, pitch: 20)
        map.setCamera(to: moved)
        store.mapContext.record(map.cameraState)
        let recorded = store.mapContext.camera
        func resolve(_ sheet: CGFloat = 0) -> MapCamera? {
            MapNavigation.resolve(store: store, map: map, size: harness.map.bounds.size,
                                  safeArea: UIEdgeInsets(top: 62, left: 0, bottom: 34, right: 0), sheetHeight: sheet)
        }
        store.mapContext.request(.pitch(50))
        let pitched = try #require(resolve())
        #expect(pitched.center.latitude == recorded.center.latitude && pitched.zoom == recorded.zoom)
        #expect(pitched.bearing == recorded.bearing && pitched.pitch == 50)
        store.mapContext.request(.resetBearing)
        let north = try #require(resolve())
        #expect(north.zoom == recorded.zoom && north.pitch == recorded.pitch && north.bearing == 0)
        store.replaceSelection(with: [1])
        let selection = store.selectedActivityIDs
        let filters = store.activeSportTypes
        store.mapContext.request(.locate(latitude: 46.8, longitude: 8.2))
        let located = try #require(resolve())
        #expect(located.center.latitude == 46.8 && located.center.longitude == 8.2)
        #expect(located.zoom == 15 && located.pitch == recorded.pitch && located.bearing == recorded.bearing)
        #expect(located.padding == recorded.padding)
        #expect(store.mapContext.locatedPosition?.latitude == 46.8 && store.mapContext.locatedPosition?.longitude == 8.2)
        #expect(store.selectedActivityIDs == selection && store.activeSportTypes == filters)
        #expect(resolve() == nil, "Locate me is consumed once")
        for zoom: CGFloat in [2, 15, 18] {
            map.setCamera(to: MapCamera(center: recorded.center, padding: recorded.padding,
                                           zoom: zoom, bearing: recorded.bearing, pitch: recorded.pitch))
            store.mapContext.record(map.cameraState)
            store.mapContext.request(.locate(latitude: 46.8, longitude: 8.2))
            let nearby = try #require(resolve())
            #expect(nearby.zoom == (zoom < 15 ? 15 : zoom), "Locate me shows nearby streets and preserves closer views")
            #expect(nearby.padding == recorded.padding && nearby.pitch == recorded.pitch && nearby.bearing == recorded.bearing)
            #expect(store.selectedActivityIDs == selection && store.activeSportTypes == filters)
        }
        map.setCamera(to: moved)
        store.mapContext.record(map.cameraState)
        store.mapContext.request(.locate(latitude: .nan, longitude: 8))
        #expect(resolve() == nil && store.mapContext.navigationError != nil)
        store.mapContext.request(.locate(latitude: 46, longitude: 8))
        store.mapContext.cancelLocationRequest()
        #expect(resolve() == nil)
        store.showOnMap(1)
        #expect(resolve(790) == nil && store.mapContext.pendingRequest != nil)
        #expect(resolve(500) != nil && store.mapContext.pendingRequest == nil,
                "A usable viewport above the map center must still accept an explicit fit")
        #expect(resolve(0) == nil, "Dismissing/resizing sheet must not refit a consumed request")
        let selected = store.selectedActivityIDs, active = store.activeActivityID
        store.mapContext.request(.fitActivity(1))
        #expect(resolve(340) != nil && store.mapContext.pendingRequest == nil)
        #expect(store.selectedActivityIDs == selected && store.activeActivityID == active)
        store.mapContext.request(.fitSelection)
        #expect(resolve(790) == nil && store.mapContext.pendingRequest == nil)
        #expect(store.mapContext.navigationError != nil, "An occluded Fit ends with shrink guidance rather than changing the panel or waiting indefinitely")
        store.mapContext.request(.resetView)
        let reset = try #require(resolve())
        #expect(reset.center.latitude == MapCamera.initial.center.latitude && reset.zoom == 6.5 && reset.pitch == 0)
    }

    @Test func queuedNavigationWaitsForStyleAndRejectsDeletedOrHiddenTargets() async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 844), loadImmediately: false)
        defer { harness.close() }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        func resolve() -> MapCamera? {
            MapNavigation.resolve(store: store, map: harness.map.renderer, size: harness.map.bounds.size,
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

    @Test func tabReturnKeepsLoadedRouteRenderer() async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        let store = ActivityStore(activities: (1...200).map { ActivityStoreSelectionTests.activity($0) })
        let host = UIHostingController(rootView: NavigationStack { BrowseContent(store: store) }
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        try await cameraWait { !descendants(host.view, of: MLNMapView.self).isEmpty }
        let firstMap = try #require(descendants(host.view, of: MLNMapView.self).first)
        try await cameraWait { firstMap.renderer.isStyleLoaded && firstMap.renderer.layerExists(withId: RouteSource.ordinaryLayerID) }
        // Query only after the tiles for the new camera have actually rendered;
        // a fixed 150 ms delay is not enough on a shared CI simulator.
        firstMap.renderer.setCamera(to: MapCamera(center: CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005), zoom: 13))
        try await cameraWait { !firstMap.visibleFeatures(in: firstMap.bounds, styleLayerIdentifiers: [RouteSource.ordinaryLayerID]).isEmpty }
        let picker = RoutePicker()
        let point = firstMap.renderer.point(for: CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005))
        picker.pick(at: point, map: firstMap.renderer, store: store)
        try await cameraWait { picker.isPresented || picker.errorMessage != nil }
        try #require(picker.candidateIDs.count == 200)
        store.selectedTab = .list
        try await Task.sleep(for: .milliseconds(100))
        store.selectedTab = .map
        try await cameraWait { !descendants(host.view, of: MLNMapView.self).isEmpty }
        let returnedMap = try #require(descendants(host.view, of: MLNMapView.self).first)
        #expect(returnedMap === firstMap, "A tab switch must not recreate the route renderer")
        try #require(returnedMap.renderer.layerExists(withId: RouteSource.ordinaryLayerID), "Routes must already be loaded on return, without waiting for style/source reload")
        picker.isPresented = false
        picker.pick(at: point, map: returnedMap.renderer, store: store)
        try await cameraWait { picker.isPresented || picker.errorMessage != nil }
        #expect(picker.errorMessage == nil && picker.candidateIDs.count == 200)
        #expect(store.routeGeometry.buildCount == 1)
        store.clearScope()
        try await cameraWait {
            descendants(host.view, of: MLNMapView.self).first.map { $0 !== returnedMap } ?? false
        }
    }

    @Test(arguments: [false, true])
    func nativeTabRoundTripRestoresCameraAndListOffset(landscape: Bool) async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscape ? .landscapeRight : .portrait))
        try await cameraWait { scene.effectiveGeometry.interfaceOrientation == (landscape ? .landscapeRight : .portrait) }
        defer { scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) }
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        let store = ActivityStore(activities: (1...200).map { ActivityStoreSelectionTests.activity($0) })
        store.selectedTab = .list
        let dashboard = StatsDashboardState()
        let stats = BrowseStatsDestination { store, sync in
            AnyView(StatsScreen(store: store, sync: sync, dashboard: dashboard))
        }
        let host = UIHostingController(rootView: AppShell(store: store, statsContent: stats)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        try await cameraWait { descendants(host.view, of: UICollectionView.self).contains { $0.contentSize.height > $0.bounds.height * 2 } }
        let list = try #require(descendants(host.view, of: UICollectionView.self).first { $0.contentSize.height > $0.bounds.height * 2 })
        list.setContentOffset(CGPoint(x: 0, y: 1200), animated: false)
        let offset = list.contentOffset.y
        store.selectedTab = .map
        try await cameraWait { !descendants(host.view, of: MLNMapView.self).isEmpty }
        let firstMap = try #require(descendants(host.view, of: MLNMapView.self).first)
        try await cameraWait { firstMap.renderer.isStyleLoaded }
        // Style readiness alone precedes SwiftUI's camera initialization. Wait
        // for a real command to be consumed and its viewport transition to finish
        // before simulating a user camera change on a cold simulator.
        store.mapContext.request(.resetView)
        try await cameraWait { store.mapContext.pendingRequest == nil }
        try await Task.sleep(for: .milliseconds(650))
        // A real gesture leaves the configured viewport state before moving
        // the camera. Raw setCamera alone lets that old state move it back.
        firstMap.renderer.setCamera(to: MapCamera(center: CLLocationCoordinate2D(latitude: 47.1, longitude: 8.7),
                                                      padding: UIEdgeInsets(top: 132, left: 24, bottom: 400, right: 80),
                                                      zoom: 10, bearing: 25, pitch: 40))
        try await cameraWait {
            let camera = store.mapContext.camera
            return abs(camera.center.latitude - 47.1) < 0.001 && abs(camera.center.longitude - 8.7) < 0.001
                && abs(camera.zoom - 10) < 0.01 && abs(camera.bearing - 25) < 0.01 && abs(camera.pitch - 40) < 0.01
                && camera.padding == UIEdgeInsets(top: 132, left: 24, bottom: 400, right: 80)
        }
        store.selectedTab = .stats
        try await Task.sleep(for: .milliseconds(200))
        try await cameraWait { dashboard.completedTiles.count == StatsDashboard.tiles.count }
        let statsScroll = try #require(descendants(host.view, of: UIScrollView.self).first {
            !($0 is UICollectionView) && $0.contentSize.height > 1500
        })
        // Publishing the last tile precedes the native safe-area/layout commit.
        // As in the Stats navigation tests, establish a settled viewport before
        // simulating a user scroll; otherwise UIKit can still add the 44pt bar.
        try await Task.sleep(for: .milliseconds(300))
        host.view.layoutIfNeeded()
        statsScroll.setContentOffset(CGPoint(x: 0, y: 800), animated: false)
        try await Task.sleep(for: .milliseconds(100))
        #expect(abs(statsScroll.contentOffset.y - 800) < 1)
        store.selectedTab = .list
        try await Task.sleep(for: .milliseconds(100))
        #expect(abs(list.contentOffset.y - offset) < 1)
        #expect(descendants(host.view, of: UIScrollView.self).contains { $0 === list })
        store.selectedTab = .map
        try await cameraWait { !descendants(host.view, of: MLNMapView.self).isEmpty }
        let secondMap = try #require(descendants(host.view, of: MLNMapView.self).first)
        #expect(firstMap === secondMap, "Tab switches must preserve the loaded renderer")
        #expect(secondMap.renderer.isStyleLoaded)
        try await Task.sleep(for: .milliseconds(150))
        let restored = secondMap.renderer.cameraState
        #expect(abs(restored.center.latitude - 47.1) < 0.001 && abs(restored.center.longitude - 8.7) < 0.001)
        #expect(abs(restored.zoom - 10) < 0.01 && abs(restored.bearing - 25) < 0.01 && abs(restored.pitch - 40) < 0.01)
        #expect(restored.padding == UIEdgeInsets(top: 132, left: 24, bottom: 400, right: 80),
                "Tab restoration must preserve camera padding without adding safe areas again")
        store.selectedTab = .stats
        try await Task.sleep(for: .milliseconds(100))
        #expect(descendants(host.view, of: UIScrollView.self).contains { $0 === statsScroll })
        #expect(abs(statsScroll.contentOffset.y - 800) < 1, "Stats retains its mounted scroll context: offset=\(statsScroll.contentOffset), inset=\(statsScroll.adjustedContentInset), size=\(statsScroll.contentSize)")
        // Exercise the actual SwiftUI intent/viewport adapter from the hidden map.
        store.selectedTab = .list
        try await Task.sleep(for: .milliseconds(100))
        store.showOnMap(150)
        try await cameraWait { store.mapContext.pendingRequest == nil }
        let targetCoordinates = try #require(store.activities.first { $0.id == 150 }).coordinates
        let bottomClearance: CGFloat = landscape ? 16 : 80
        // Consuming the intent precedes SwiftUI's viewport update. Wait for the
        // real transition to finish and the route to occupy the required screen
        // rect, rather than assuming a 650 ms sleep covers renderer scheduling.
        try await cameraWait {
            guard
                  abs(secondMap.renderer.cameraState.center.latitude - 46.005) < 0.03 else { return false }
            return secondMap.renderer.points(for: targetCoordinates).allSatisfy {
                $0.y >= secondMap.safeAreaInsets.top + 16
                    && $0.y <= secondMap.bounds.height - secondMap.safeAreaInsets.bottom - bottomClearance
            }
        }
        #expect(abs(secondMap.renderer.cameraState.center.latitude - 46.005) < 0.03)
        let framed = secondMap.renderer.points(for: targetCoordinates)
        #expect(framed.allSatisfy { $0.y >= secondMap.safeAreaInsets.top + 16 && $0.y <= secondMap.bounds.height - secondMap.safeAreaInsets.bottom - bottomClearance })
        store.selectedTab = .list
        try await Task.sleep(for: .milliseconds(100))
        #expect(abs(list.contentOffset.y - offset) < 1)
        // Restore the owning scene's original window before resetting geometry.
        // A retained landscape host can otherwise reject the teardown request.
        window.isHidden = true
        oldWindow?.makeKeyAndVisible()
        oldWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { error in
            print("Round-trip portrait restoration: \(error)")
        }
        try await cameraWait { scene.effectiveGeometry.interfaceOrientation == .portrait }
    }

    @Test(arguments: [false, true])
    func fixedPanelFitsBesideRoutesInTheWideShell(single: Bool) async throws {
        // The expanded filter panel leaves the narrowest map the results must fit beside.
        let sheets = BrowseSheetPresentation()
        sheets.showsFilters = true
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 1180, height: 820)
        let store = ActivityStore(activities: try GalleryLibrary.load().activities)
        let picker = RoutePicker()
        let host = UIHostingController(rootView: AppShell(store: store, mapPicker: picker, sheets: sheets)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        try await cameraWait { descendants(host.view, of: MLNMapView.self).first?.renderer.isStyleLoaded == true }
        let map = try #require(descendants(host.view, of: MLNMapView.self).first)
        #expect(map.bounds.width >= 650)
        #expect(map.convert(map.bounds, to: nil).minX >= 320, "Results stay within the map, beside the expanded filters")
        store.replaceSelection(with: single ? [20279947341] : [20279947341, 20270725942, 20244330171])
        picker.reviewSelection(store: store)
        picker.detent = .expanded
        store.mapContext.request(.fitSelection)
        try await cameraWait {

            return store.mapContext.pendingRequest == nil && map.renderer.cameraState.padding.right > 300
        }
        let camera = map.renderer.cameraState
        #expect(camera.padding.right > 300, "Framing reserves the actual edge panel")
        #expect(host.presentedViewController == nil, "Wide results remain at the map edge")
        let directory = URL(fileURLWithPath: "/tmp/activitymap-navigation-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for detent in [MapResultsDetent.expanded, .compact, .expanded] {
            picker.detent = detent
            try await Task.sleep(for: .milliseconds(350))
            #expect(store.mapContext.pendingRequest == nil)
            #expect(abs(map.renderer.cameraState.zoom - camera.zoom) < 0.001)
            #expect(map.renderer.cameraState.padding == camera.padding)
            let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
                host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
            }
            try image.pngData()?.write(to: directory.appendingPathComponent("wide-shell-\(single ? "single-" : "")\(detent == .compact ? "collapsed" : "expanded").png"))
        }
    }
}

@MainActor
final class CameraHarness {
    static let style = ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##
    let window: UIWindow
    let map: MLNMapView
    let renderer: MapController
    let delegate = NativeMapTestDelegate()
    let oldWindow: UIWindow?
    init(size: CGSize, loadImmediately: Bool = true, styleJSON: String? = nil) async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        oldWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        window.rootViewController = controller
        window.makeKeyAndVisible()
        map = MLNMapView(frame: CGRect(origin: .zero, size: size), styleURL: nil)
        renderer = MapController(view: map)
        delegate.renderer = renderer
        map.delegate = delegate
        if loadImmediately { map.styleJSON = styleJSON ?? Self.style }

        controller.view.addSubview(map)
        if loadImmediately { try await cameraWait { self.map.renderer.isStyleLoaded } }
    }
    func loadStyle() async throws {
        renderer.isStyleLoaded = false
        map.styleJSON = Self.style
        try await cameraWait { self.map.renderer.isStyleLoaded }
    }
    func close() {
        window.isHidden = true
        oldWindow?.makeKeyAndVisible()
    }
}

@MainActor
private func cameraWait(sourceLocation: SourceLocation = #_sourceLocation, _ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(10)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
    try #require(condition(), "Native map/list state timed out", sourceLocation: sourceLocation)
}

@MainActor
private func descendants<T: UIView>(_ view: UIView, of type: T.Type) -> [T] {
    (view as? T).map { [$0] } ?? view.subviews.flatMap { descendants($0, of: type) }
}

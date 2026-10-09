import MapboxMaps
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

/// Review captures of production screens, not pixel-golden assertions. Opt-in:
/// `scripts/ios-gallery.sh` sets `ACTIVITYMAP_GALLERY=1` and an output directory,
/// then builds a browsable index. Every scene renders in each variant.
@MainActor @Suite(.serialized, .enabled(if: GalleryEnvironment.isEnabled))
struct ScreenshotGalleryTests {
    @Test(arguments: GalleryScene.allCases)
    func capture(scene: GalleryScene) async throws {
        let manifest = try GalleryManifest.load()
        guard GalleryEnvironment.includes(scene.rawValue, key: "SCENES") else { return }
        let scenario = try #require(manifest.scenarios.first { $0.id == scene.rawValue })
        let library = try GalleryLibrary.load()
        let available = Set(library.activities.map(\.id))
        try #require(Set(scenario.selectedIDs + [scenario.detailID].compactMap { $0 }).isSubset(of: available), "Scenario IDs missing from gallery library")
        do {
            for spec in manifest.variants where GalleryEnvironment.includes(spec.name, key: "VARIANTS") {
                let variant = spec.variant
                // Like a person turning the phone: build in portrait, then rotate.
                try await GalleryWindow.orient(landscape: false)
                let staged = try scene.stage(library.activities, scenario: scenario)
                let window = try GalleryWindow(root: staged.root, variant: variant)
                defer { window.close() }
                if variant.landscape {
                    // Rotating before the first layout leaves stale safe-area
                    // backgrounds, which never happens on a device.
                    try await Task.sleep(for: .milliseconds(800))
                    try await GalleryWindow.orient(landscape: true)
                }
                try await window.settle(staged)
                try window.save(scene: scene, variant: variant, library: library.source, scenario: scenario)
            }
        } catch {
            // Never leave the shared simulator rotated for later scenes or runs.
            try? await GalleryWindow.orient(landscape: false)
            throw error
        }
        try await GalleryWindow.orient(landscape: false)
    }
}

nonisolated enum GalleryEnvironment {
    static let values = ProcessInfo.processInfo.environment
    static var isEnabled: Bool { values["ACTIVITYMAP_GALLERY"] == "1" }
    static func includes(_ value: String, key: String) -> Bool {
        guard let filter = values["ACTIVITYMAP_GALLERY_" + key], !filter.isEmpty else { return true }
        return filter.split(separator: ",").contains(Substring(value))
    }
    static var output: URL {
        URL(fileURLWithPath: values["ACTIVITYMAP_GALLERY_OUTPUT"] ?? "/tmp/activitymap-gallery/latest")
    }
    /// A public token renders the real basemap; otherwise an offline plain style.
    static var mapboxToken: String? { values["ACTIVITYMAP_GALLERY_MAPBOX_TOKEN"].flatMap { $0.isEmpty ? nil : $0 } }
}

struct GalleryVariant {
    let name: String
    let size: CGSize
    let dark: Bool
    let contentSize: UIContentSizeCategory
    let regular: Bool
    /// Rotates the simulator scene, so safe areas and size classes are real.
    var landscape = false

    var dynamicTypeSize: DynamicTypeSize { DynamicTypeSize(contentSize) ?? .large }
}

enum GalleryScene: String, CaseIterable, CustomTestStringConvertible {
    case map, mapResults = "map-results", mapDetail = "map-detail", list, listDetail = "list-detail"
    case filters, stats, statsExpanded = "stats-expanded", settings

    var testDescription: String { rawValue }

    struct Staged {
        let root: AnyView
        var usesMap = false
        var reveal: @MainActor () -> Void = {}
        var prepare: @MainActor () -> Void = {}
        var ready: @MainActor () -> Bool = { true }
        var coordinates: [CLLocationCoordinate2D] = []
        var navigationError: @MainActor () -> String? = { nil }
    }

    @MainActor func stage(_ activities: [Activity], scenario: GalleryManifest.Scenario) throws -> Staged {
        let store = ActivityStore(activities: activities, listPresentation: ActivityListPresentation(defaults: nil))
        // Optional native list variants share the normal activity fixture.
        if GalleryEnvironment.values["ACTIVITYMAP_GALLERY_LIST_VIEW"] == "details" {
            store.listPresentation.settings.width = .details
        }
        if let metrics = GalleryEnvironment.values["ACTIVITYMAP_GALLERY_LIST_METRICS"] {
            store.listPresentation.settings.visibleMetrics = Set(metrics.split(separator: ",")
                .compactMap { ActivityListMetric(rawValue: String($0)) })
        }
        let picker = RoutePicker()
        func shell(_ tab: AppTab) -> AnyView {
            store.selectedTab = tab
            return AnyView(AppShell(store: store, mapPicker: picker).galleryMapStyle())
        }
        switch self {
        case .map:
            return Staged(root: shell(.map), usesMap: true)
        case .mapResults:
            let ids = scenario.selectedIDs
            return Staged(root: shell(.map), usesMap: true, reveal: { picker.detent = .medium }, prepare: {
                store.replaceSelection(with: ids)
                picker.reviewSelection(store: store)
                store.mapContext.request(.fitSelection)
            }, ready: { store.mapContext.pendingRequest == nil },
                coordinates: activities.filter { ids.contains($0.id) }.flatMap(\.coordinates),
                navigationError: { store.mapContext.navigationError })
        case .mapDetail:
            let id = try #require(scenario.detailID)
            return Staged(root: shell(.list), usesMap: true, reveal: { picker.detent = .medium }, prepare: {
                store.replaceSelection(with: scenario.selectedIDs)
                store.showOnMap(id)
            }, ready: { store.mapContext.pendingRequest == nil },
                coordinates: activities.filter { $0.id == id }.flatMap(\.coordinates),
                navigationError: { store.mapContext.navigationError })
        case .list:
            store.replaceSelection(with: scenario.selectedIDs)
            if GalleryEnvironment.values["ACTIVITYMAP_GALLERY_LIST_OPTIONS"] == "1" {
                store.listPresentation.displayOpen = true
                return Staged(root: AnyView(NavigationStack { ListScreen(store: store) }))
            }
            return Staged(root: shell(.list))
        case .listDetail:
            let id = try #require(scenario.detailID)
            let root = shell(.list)
            return Staged(root: root, prepare: { store.inspect(id) })
        case .filters:
            store.searchText = scenario.search ?? ""
            store.selectedTab = .list
            let sheets = BrowseSheetPresentation()
            return Staged(root: AnyView(AppShell(store: store, sheets: sheets).galleryMapStyle()),
                          prepare: { sheets.showsFilters = true })
        case .stats, .statsExpanded:
            let dashboard = StatsDashboardState()
            store.selectedTab = .stats
            let root = AppShell(store: store, mapPicker: picker, statsContent: .init { store, _ in
                AnyView(StatsScreen(store: store, dashboard: dashboard))
            })
            guard self == .statsExpanded else { return Staged(root: AnyView(root.galleryMapStyle())) }
            // Review other expandable tiles with ACTIVITYMAP_GALLERY_STATS_TILE.
            let tile = GalleryEnvironment.values["ACTIVITYMAP_GALLERY_STATS_TILE"].flatMap(StatsTileID.init(rawValue:)) ?? .weeklyVolume
            return Staged(root: AnyView(root.galleryMapStyle()), prepare: { dashboard.toggleExpansion(tile) })
        case .settings:
            return Staged(root: AnyView(AccountSheet(destination: .settings, auth: AuthController())))
        }
    }

}

private extension View {
    @ViewBuilder func galleryMapStyle() -> some View {
        if GalleryEnvironment.mapboxToken == nil {
            environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))
        } else {
            self
        }
    }
}

@MainActor
private final class GalleryWindow {
    let window: UIWindow
    let oldWindow: UIWindow?
    let host: UIHostingController<AnyView>
    let previousToken: String
    private var framing: [String: Any] = [:]
    private var readinessDetail = ""

    init(root: AnyView, variant: GalleryVariant) throws {
        previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = GalleryEnvironment.mapboxToken ?? "pk.offline-test"
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        oldWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        // Landscape windows start portrait; UIKit swaps the bounds on rotation.
        window.frame = CGRect(origin: .zero, size: variant.landscape && GalleryEnvironment.values["ACTIVITYMAP_GALLERY_HOSTED_VIEWPORTS"] != "1"
            ? CGSize(width: variant.size.height, height: variant.size.width) : variant.size)
        window.traitOverrides.userInterfaceStyle = variant.dark ? .dark : .light
        window.traitOverrides.preferredContentSizeCategory = variant.contentSize
        window.traitOverrides.horizontalSizeClass = variant.regular ? .regular : .compact
        window.traitOverrides.verticalSizeClass = variant.landscape && !variant.regular ? .compact : .regular
        host = UIHostingController(rootView: AnyView(root
            .environment(\.locale, Locale(identifier: "de_CH"))
            .environment(\.timeZone, TimeZone(identifier: "Europe/Zurich")!)
            .environment(\.colorScheme, variant.dark ? .dark : .light)
            .environment(\.dynamicTypeSize, variant.dynamicTypeSize)
            .environment(\.horizontalSizeClass, variant.regular ? .regular : .compact)
            .environment(\.verticalSizeClass, variant.landscape && !variant.regular ? .compact : .regular)
            .environment(\.statsDetailPresentation, .automatic)))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
    }

    /// Island-on-the-right landscape, as reported in #315; portrait otherwise.
    static func orient(landscape: Bool) async throws {
        if GalleryEnvironment.values["ACTIVITYMAP_GALLERY_HOSTED_VIEWPORTS"] == "1" { return }
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        guard scene.effectiveGeometry.interfaceOrientation.isLandscape != landscape else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscape ? .landscapeLeft : .portrait))
        let end = Date().addingTimeInterval(5)
        while scene.effectiveGeometry.interfaceOrientation.isLandscape != landscape, Date() < end {
            try await Task.sleep(for: .milliseconds(50))
        }
        try #require(scene.effectiveGeometry.interfaceOrientation.isLandscape == landscape, "Simulator did not rotate")
        // The reported orientation changes before the rotation animation ends.
        try await Task.sleep(for: .seconds(1))
    }

    func close() {
        window.isHidden = true
        oldWindow?.makeKeyAndVisible()
        MapboxOptions.accessToken = previousToken
    }

    func settle(_ staged: GalleryScene.Staged) async throws {
        try await Task.sleep(for: .milliseconds(400))
        guard staged.usesMap else {
            staged.prepare()
            try await Task.sleep(for: .milliseconds(900))
            return
        }
        try await wait(seconds: 15) { self.mapView(in: self.host.view)?.mapboxMap.isStyleLoaded == true }
        let map = try #require(mapView(in: host.view))
        var idleCamera: CameraState?
        let token = map.mapboxMap.onMapIdle.observe { _ in idleCamera = map.mapboxMap.cameraState }
        defer { token.cancel() }
        staged.prepare()
        map.mapboxMap.triggerRepaint()
        try await wait(seconds: 15, phase: "navigation request", staged.ready)
        try #require(staged.navigationError() == nil, "Navigation failed: \(staged.navigationError() ?? "")")
        // Request consumption alone does not prove that SwiftUI applied the
        // intended camera. Require the route inside that camera's padded rect.
        try await wait(seconds: 30, phase: "fitted route and map idle") {
            let camera = map.mapboxMap.cameraState
            let points = map.mapboxMap.points(for: staged.coordinates)
            let projected = points.reduce(CGRect.null) { $0.union(CGRect(origin: $1, size: CGSize(width: 0.01, height: 0.01))) }
            // A centre point outside the padded rect means Mapbox kept a stale size.
            self.readinessDetail = "idleCamera=\(String(describing: idleCamera)), projected=\(projected), centerPoint=\(map.mapboxMap.point(for: camera.center))"
            guard case .state = map.viewport.status, idleCamera == camera else { return false }
            guard !staged.coordinates.isEmpty else { return true }
            guard camera.padding != .zero else { return false }
            let visible = self.routeViewport(map)
            return points.allSatisfy { visible.contains($0) }
        }
        let fitted = map.mapboxMap.cameraState
        staged.reveal()
        var lastFrame = "", stableSince = Date()
        try await wait(seconds: 15, phase: "revealed panel stability") {
            self.host.view.layoutIfNeeded()
            let panel = self.host.presentedViewController?.view
            let frame = panel.map { $0.convert($0.bounds, to: map) } ?? .zero
            let signature = "\(frame)|\(map.bounds)|\(map.mapboxMap.cameraState)"
            if signature != lastFrame { lastFrame = signature; stableSince = Date() }
            return Date().timeIntervalSince(stableSince) >= 0.35
        }
        let camera = map.mapboxMap.cameraState
        try #require(abs(camera.zoom - fitted.zoom) < 0.001 && camera.padding == fitted.padding
                     && abs(camera.center.latitude - fitted.center.latitude) < 0.00001
                     && abs(camera.center.longitude - fitted.center.longitude) < 0.00001
                     && camera.bearing == fitted.bearing && camera.pitch == fitted.pitch,
                     "Revealing results unexpectedly changed the fitted camera")
        let points = map.mapboxMap.points(for: staged.coordinates)
        let visible = routeViewport(map)
        try #require(points.allSatisfy { visible.contains($0) }, "Route escaped the fitted viewport after reveal")
        let panel = host.presentedViewController?.view
        let panelFrame = panel.map { $0.convert($0.bounds, to: map) }
        if let panelFrame {
            try #require(points.allSatisfy { !panelFrame.insetBy(dx: -16, dy: -16).contains($0) },
                         "Revealed native sheet covers the fitted route: \(panelFrame)")
        } else if !staged.coordinates.isEmpty {
            // Wide panels live in the map's own hierarchy, rather than a UIKit
            // presentation controller. Use their production frame, in map points.
            let safeArea = map.safeAreaInsets
            let layout = MapResultsLayout(size: CGSize(width: map.bounds.width, height: map.bounds.height - safeArea.bottom),
                topInset: safeArea.top, bottomInset: safeArea.bottom, detent: .medium)
            if layout.isSidePanel {
                try #require(points.allSatisfy { $0.x < layout.frame.minX - 16 },
                             "Revealed side panel covers the fitted route")
            }
        }
        framing = ["zoom": camera.zoom, "routePointCount": points.count,
                   "paddedVisibleRect": NSCoder.string(for: visible),
                   "nativePanelFrame": panelFrame.map { NSCoder.string(for: $0) } ?? "none",
                   "cameraSettled": true, "routeContained": true]
    }

    private func routeViewport(_ map: MapView) -> CGRect {
        // Standard's rendered coordinates can differ a few points from the
        // fitting API's inset (3.5pt in the wide fixture). Allow 8pt within the
        // reserved breathing room, then independently check the actual panel.
        map.bounds.inset(by: map.mapboxMap.cameraState.padding).insetBy(dx: -8, dy: -8)
            .intersection(map.bounds.insetBy(dx: 16, dy: 16))
    }

    func save(scene: GalleryScene, variant: GalleryVariant, library: String, scenario: GalleryManifest.Scenario) throws {
        host.view.layoutIfNeeded()
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let directory = GalleryEnvironment.output
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let name = "\(scene.rawValue)--\(variant.name)"
        // JPEG keeps runs small enough to embed in one self-contained index.
        try #require(image.jpegData(compressionQuality: 0.82)).write(to: directory.appendingPathComponent("\(name).jpg"))
        let metadata: [String: Any] = [
            "scene": scene.rawValue, "title": scenario.title,
            "listView": GalleryEnvironment.values["ACTIVITYMAP_GALLERY_LIST_VIEW"] ?? "columns",
            "listMetrics": GalleryEnvironment.values["ACTIVITYMAP_GALLERY_LIST_METRICS"] ?? "distance,elapsedTime,elevationGain",
            "listOptions": GalleryEnvironment.values["ACTIVITYMAP_GALLERY_LIST_OPTIONS"] == "1",
            "selectedIDs": scenario.selectedIDs, "search": scenario.search ?? "", "detailID": scenario.detailID as Any? ?? NSNull(),
            "fixtureHash": GalleryEnvironment.values["ACTIVITYMAP_GALLERY_FIXTURE_HASH"] ?? "unknown",
            "commit": GalleryEnvironment.values["ACTIVITYMAP_GALLERY_COMMIT"] ?? "unknown", "order": GalleryScene.allCases.firstIndex(of: scene) ?? 0,
            "variant": variant.name, "width": variant.size.width, "height": variant.size.height,
            "dark": variant.dark, "contentSize": variant.contentSize.rawValue, "library": library,
            "orientationCapture": GalleryEnvironment.values["ACTIVITYMAP_GALLERY_HOSTED_VIEWPORTS"] == "1" ? "hosted viewport" : "scene rotation",
            "basemap": GalleryEnvironment.mapboxToken == nil ? "offline" : "mapbox",
            "framing": framing,
        ]
        try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("\(name).json"))
    }

    private func mapView(in view: UIView) -> MapView? {
        if let map = view as? MapView { return map }
        return view.subviews.lazy.compactMap { self.mapView(in: $0) }.first
    }

    private func wait(seconds: Double, phase: String = "style loading", _ condition: () -> Bool) async throws {
        let settled = try await poll(seconds: seconds, condition)
        let map = mapView(in: host.view)
        try #require(settled, "Gallery \(phase) did not settle; viewport=\(String(describing: map?.viewport.status)), camera=\(String(describing: map?.mapboxMap.cameraState)), bounds=\(String(describing: map?.bounds)), \(readinessDetail)")
    }

    private func poll(seconds: Double, _ condition: () -> Bool) async throws -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while !condition(), Date() < end { try await Task.sleep(for: .milliseconds(50)) }
        return condition()
    }
}

struct GalleryManifest: Decodable {
    struct Scenario: Decodable {
        let id: String
        let title: String
        let selectedIDs: [Int]
        let detailID: Int?
        let search: String?
    }
    struct Variant: Decodable {
        let name: String
        let width: Double
        let height: Double
        let dark: Bool
        let largeText: Bool
        let landscape: Bool?
        var variant: GalleryVariant {
            GalleryVariant(name: name, size: CGSize(width: width, height: height), dark: dark,
                           contentSize: largeText ? .accessibilityExtraLarge : .large, regular: min(width, height) >= 600,
                           landscape: landscape ?? false)
        }
    }
    let scenarios: [Scenario]
    let variants: [Variant]
    static func load() throws -> Self {
        let url = GalleryEnvironment.values["ACTIVITYMAP_GALLERY_MANIFEST"].map { URL(fileURLWithPath: $0) }
            ?? URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("../../../../shared/gallery-scenarios.json").standardized
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

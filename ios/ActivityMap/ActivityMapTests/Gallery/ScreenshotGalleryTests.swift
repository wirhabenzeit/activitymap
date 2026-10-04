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
        for spec in manifest.variants where GalleryEnvironment.includes(spec.name, key: "VARIANTS") {
            let variant = spec.variant
            let staged = try scene.stage(library.activities, scenario: scenario)
            let window = try GalleryWindow(root: staged.root, variant: variant)
            defer { window.close() }
            try await window.settle(map: staged.usesMap, prepare: staged.prepare, reveal: staged.reveal, ready: staged.ready)
            try window.save(scene: scene, variant: variant, library: library.source, scenario: scenario)
        }
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

    var dynamicTypeSize: DynamicTypeSize { DynamicTypeSize(contentSize) ?? .large }
}

enum GalleryScene: String, CaseIterable, CustomTestStringConvertible {
    case map, mapResults = "map-results", mapDetail = "map-detail", list, listDetail = "list-detail"
    case filters, settings

    var testDescription: String { rawValue }

    struct Staged {
        let root: AnyView
        var usesMap = false
        var reveal: @MainActor () -> Void = {}
        var prepare: @MainActor () -> Void = {}
        var ready: @MainActor () -> Bool = { true }
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
            }, ready: { store.mapContext.pendingRequest == nil })
        case .mapDetail:
            let id = try #require(scenario.detailID)
            return Staged(root: shell(.map), usesMap: true, reveal: { picker.detent = .medium }, prepare: {
                store.replaceSelection(with: [id])
                picker.reviewSelection(store: store)
                store.mapContext.request(.fitSelection)
            }, ready: { store.mapContext.pendingRequest == nil })
        case .list:
            store.replaceSelection(with: scenario.selectedIDs)
            if GalleryEnvironment.values["ACTIVITYMAP_GALLERY_LIST_OPTIONS"] == "1" {
                return Staged(root: AnyView(NavigationStack { ListScreen(store: store, displayOpen: true) }))
            }
            return Staged(root: shell(.list))
        case .listDetail:
            let id = try #require(scenario.detailID)
            let root = shell(.list)
            return Staged(root: root, prepare: { store.inspect(id) })
        case .filters:
            // The shell presents this as an inspector/sheet; render its content.
            store.searchText = scenario.search ?? ""
            return Staged(root: AnyView(NavigationStack {
                FilterPanel(store: store).navigationTitle("Filters").navigationBarTitleDisplayMode(.inline)
            }))
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

    init(root: AnyView, variant: GalleryVariant) throws {
        previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = GalleryEnvironment.mapboxToken ?? "pk.offline-test"
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        oldWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: variant.size)
        window.traitOverrides.userInterfaceStyle = variant.dark ? .dark : .light
        window.traitOverrides.preferredContentSizeCategory = variant.contentSize
        window.traitOverrides.horizontalSizeClass = variant.regular ? .regular : .compact
        host = UIHostingController(rootView: AnyView(root
            .environment(\.locale, Locale(identifier: "de_CH"))
            .environment(\.timeZone, TimeZone(identifier: "Europe/Zurich")!)
            .environment(\.colorScheme, variant.dark ? .dark : .light)
            .environment(\.dynamicTypeSize, variant.dynamicTypeSize)
            .environment(\.horizontalSizeClass, variant.regular ? .regular : .compact)))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
    }

    func close() {
        window.isHidden = true
        oldWindow?.makeKeyAndVisible()
        MapboxOptions.accessToken = previousToken
    }

    func settle(map usesMap: Bool, prepare: @MainActor () -> Void, reveal: @MainActor () -> Void, ready: @MainActor () -> Bool) async throws {
        try await Task.sleep(for: .milliseconds(400))
        guard usesMap else {
            prepare()
            try await Task.sleep(for: .milliseconds(900))
            return
        }
        try await wait(seconds: 15) { self.mapView(in: self.host.view)?.mapboxMap.isStyleLoaded == true }
        prepare()
        let map = try #require(mapView(in: host.view))
        try await wait(seconds: 15, ready)
        // Wait for the camera fit and tiles; a remote basemap may take longer.
        var idle = false
        let token = map.mapboxMap.onMapIdle.observe { _ in idle = true }
        defer { token.cancel() }
        try await Task.sleep(for: .milliseconds(600))
        let settled = try await poll(seconds: 15) {
            if case .state = map.viewport.status { return true }
            return false
        }
        try #require(settled, "Viewport: \(map.viewport.status); camera: \(map.mapboxMap.cameraState)")
        // Best effort: an offline style may never report idle after a fit.
        _ = try await poll(seconds: GalleryEnvironment.mapboxToken == nil ? 2 : 5) { idle }
        // Production fitting collapses the panel. This scenario reviews the
        // revealed results/detail after the user expands it again.
        reveal()
        try await Task.sleep(for: .milliseconds(500))
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
            "basemap": GalleryEnvironment.mapboxToken == nil ? "offline" : "mapbox",
        ]
        try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("\(name).json"))
    }

    private func mapView(in view: UIView) -> MapView? {
        if let map = view as? MapView { return map }
        return view.subviews.lazy.compactMap { self.mapView(in: $0) }.first
    }

    private func wait(seconds: Double, _ condition: () -> Bool) async throws {
        try #require(try await poll(seconds: seconds, condition), "Gallery scene did not settle")
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
        var variant: GalleryVariant {
            GalleryVariant(name: name, size: CGSize(width: width, height: height), dark: dark,
                           contentSize: largeText ? .accessibilityExtraLarge : .large, regular: width >= 768)
        }
    }
    let scenarios: [Scenario]
    let variants: [Variant]
    static func load() throws -> Self {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../shared/gallery-scenarios.json").standardized
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

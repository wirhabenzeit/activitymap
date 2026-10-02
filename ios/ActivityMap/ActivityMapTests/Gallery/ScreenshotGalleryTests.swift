import Charts
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
        let library = try GalleryLibrary.load()
        for variant in GalleryVariant.all {
            let staged = try scene.stage(library.activities)
            let window = try GalleryWindow(root: staged.root, variant: variant)
            defer { window.close() }
            try await window.settle(map: staged.usesMap, prepare: staged.prepare)
            try window.save(scene: scene, variant: variant, library: library.source)
        }
    }
}

nonisolated enum GalleryEnvironment {
    static let values = ProcessInfo.processInfo.environment
    static var isEnabled: Bool { values["ACTIVITYMAP_GALLERY"] == "1" }
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

    static let all = [
        GalleryVariant(name: "phone", size: CGSize(width: 402, height: 874), dark: false, contentSize: .large, regular: false),
        GalleryVariant(name: "phone-dark", size: CGSize(width: 402, height: 874), dark: true, contentSize: .large, regular: false),
        GalleryVariant(name: "small-large-text", size: CGSize(width: 375, height: 667), dark: false, contentSize: .accessibilityExtraLarge, regular: false),
        GalleryVariant(name: "tablet", size: CGSize(width: 820, height: 1180), dark: false, contentSize: .large, regular: true),
    ]

    var dynamicTypeSize: DynamicTypeSize { DynamicTypeSize(contentSize) ?? .large }
}

enum GalleryScene: String, CaseIterable, CustomTestStringConvertible {
    case map, mapResults = "map-results", mapDetail = "map-detail", list, listDetail = "list-detail"
    case filters, settings, statsComponents = "stats-components"

    var testDescription: String { rawValue }

    var title: String {
        switch self {
        case .map: "Map"
        case .mapResults: "Map · selection results"
        case .mapDetail: "Map · activity detail"
        case .list: "List"
        case .listDetail: "List · activity detail"
        case .filters: "Filters"
        case .settings: "Settings (signed out)"
        case .statsComponents: "Stats components (synthetic fixture, not the dashboard)"
        }
    }

    struct Staged {
        let root: AnyView
        var usesMap = false
        var prepare: @MainActor () -> Void = {}
    }

    @MainActor func stage(_ activities: [Activity]) throws -> Staged {
        let store = ActivityStore(activities: activities, listPresentation: ActivityListPresentation(defaults: nil))
        let picker = RoutePicker()
        func shell(_ tab: AppTab) -> AnyView {
            store.selectedTab = tab
            return AnyView(AppShell(store: store, mapPicker: picker).galleryMapStyle())
        }
        let routed = activities.filter { !$0.coordinates.isEmpty }
        switch self {
        case .map:
            return Staged(root: shell(.map), usesMap: true)
        case .mapResults:
            let ids = routed.prefix(4).map(\.id)
            return Staged(root: shell(.map), usesMap: true) {
                store.replaceSelection(with: ids)
                picker.reviewSelection(store: store)
                store.mapContext.request(.fitSelection)
            }
        case .mapDetail:
            let id = try #require(Self.richest(routed)).id
            return Staged(root: shell(.map), usesMap: true) {
                store.replaceSelection(with: [id])
                picker.reviewSelection(store: store)
                store.mapContext.request(.fitSelection)
            }
        case .list:
            store.replaceSelection(with: routed.prefix(2).map(\.id))
            return Staged(root: shell(.list))
        case .listDetail:
            let id = try #require(Self.richest(activities)).id
            let root = shell(.list)
            return Staged(root: root) { store.inspect(id) }
        case .filters:
            // The shell presents this as an inspector/sheet; render its content.
            store.searchText = "ride"
            return Staged(root: AnyView(NavigationStack {
                FilterPanel(store: store).navigationTitle("Filters").navigationBarTitleDisplayMode(.inline)
            }))
        case .settings:
            return Staged(root: AnyView(AccountSheet(destination: .settings, auth: AuthController())))
        case .statsComponents:
            return Staged(root: AnyView(NavigationStack { GalleryStatsFixture().navigationTitle("Stats") }))
        }
    }

    /// The detail scene should exercise as many metric groups as possible.
    private static func richest(_ activities: [Activity]) -> Activity? {
        activities.max { score($0) < score($1) }
    }

    private static func score(_ activity: Activity) -> Int {
        let fields: [Any?] = [activity.distance, activity.movingTime, activity.totalElevationGain, activity.averageSpeed,
                              activity.averageHeartrate, activity.averageWatts, activity.weightedAverageWatts,
                              activity.elevHigh, activity.description]
        return fields.compactMap { $0 }.count
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

    func settle(map usesMap: Bool, prepare: @MainActor () -> Void) async throws {
        try await Task.sleep(for: .milliseconds(400))
        guard usesMap else {
            prepare()
            try await Task.sleep(for: .milliseconds(900))
            return
        }
        try await wait(seconds: 15) { self.mapView(in: self.host.view)?.mapboxMap.isStyleLoaded == true }
        prepare()
        let map = try #require(mapView(in: host.view))
        // Wait for the camera fit and tiles; a remote basemap may take longer.
        var idle = false
        let token = map.mapboxMap.onMapIdle.observe { _ in idle = true }
        defer { token.cancel() }
        try await Task.sleep(for: .milliseconds(600))
        idle = false
        // Best effort: an offline style may never report idle after a fit.
        _ = try await poll(seconds: GalleryEnvironment.mapboxToken == nil ? 2 : 5) { idle }
        try await Task.sleep(for: .milliseconds(500))
    }

    func save(scene: GalleryScene, variant: GalleryVariant, library: String) throws {
        host.view.layoutIfNeeded()
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds, format: format).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let directory = GalleryEnvironment.output
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let name = "\(scene.rawValue)--\(variant.name)"
        // JPEG keeps runs small enough to embed in one self-contained index.
        try #require(image.jpegData(compressionQuality: 0.82)).write(to: directory.appendingPathComponent("\(name).jpg"))
        let metadata: [String: Any] = [
            "scene": scene.rawValue, "title": scene.title, "order": GalleryScene.allCases.firstIndex(of: scene) ?? 0,
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

/// Synthetic component review fixture until the Stats dashboard lands (#263).
private struct GalleryStatsFixture: View {
    @State private var metric = StatsMetric.distance
    @State private var range = "Week"
    private let days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    // Known zero is distinct from an unavailable future period.
    private let values: [Double?] = [6, 0, 8.8, nil, nil, nil, nil]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.section) {
                BrowseSectionHeading(title: "Now", isStatsGroup: true)
                StatsTileSurface(title: "This week", period: "Week to date · 30 Sep", expand: {}) {
                    StatsMetricPicker(metrics: [.distance, .time, .elevation], selection: $metric)
                } content: {
                    BrowseMetricValue(title: "Distance", value: "14.8 km", emphasis: .headline)
                    StatsComparison(value: "12%", context: "vs same point last week", direction: .higher)
                    StatsChartSurface(title: "Daily distance, kilometres, week to date") {
                        Chart {
                            ForEach(days.indices, id: \.self) { index in
                                if let value = values[index] {
                                    BarMark(x: .value("Day", days[index]), y: .value("Distance, km", value))
                                        .foregroundStyle(StatsChartPalette.current)
                                }
                            }
                        }
                        .chartXScale(domain: days)
                    } dataRows: {
                        ForEach(days.indices, id: \.self) { index in
                            Text("\(days[index]): \(values[index].map { String(format: "%.1f km", $0) } ?? "Future, unavailable")")
                                .font(AppTheme.Typography.caption)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                BrowseSectionHeading(title: "Patterns", isStatsGroup: true)
                StatsTileSurface(title: "Sport mix", period: "All recorded activities") {
                    EmptyView()
                } content: {
                    StatsSportLegend(categories: ActivityCategory.allCases, includesMixedSports: true)
                }
                StatsRangePicker(title: "Period", ranges: ["Week", "Month", "Year"], selection: $range, label: { $0 })
            }
            .padding(AppTheme.Spacing.large)
        }
        .background(AppTheme.contentBackground)
    }
}

import MapLibre
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct MapLibreMigrationTests {
    @Test func sharedStylesAreBundledWithoutMapboxSources() throws {
        for definition in SharedMapCatalog.baseMaps {
            guard case let .style(path) = definition.source, path.hasPrefix("/map-styles/") else { continue }
            let url = try #require(Bundle.main.url(forResource: definition.id, withExtension: "json"))
            let json = try String(contentsOf: url, encoding: .utf8)
            #expect(!json.contains("mapbox://"))
            #expect(json.contains("\"version\": 8"))
        }
    }

    @Test func layersReinstallAfterStyleReloadAndReuseGeometry() async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 844))
        defer { harness.close() }
        let data = RouteSource.data(for: [ActivityStoreSelectionTests.activity(1)])
        let routes = RouteLayers(data: data, visibleIDs: [1], selectedIDs: [1], activeID: 1)
        func sync() throws {
            let style = try #require(harness.map.style)
            MapLayerSync.sync(style: style, base: .standard, overlays: [], routes: routes, places: [], showPlaceLabels: false)
            #expect(style.layers.filter { $0.identifier.hasPrefix("route") }.count == 6)
            let source = try #require(style.source(withIdentifier: RouteSource.id) as? MLNShapeSource)
            #expect((source.shape as? MLNShapeCollection)?.shapes.count == 1)
            routes.sync(style: style)
            #expect(style.source(withIdentifier: RouteSource.id) === source)
            #expect(style.layers.filter { $0.identifier.hasPrefix("route") }.count == 6)
        }
        try sync()
        try await harness.loadStyle()
        try sync()
    }

    @Test(arguments: [0.0, 25.0, 90.0, 145.0])
    func rotatedFitStaysAboveSheet(bearing: Double) async throws {
        let size = CGSize(width: 390, height: 844)
        let harness = try await CameraHarness(size: size)
        defer { harness.close() }
        let extent = try #require(RouteExtent(coordinates: [
            CLLocationCoordinate2D(latitude: 46.1, longitude: 8.1),
            CLLocationCoordinate2D(latitude: 46.5, longitude: 8.5)
        ]))
        let padding = RouteCameraFitter.padding(safeArea: .zero, sheetHeight: 400)
        for pitch: CGFloat in [0, 50] {
            let current = MapCamera(center: extent.center, zoom: 10, bearing: bearing, pitch: pitch)
            let target = try RouteCameraFitter.camera(extent: extent, map: harness.renderer, padding: padding, size: size, current: current)
            harness.renderer.move(to: target, duration: 0)
            let visible = CGRect(origin: .zero, size: size).inset(by: padding).insetBy(dx: -2, dy: -2)
            #expect(harness.renderer.points(for: extent.corners).allSatisfy { visible.contains($0) })
        }
    }
}

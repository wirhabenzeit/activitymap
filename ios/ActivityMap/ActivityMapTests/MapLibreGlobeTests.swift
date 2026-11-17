import MapLibre
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct MapLibreGlobeTests {
    private var globeStyle: String { get throws { try MapStyleProjection.globeJSON(CameraHarness.style) } }

    @Test func catalogueUsesGlobeAndKeepsSharedFilesUntouched() throws {
        for base in BaseStyle.all {
            let style = base.mapLibreStyle(dark: false)
            if let json = style.json {
                let object = try #require(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
                #expect((object["projection"] as? [String: String])?["type"] == "globe")
            } else { #expect(style.globe) }
        }
    }

    @Test func remoteStylesKeepRelativeResourcesWhenProjectionIsAdded() throws {
        let json = #"{"version":8,"glyphs":"fonts/{fontstack}/{range}.pbf","sprite":"../sprite","sources":{"vector":{"url":"tiles.json"},"raster":{"tiles":["../tiles/{z}/{x}/{y}.png"]}},"layers":[]}"#
        let result = try MapStyleProjection.globeJSON(json, relativeTo: URL(string: "https://example.com/maps/style.json")!)
        let object = try #require(JSONSerialization.jsonObject(with: Data(result.utf8)) as? [String: Any])
        #expect(object["glyphs"] as? String == "https://example.com/maps/fonts/{fontstack}/{range}.pbf")
        #expect(object["sprite"] as? String == "https://example.com/sprite")
        let sources = try #require(object["sources"] as? [String: [String: Any]])
        #expect(sources["vector"]?["url"] as? String == "https://example.com/maps/tiles.json")
        #expect(sources["raster"]?["tiles"] as? [String] == ["https://example.com/tiles/{z}/{x}/{y}.png"])
    }

    @Test func globeHidesRearOverlaysAndRevealsThemAfterRotation() async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 844), styleJSON: globeStyle)
        defer { harness.close() }
        let front = CLLocationCoordinate2D(latitude: 0, longitude: 0)
        let rear = CLLocationCoordinate2D(latitude: 0, longitude: 180)
        harness.renderer.move(to: MapCamera(center: front, zoom: 1), duration: 0)
        #expect(!harness.map.isCoordinateOccluded(front))
        #expect(harness.map.isCoordinateOccluded(rear))
        #expect(harness.renderer.point(for: rear).x.isNaN)
        let wrapped = harness.renderer.point(for: .init(latitude: 0, longitude: 360))
        let origin = harness.renderer.point(for: front)
        #expect(abs(wrapped.x - origin.x) < 0.001 && abs(wrapped.y - origin.y) < 0.001)
        let positions = MapPositionState()
        positions.update(map: harness.renderer, located: rear, route: rear)
        #expect(positions.located == nil && positions.route == nil)
        harness.renderer.move(to: MapCamera(center: rear, zoom: 1), duration: 0)
        positions.update(map: harness.renderer, located: rear, route: rear)
        #expect(positions.located != nil && positions.route != nil)
        #expect(harness.map.isCoordinateOccluded(front))
    }

    @Test(arguments: [0.0, 50.0])
    func globeFitsRoutesFromWorldView(pitch: Double) async throws {
        let size = CGSize(width: 390, height: 844)
        let harness = try await CameraHarness(size: size, styleJSON: globeStyle)
        defer { harness.close() }
        for coordinates: [CLLocationCoordinate2D] in [
            [.init(latitude: 46.1, longitude: 8.1), .init(latitude: 46.5, longitude: 8.5)],
            [.init(latitude: -17, longitude: 179.8), .init(latitude: -16.8, longitude: -179.7)],
            [.init(latitude: 68.5, longitude: 14), .init(latitude: 68.6, longitude: 14.2)]
        ] {
            let current = MapCamera(center: .init(latitude: 0, longitude: 0), zoom: 1, bearing: 25, pitch: pitch)
            harness.renderer.move(to: current, duration: 0)
            let extent = try #require(RouteExtent(coordinates: coordinates))
            let padding = RouteCameraFitter.padding(safeArea: .zero, sheetHeight: 350)
            let target = try RouteCameraFitter.camera(extent: extent, map: harness.renderer, padding: padding, size: size, current: current)
            harness.renderer.move(to: target, duration: 0)
            let visible = CGRect(origin: .zero, size: size).inset(by: padding).insetBy(dx: -2, dy: -2)
            #expect(harness.renderer.points(for: coordinates).allSatisfy { visible.contains($0) })
            #expect(harness.map.contentInset == .zero)
        }
    }

    @Test func globeRouteQueryStillSelectsVisibleRoute() async throws {
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 844), styleJSON: globeStyle)
        defer { harness.close() }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        store.routeGeometry.update(activities: store.activities, revision: store.activitiesRevision)
        let style = try #require(harness.map.style)
        RouteLayers(data: store.routeGeometry.data, visibleIDs: [1], selectedIDs: [], activeID: nil).sync(style: style)
        let center = CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005)
        harness.renderer.move(to: MapCamera(center: center, zoom: 13), duration: 0)
        let deadline = Date().addingTimeInterval(10)
        while harness.map.visibleFeatures(in: harness.map.bounds, styleLayerIdentifiers: [RouteSource.ordinaryLayerID]).isEmpty && Date() < deadline {
            try await Task.sleep(for: .milliseconds(25))
        }
        let picker = RoutePicker()
        picker.pick(at: harness.renderer.point(for: center), map: harness.renderer, store: store)
        #expect(picker.candidateIDs == [1])
    }
}

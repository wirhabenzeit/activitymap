import MapLibre
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct MapPickerTests {
    @Test func legacySelectionsRestoreToStreetAndSwissMapsStayAvailable() throws {
        let definitions = SharedMapCatalog.baseMaps
        let swiss = try #require(SharedMapCatalog.baseMapGroups.first { $0.id == "switzerland" })
        #expect(Set(swiss.maps) == Set(definitions.filter { $0.id.hasPrefix("swisstopo") }.map(\.id)))
        #expect(!BaseStyle.all.contains { $0.id == "mapboxStreet3d" || $0.id == "native.standard" })
        #expect(BaseStyle.restored(id: "mapboxStreet3d") == .street)
        #expect(BaseStyle.restored(id: "native.standard") == .street)
        for id in swiss.maps { #expect(BaseStyle.restored(id: id).id == id) }
    }

    @Test func pickerGroupsAreCountriesWithFlags() {
        #expect(SharedMapCatalog.baseMapGroups.map(\.label) == ["Worldwide", "Switzerland", "Norway"])
        #expect(SharedMapCatalog.overlayGroups.map(\.label) == ["Switzerland", "Norway"])
        #expect(SharedMapCatalog.overlayGroups.last?.overlays == ["nveAvalanche"])
        #expect(SharedMapCatalog.baseMapGroups.first?.country == nil)
        #expect(RegionIcon.flag("CH") == "🇨🇭")
        #expect(RegionIcon.flag("NO") == "🇳🇴")
        #expect(RegionIcon.flag("ch1") == nil)
    }

    @Test func savedStreet3DPreferenceMigratesWithoutLosingOverlays() throws {
        let name = "map-picker-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let saved = #"{"baseStyle":"mapboxStreet3d","overlays":["swisstopoSki"],"photos":true,"places":true}"#
        defaults.set(Data(saved.utf8), forKey: "browsing.v1.mapAppearance")
        let context = MapContext(defaults: defaults)
        #expect(context.baseStyle == .street)
        #expect(context.showPhotos && context.showPlaces)
        #expect(context.activeOverlays.map(\.id) == ["swisstopoSki"])
    }

    @Test func streetBuildingsFollow3DAndSurviveStyleReload() async throws {
        let styleURL = try #require(Bundle.main.url(forResource: "mapboxStreet", withExtension: "json"))
        let json = try String(contentsOf: styleURL, encoding: .utf8)
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 844), styleJSON: json)
        defer { harness.close() }
        func sync(_ pitched: Bool) throws {
            let style = try #require(harness.map.style)
            MapLayerSync.sync(style: style, base: .street, overlays: [],
                routes: RouteLayers(data: RouteSource.data(for: []), visibleIDs: [], selectedIDs: [], activeID: nil),
                places: [], showPlaceLabels: false, pitched: pitched)
            let buildings = try #require(style.layer(withIdentifier: "building-3d") as? MLNFillExtrusionStyleLayer)
            #expect(buildings.isVisible == pitched)
            #expect(buildings.minimumZoomLevel == 15)
        }
        try sync(false)
        try sync(true)
        harness.renderer.isStyleLoaded = false
        harness.map.styleJSON = json
        let deadline = Date().addingTimeInterval(10)
        while !harness.renderer.isStyleLoaded && Date() < deadline { try await Task.sleep(for: .milliseconds(25)) }
        try #require(harness.renderer.isStyleLoaded)
        try sync(true)
        try sync(false)
    }
}

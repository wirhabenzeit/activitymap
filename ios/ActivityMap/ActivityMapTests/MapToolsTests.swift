import CoreLocation
import MapboxMaps
import Testing
@testable import ActivityMap

@MainActor
struct MapToolsTests {
    @Test func foregroundPermissionAndOneShotFix() {
        let provider = LocationProviderStub()
        let location = MapLocationController(provider: provider)
        var coordinates: [CLLocationCoordinate2D] = []
        location.locate { coordinates.append($0) }
        #expect(location.isRequesting && provider.permissionRequests == 1 && provider.fixRequests == 0)
        provider.authorizationStatus = .authorizedWhenInUse
        location.authorizationChanged()
        location.authorizationChanged()
        #expect(provider.fixRequests == 1)
        location.receive([CLLocation(latitude: 47.4, longitude: 8.5)])
        location.receive([CLLocation(latitude: 0, longitude: 0)])
        #expect(!location.isRequesting && coordinates.count == 1)
        #expect(coordinates.first?.latitude == 47.4 && coordinates.first?.longitude == 8.5)
        #expect(location.errorMessage == nil && provider.stops == 1)
    }

    @Test(arguments: [CLAuthorizationStatus.denied, .restricted])
    func permissionFailuresNeverProduceFallbackCoordinates(status: CLAuthorizationStatus) {
        let provider = LocationProviderStub()
        provider.authorizationStatus = status
        let location = MapLocationController(provider: provider)
        var calls = 0
        location.locate { _ in calls += 1 }
        #expect(!location.isRequesting && location.errorMessage != nil)
        #expect(location.offersSettings == (status == .denied))
        #expect(provider.fixRequests == 0 && calls == 0)
    }

    @Test func invalidStaleAndCancelledFixesDoNotMoveMap() {
        let provider = LocationProviderStub()
        provider.authorizationStatus = .authorizedWhenInUse
        let location = MapLocationController(provider: provider)
        var calls = 0
        location.locate { _ in calls += 1 }
        let old = CLLocation(coordinate: .init(latitude: 47, longitude: 8), altitude: 0,
            horizontalAccuracy: 100, verticalAccuracy: 100, timestamp: Date().addingTimeInterval(-120))
        let invalid = CLLocation(coordinate: .init(latitude: .nan, longitude: 8), altitude: 0,
            horizontalAccuracy: -1, verticalAccuracy: -1, timestamp: Date())
        location.receive([old, invalid])
        #expect(calls == 0 && location.isRequesting)
        location.cancel()
        location.receive([CLLocation(latitude: 47, longitude: 8)])
        location.receive(CLError(.locationUnknown))
        #expect(calls == 0 && !location.isRequesting && location.errorMessage == nil)
    }

    @Test func unavailableLocationAndTimeoutAllowRetry() async throws {
        let provider = LocationProviderStub()
        provider.authorizationStatus = .authorizedWhenInUse
        let location = MapLocationController(provider: provider, requestTimeout: .milliseconds(20))
        location.locate { _ in Issue.record("A failed fix must not navigate") }
        location.receive(CLError(.locationUnknown))
        #expect(!location.isRequesting && location.errorMessage != nil)
        location.locate { _ in Issue.record("A timeout must not navigate") }
        try await Task.sleep(for: .milliseconds(80))
        #expect(!location.isRequesting && location.errorMessage != nil && provider.fixRequests == 2)
        var success = false
        location.locate { _ in success = true }
        #expect(location.errorMessage == nil)
        location.receive([CLLocation(latitude: 46, longitude: 9)])
        #expect(success)
    }

    @Test func compassWrapsNorthAndUsesHysteresis() {
        let compass = MapCompassState(bearing: 359.5)
        #expect(!compass.isVisible)
        compass.record(357)
        #expect(compass.isVisible && compass.bearing == -3)
        compass.record(358.5)
        #expect(compass.isVisible)
        compass.record(359.2)
        #expect(!compass.isVisible)
        compass.record(-1.5)
        #expect(!compass.isVisible)
        compass.record(90)
        #expect(compass.isVisible && compass.bearing == 90)
        compass.record(360)
        #expect(!compass.isVisible && compass.bearing == 0)
        compass.record(.nan)
        #expect(compass.bearing == 0)
    }

    @Test(arguments: [CGSize(width: 390, height: 844), CGSize(width: 768, height: 1024), CGSize(width: 800, height: 390)])
    func compassAvoidsNavigationControlsAndResults(size: CGSize) throws {
        let controlsCenter = MapResultsLayout.controlsCenter(size: size, topInset: 106)
        let controls = CGRect(x: controlsCenter.x - 26, y: controlsCenter.y - 77, width: 52, height: 154)
        for largeText in [false, true] {
            for detent in MapResultsDetent.allCases {
                let results = MapResultsLayout(size: size, topInset: 106, bottomInset: 34, detent: detent, largeText: largeText)
                let center = MapCompassLayout.center(size: size, topInset: 106, bottomInset: 34,
                    showingResults: true, detent: detent, largeText: largeText)
                if !results.isSidePanel && detent == .expanded { #expect(center == nil); continue }
                let point = try #require(center)
                let target = CGRect(x: point.x - 22, y: point.y - 22, width: 44, height: 44)
                #expect(target.minY > 106 && CGRect(origin: .zero, size: size).contains(target))
                #expect(!target.intersects(controls) && !target.intersects(results.frame))
            }
        }
    }

    @Test func terrainCatalogueAndLateEvents() throws {
        #expect(BaseStyle.all.allSatisfy { $0.terrainConfiguration != nil })
        let source = try #require(BaseStyle.standard.terrainConfiguration).source(id: "dem")
        #expect(source.url == "mapbox://mapbox.mapbox-terrain-dem-v1" && source.type == .rasterDem)
        #expect(source.maxzoom == 14 && source.tileSize == 514)
        let terrain = MapTerrainState()
        terrain.configure(enabled: true, supported: true)
        let first = terrain.sourceID
        #expect(terrain.status == .loading)
        terrain.configure(enabled: true, supported: true, restart: true)
        terrain.loaded(sourceID: first)
        terrain.failed(sourceID: first)
        #expect(terrain.status == .loading && terrain.errorMessage == nil)
        terrain.loaded(sourceID: terrain.sourceID)
        #expect(terrain.status == .ready)
        terrain.failed(sourceID: terrain.sourceID)
        #expect(terrain.status == .failed && !terrain.includesTerrain && terrain.errorMessage != nil)
        terrain.configure(enabled: false, supported: true)
        terrain.configure(enabled: true, supported: true)
        #expect(terrain.status == .loading && terrain.sourceID != first && terrain.errorMessage == nil)
        terrain.configure(enabled: true, supported: false)
        #expect(terrain.status == .unsupported && !terrain.includesTerrain && terrain.errorMessage != nil)
    }
}

@MainActor
private final class LocationProviderStub: ForegroundLocationProvider {
    weak var delegate: CLLocationManagerDelegate?
    var authorizationStatus = CLAuthorizationStatus.notDetermined
    var permissionRequests = 0
    var fixRequests = 0
    var stops = 0
    func requestWhenInUseAuthorization() { permissionRequests += 1 }
    func requestLocation() { fixRequests += 1 }
    func stopUpdatingLocation() { stops += 1 }
}

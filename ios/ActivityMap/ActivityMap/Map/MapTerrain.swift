import MapboxMaps
import Observation
import SwiftUI

struct MapTerrainConfiguration: Equatable {
    var url: String? = "mapbox://mapbox.mapbox-terrain-dem-v1"
    var tiles: [String]? = nil

    func source(id: String) -> RasterDemSource {
        var source = RasterDemSource(id: id)
        source.url = url
        source.tiles = tiles
        source.tileSize = 514
        source.maxzoom = 14
        return source
    }
}

extension BaseStyle {
    /// Elevation is a separate global DEM, also used under raster basemaps.
    /// All styles in the current catalogue can be draped over this source.
    /// Unknown styles require an explicit compatibility decision.
    var terrainConfiguration: MapTerrainConfiguration? {
        switch self {
        case .standard: MapTerrainConfiguration()
        case let .shared(definition):
            SharedMapCatalog.baseMaps.contains(where: { $0.id == definition.id })
                ? MapTerrainConfiguration() : nil
        }
    }
}

@Observable
final class MapTerrainState {
    enum Status: Equatable { case off, loading, ready, failed, unsupported }
    private(set) var status = Status.off
    private(set) var sourceID = "activitymap-dem-\(UUID().uuidString)"
    var errorMessage: String?
    var includesTerrain: Bool { status == .loading || status == .ready }
    var accessibilityValue: String {
        switch status {
        case .off: "Off"
        case .loading: "Loading elevation"
        case .ready: "On"
        case .failed: "Tilted; elevation unavailable"
        case .unsupported: "Elevation unsupported for this map"
        }
    }

    func configure(enabled: Bool, supported: Bool, restart: Bool = false) {
        guard enabled else {
            // Returning to a flat map must not republish unchanged state and
            // cause an unnecessary update of the SDK's retained viewport.
            if status != .off { status = .off }
            if errorMessage != nil { errorMessage = nil }
            return
        }
        guard supported else {
            status = .unsupported
            errorMessage = "Elevation terrain is unavailable for this map style. Choose another base map to use 3D terrain."
            return
        }
        if restart || status == .off || status == .unsupported {
            // A new identity fences delayed events from a previous style/request.
            sourceID = "activitymap-dem-\(UUID().uuidString)"
            status = .loading
            errorMessage = nil
        }
    }

    func loaded(sourceID: String) {
        guard sourceID == self.sourceID, status == .loading else { return }
        status = .ready
    }

    func failed(sourceID: String) {
        guard sourceID == self.sourceID, includesTerrain else { return }
        status = .failed
        errorMessage = "Elevation could not be loaded. The map remains tilted. Check your connection, then turn 3D off and on to retry."
    }
}

/// Declarative content is reinstalled by the SDK after every style reload.
struct MapTerrainContent: MapStyleContent {
    let configuration: MapTerrainConfiguration
    let sourceID: String

    var body: some MapStyleContent {
        configuration.source(id: sourceID)
        Terrain(sourceId: sourceID).exaggeration(1.5)
    }
}

extension EnvironmentValues {
    // Offline rendered tests can provide a local DEM. A style override alone
    // does not introduce remote terrain requests into existing test fixtures.
    @Entry var mapTerrainOverride: MapTerrainConfiguration? = nil
}

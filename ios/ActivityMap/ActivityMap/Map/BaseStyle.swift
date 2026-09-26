import SwiftUI

struct RasterConfiguration {
    let url: String
    let tileSize: Double
}

enum BaseStyle: Hashable, Identifiable {
    case standard
    case shared(SharedBaseMapDefinition)

    static let all: [BaseStyle] = [.standard]
        + SharedMapCatalog.baseMaps.map(BaseStyle.shared)

    var id: String {
        switch self {
        case .standard:
            "native.standard"
        case let .shared(definition):
            definition.id
        }
    }

    var title: String {
        switch self {
        case .standard:
            "Standard"
        case let .shared(definition):
            definition.label
        }
    }

    var systemImage: String {
        switch id {
        case "mapboxSatellite", "swisstopoSatellite":
            "globe.americas"
        case "mapboxOutdoors", "swisstopoVectorWinter", "swisstopoWinter":
            "mountain.2"
        case "mapboxDark":
            "moon"
        case "mapboxLight", "mapboxTopolight", "swisstopoVectorLight":
            "sun.max"
        default:
            "map"
        }
    }

    var styleURL: String? {
        guard case let .shared(definition) = self,
              case let .style(url) = definition.source else {
            return nil
        }
        return url
    }

    var rasterSource: RasterConfiguration? {
        guard case let .shared(definition) = self,
              case let .raster(url, tileSize) = definition.source else {
            return nil
        }
        return RasterConfiguration(url: url, tileSize: tileSize)
    }

    var attribution: String? {
        switch self {
        case .standard:
            nil
        case let .shared(definition):
            definition.attribution
        }
    }
}


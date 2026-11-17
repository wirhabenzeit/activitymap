import SwiftUI

struct RasterConfiguration {
    let url: String
    let tileSize: Double
}

enum BaseStyle: Hashable, Identifiable {
    case standard
    case shared(SharedBaseMapDefinition)

    static let street = BaseStyle.shared(SharedMapCatalog.baseMaps.first { $0.id == "mapboxStreet" }!)
    static let all: [BaseStyle] = SharedMapCatalog.baseMapGroups.flatMap(\.maps).compactMap { id in
        SharedMapCatalog.baseMaps.first { $0.id == id }
    }.filter { definition in
        !["mapboxOutdoors", "mapboxSatellite"].contains(definition.id) || !mapTilerKey.isEmpty
    }.map(BaseStyle.shared)

    static func restored(id: String) -> BaseStyle {
        let canonical = SharedMapCatalog.baseMapAliases[id] ?? id
        return all.first { $0.id == canonical } ?? .street
    }

    private static var mapTilerKey: String {
        (Bundle.main.object(forInfoDictionaryKey: "ActivityMapMapTilerKey") as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

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


extension BaseStyle {
    func mapLibreStyle(dark: Bool) -> MapStyle {
        let fallback = dark ? "mapboxDark" : "mapboxStreet"
        let name: String
        if let path = styleURL, path.hasPrefix("/map-styles/") {
            name = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
        } else if let path = styleURL, let url = URL(string: path) {
            return MapStyle(url: url, globe: true)
        } else { name = fallback }
        return Self.bundledStyles[name] ?? MapStyle(json: "{\"version\":8,\"projection\":{\"type\":\"globe\"},\"sources\":{},\"layers\":[]}")
    }

    private static let bundledStyles: [String: MapStyle] = {
        let key = mapTilerKey.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return Dictionary(uniqueKeysWithValues: SharedMapCatalog.baseMaps.compactMap { definition in
            guard case let .style(path) = definition.source, path.hasPrefix("/map-styles/"),
                  let url = Bundle.main.url(forResource: definition.id, withExtension: "json"),
                  let json = try? String(contentsOf: url, encoding: .utf8),
                  let globeJSON = try? MapStyleProjection.globeJSON(json.replacingOccurrences(of: "{MAPTILER_KEY}", with: key)) else { return nil }
            return (definition.id, MapStyle(json: globeJSON))
        })
    }()
}

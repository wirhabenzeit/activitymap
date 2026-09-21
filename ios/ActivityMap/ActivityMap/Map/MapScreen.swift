import MapboxMaps
import SwiftUI
import UIKit

struct MapScreen: View {
    @Bindable var store: ActivityStore

    private static let defaultCenter = CLLocationCoordinate2D(latitude: 46.95, longitude: 9.1)

    @Environment(\.colorScheme) private var colorScheme
    @State private var viewport: Viewport = .camera(center: defaultCenter, zoom: 6.5)
    @State private var isPitched = false
    @State private var baseStyle = BaseStyle.standard
    @State private var activeOverlays: Set<OverlayStyle> = []

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Map(viewport: $viewport) {
                if let raster = baseStyle.rasterSource {
                    rasterSource(id: "selected-raster-base", url: raster.url)

                    RasterLayer(id: "selected-raster-base-layer", source: "selected-raster-base")
                }

                ForEvery(OverlayStyle.allCases.filter(activeOverlays.contains)) { overlay in
                    rasterSource(id: overlay.sourceID, url: overlay.url)

                    RasterLayer(id: overlay.layerID, source: overlay.sourceID)
                        .rasterOpacity(overlay.opacity)
                }

                ForEvery(store.filteredActivities) { activity in
                    PolylineAnnotation(
                        id: String(activity.id),
                        lineCoordinates: activity.coordinates
                    )
                    .lineColor(StyleColor(UIColor(activity.category.color)))
                    .lineWidth(activity.id == store.highlightedActivityID ? 5 : 3)
                }
            }
            .mapStyle(mapStyle)
            .ignoresSafeArea()

            mapControls
                .padding(16)

            if let attribution {
                Text(attribution)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .glassEffect(.clear, in: Capsule())
                    .padding(.leading, 8)
                    .padding(.bottom, 42)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .allowsHitTesting(false)
            }
        }
    }

    private var mapControls: some View {
        VStack(spacing: 8) {
            Menu {
                Section("Base Map") {
                    Picker("Base Map", selection: $baseStyle) {
                        ForEach(BaseStyle.allCases) { style in
                            Label(style.title, systemImage: style.systemImage)
                                .tag(style)
                        }
                    }
                }

                Section("Overlays") {
                    ForEach(OverlayStyle.allCases) { overlay in
                        Button {
                            toggleOverlay(overlay)
                        } label: {
                            if activeOverlays.contains(overlay) {
                                Label(overlay.title, systemImage: "checkmark")
                            } else {
                                Text(overlay.title)
                            }
                        }
                    }
                }
            } label: {
                Image(systemName: "square.3.layers.3d")
                    .frame(width: 36, height: 36)
            }

            Button {
                isPitched.toggle()
                updateViewport()
            } label: {
                Image(systemName: "view.3d")
                    .frame(width: 36, height: 36)
            }

            Button {
                isPitched = false
                updateViewport()
            } label: {
                Image(systemName: "scope")
                    .frame(width: 36, height: 36)
            }
        }
        .buttonStyle(.glass(.clear))
    }

    private var mapStyle: MapStyle {
        if let styleURL = baseStyle.styleURL,
           let url = URL(string: styleURL),
           let styleURI = StyleURI(url: url) {
            return MapStyle(uri: styleURI)
        }

        return .standard(lightPreset: colorScheme == .dark ? .night : .day)
    }

    private var attribution: String? {
        var providers: [String] = []

        if let provider = baseStyle.attribution {
            providers.append(provider)
        }
        if activeOverlays.contains(where: { $0.provider == .swisstopo }) {
            providers.append("© swisstopo")
        }
        if activeOverlays.contains(where: { $0.provider == .nve }) {
            providers.append("© NVE")
        }

        let uniqueProviders = Array(Set(providers)).sorted()
        return uniqueProviders.isEmpty ? nil : uniqueProviders.joined(separator: "  •  ")
    }

    private func toggleOverlay(_ overlay: OverlayStyle) {
        if activeOverlays.contains(overlay) {
            activeOverlays.remove(overlay)
        } else {
            activeOverlays.insert(overlay)
        }
    }

    private func rasterSource(id: String, url: String) -> RasterSource {
        var source = RasterSource(id: id)
            .tiles([url])
        source.tileSize = 256
        return source
    }

    private func updateViewport() {
        withViewportAnimation(.default(maxDuration: 0.6)) {
            viewport = .camera(
                center: Self.defaultCenter,
                zoom: 6.5,
                bearing: 0,
                pitch: isPitched ? 50 : 0
            )
        }
    }
}

private enum BaseStyle: String, CaseIterable, Identifiable {
    case standard
    case mapboxStreets
    case mapboxStreets3D
    case mapboxOutdoors
    case mapboxLight
    case mapboxTopoLight
    case mapboxDark
    case mapboxSatellite
    case swisstopoVector
    case swisstopoLight
    case swisstopoWinter
    case swisstopoSatellite
    case swisstopoPixelMap
    case swisstopoWinterRaster
    case norgesKart

    var id: String { rawValue }

    var title: String {
        switch self {
        case .standard: "Standard"
        case .mapboxStreets: "Mapbox Streets"
        case .mapboxStreets3D: "Mapbox Streets 3D"
        case .mapboxOutdoors: "Mapbox Outdoors"
        case .mapboxLight: "Mapbox Light"
        case .mapboxTopoLight: "Mapbox Topolight"
        case .mapboxDark: "Mapbox Dark"
        case .mapboxSatellite: "Mapbox Satellite"
        case .swisstopoVector: "swisstopo Vector"
        case .swisstopoLight: "swisstopo Light"
        case .swisstopoWinter: "swisstopo Winter"
        case .swisstopoSatellite: "swisstopo Satellite"
        case .swisstopoPixelMap: "swisstopo Pixel Map"
        case .swisstopoWinterRaster: "swisstopo Winter Raster"
        case .norgesKart: "NorgesKart"
        }
    }

    var systemImage: String {
        switch self {
        case .standard: "map"
        case .mapboxSatellite, .swisstopoSatellite: "globe.americas"
        case .mapboxOutdoors, .swisstopoWinter, .swisstopoWinterRaster: "mountain.2"
        case .mapboxDark: "moon"
        case .mapboxLight, .mapboxTopoLight, .swisstopoLight: "sun.max"
        default: "map"
        }
    }

    var styleURL: String? {
        switch self {
        case .standard, .swisstopoPixelMap, .swisstopoWinterRaster, .norgesKart:
            nil
        case .mapboxStreets:
            "mapbox://styles/mapbox/streets-v12"
        case .mapboxStreets3D:
            "mapbox://styles/wirhabenzeit/clk6y6c1q00lk01pe8fqs0urn"
        case .mapboxOutdoors:
            "mapbox://styles/mapbox/outdoors-v12"
        case .mapboxLight:
            "mapbox://styles/mapbox/light-v11"
        case .mapboxTopoLight:
            "mapbox://styles/wirhabenzeit/clk0tpduc00ab01qyguzi09gv"
        case .mapboxDark:
            "mapbox://styles/mapbox/dark-v11"
        case .mapboxSatellite:
            "mapbox://styles/mapbox/satellite-v9"
        case .swisstopoVector:
            "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json"
        case .swisstopoLight:
            "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json"
        case .swisstopoWinter:
            "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap-winter.vt/style.json"
        case .swisstopoSatellite:
            "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.leichte-basiskarte-imagery.vt/style.json"
        }
    }

    var rasterSource: RasterConfiguration? {
        switch self {
        case .swisstopoPixelMap:
            RasterConfiguration(url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg")
        case .swisstopoWinterRaster:
            RasterConfiguration(url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe-winter/default/current/3857/{z}/{x}/{y}.jpeg")
        case .norgesKart:
            RasterConfiguration(url: "https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png")
        default:
            nil
        }
    }

    var attribution: String? {
        switch self {
        case .swisstopoVector, .swisstopoLight, .swisstopoWinter, .swisstopoSatellite,
             .swisstopoPixelMap, .swisstopoWinterRaster:
            "© swisstopo"
        case .norgesKart:
            "© Kartverket"
        default:
            nil
        }
    }
}

private struct RasterConfiguration {
    let url: String
}

private enum OverlayProvider {
    case swisstopo
    case nve
}

private enum OverlayStyle: String, CaseIterable, Identifiable {
    case swisstopoSki
    case nveAvalanche
    case swisstopoSlope
    case veloland
    case wanderland

    var id: String { rawValue }
    var sourceID: String { "\(rawValue)-source" }
    var layerID: String { "\(rawValue)-layer" }

    var title: String {
        switch self {
        case .swisstopoSki: "swisstopo Ski"
        case .nveAvalanche: "NVE Avalanche"
        case .swisstopoSlope: "swisstopo Slope"
        case .veloland: "Veloland"
        case .wanderland: "Wanderland"
        }
    }

    var url: String {
        switch self {
        case .swisstopoSki:
            "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png"
        case .nveAvalanche:
            "https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/{z}/{y}/{x}"
        case .swisstopoSlope:
            "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png"
        case .veloland:
            "https://wmts.geo.admin.ch/1.0.0/ch.astra.veloland/default/current/3857/{z}/{x}/{y}.png"
        case .wanderland:
            "https://wmts.geo.admin.ch/1.0.0/ch.astra.wanderland/default/current/3857/{z}/{x}/{y}.png"
        }
    }

    var opacity: Double {
        switch self {
        case .swisstopoSki: 0.8
        case .nveAvalanche: 0.2
        case .swisstopoSlope, .veloland, .wanderland: 0.4
        }
    }

    var provider: OverlayProvider {
        switch self {
        case .nveAvalanche: .nve
        default: .swisstopo
        }
    }
}

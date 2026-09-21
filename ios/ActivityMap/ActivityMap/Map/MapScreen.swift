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
    @State private var activeOverlays = Set(
        SharedMapCatalog.rasterOverlays.filter(\.visibleByDefault)
    )

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Map(viewport: $viewport) {
                if let raster = baseStyle.rasterSource {
                    rasterSource(
                        id: "selected-raster-base",
                        url: raster.url,
                        tileSize: raster.tileSize
                    )

                    RasterLayer(id: "selected-raster-base-layer", source: "selected-raster-base")
                }

                ForEvery(SharedMapCatalog.rasterOverlays.filter(activeOverlays.contains)) { overlay in
                    rasterSource(
                        id: overlay.sourceID,
                        url: overlay.url,
                        tileSize: overlay.tileSize
                    )

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
                        ForEach(BaseStyle.all) { style in
                            Label(style.title, systemImage: style.systemImage)
                                .tag(style)
                        }
                    }
                }

                Section("Overlays") {
                    ForEach(SharedMapCatalog.rasterOverlays) { overlay in
                        Button {
                            toggleOverlay(overlay)
                        } label: {
                            if activeOverlays.contains(overlay) {
                                Label(overlay.label, systemImage: "checkmark")
                            } else {
                                Text(overlay.label)
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
        var providers = activeOverlays.compactMap(\.attribution)

        if let baseAttribution = baseStyle.attribution {
            providers.append(baseAttribution)
        }

        let uniqueProviders = Array(Set(providers)).sorted()
        return uniqueProviders.isEmpty ? nil : uniqueProviders.joined(separator: "  •  ")
    }

    private func toggleOverlay(_ overlay: SharedRasterOverlayDefinition) {
        if activeOverlays.contains(overlay) {
            activeOverlays.remove(overlay)
        } else {
            activeOverlays.insert(overlay)
        }
    }

    private func rasterSource(id: String, url: String, tileSize: Double) -> RasterSource {
        var source = RasterSource(id: id)
            .tiles([url])
        source.tileSize = tileSize
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

private struct RasterConfiguration {
    let url: String
    let tileSize: Double
}

private enum BaseStyle: Hashable, Identifiable {
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

private extension SharedRasterOverlayDefinition {
    var sourceID: String { "\(id)-source" }
    var layerID: String { "\(id)-layer" }
}

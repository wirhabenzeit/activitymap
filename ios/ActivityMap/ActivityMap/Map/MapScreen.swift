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
    @State private var picker = RoutePicker()

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            MapReader { proxy in
                mapView(proxy: proxy)
            }

            mapControls
                .padding(.trailing, 16)
                // Leave the native Mapbox attribution button unobstructed.
                .padding(.bottom, 56)

            if let attribution {
                Text(attribution)
                    .font(.caption2)
                    .foregroundStyle(Color.primary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .modifier(MapChromeSurface())
                    .padding(.leading, 8)
                    .padding(.bottom, 42)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .bottomLeading) {
            selectionControls
                .padding(.leading, 16)
                .padding(.trailing, 80)
                .padding(.bottom, 100)
        }
        .sheet(isPresented: $picker.isPresented) {
            RoutePickerSheet(picker: picker, store: store)
        }
        .alert("Route selection", isPresented: Binding(
            get: { picker.errorMessage != nil },
            set: { if !$0 { picker.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { picker.errorMessage = nil }
        } message: {
            Text(picker.errorMessage ?? "")
        }
        .onChange(of: store.selection.visibleIDs) { _, _ in picker.reconcile(with: store) }
        .onChange(of: store.activeActivityID) { _, _ in picker.reconcile(with: store) }
        .onChange(of: picker.isAdding) { _, _ in picker.invalidateQuery() }
        .onChange(of: baseStyle) { _, _ in picker.invalidateQuery() }
        .onChange(of: activeOverlays) { _, _ in picker.invalidateQuery() }
        .onDisappear { picker.invalidateQuery() }
    }

    private func mapView(proxy: MapProxy) -> some View {
        Map(viewport: $viewport) {
            baseContent
            RouteLayers(data: store.routeGeometry.data, visibleIDs: store.selection.visibleIDs,
                        selectedIDs: store.selectedActivityIDs, activeID: store.activeActivityID)

            routeInteraction(proxy: proxy)
            TapInteraction { context in
                if let map = proxy.map { picker.pick(at: context.point, map: map, store: store) }
                return true
            }
        }
        .mapStyle(mapStyle)
        .gestureHandlers(MapGestureHandlers(onBegin: { gesture in
            if gesture != .singleTap { picker.invalidateQuery() }
        }))
        .onCameraChanged { _ in picker.invalidateQuery() }
        .ignoresSafeArea()
        .onChange(of: store.activitiesRevision, initial: true) { _, revision in
            picker.reconcile(with: store)
            store.routeGeometry.update(activities: store.activities, revision: revision)
        }
    }

    private func routeInteraction(proxy: MapProxy) -> TapInteraction {
        // Route hits take priority over external feature overlays. Photo
        // annotations consume their own taps before this layer interaction.
        TapInteraction(.layer(RouteSource.ordinaryLayerID), radius: RouteHitTesting.radius) { _, context in
            if let map = proxy.map { picker.pick(at: context.point, map: map, store: store) }
            return true
        }
    }

    @MapContentBuilder
    private var baseContent: some MapContent {
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

    }

    private var selectionControls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { selectionModeMenu; selectionSummary }
            VStack(alignment: .leading, spacing: 8) { selectionModeMenu; selectionSummary }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.primary)
    }

    private var selectionModeMenu: some View {
        Menu {
            Toggle("Add routes to selection", isOn: $picker.isAdding)
            if !store.selectedActivityIDs.isEmpty {
                Button("Clear selection", role: .destructive) { store.clearSelection() }
            }
        } label: {
            Label(picker.isAdding ? "Add" : "Select",
                  systemImage: picker.isAdding ? "plus.circle" : "cursorarrow.click")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
        }
        .accessibilityLabel("Map selection mode")
        .accessibilityValue(picker.isAdding ? "Add routes" : "Replace selection")
        .modifier(MapChromeSurface())
    }

    @ViewBuilder
    private var selectionSummary: some View {
        if !store.selectedActivityIDs.isEmpty {
            Button {
                picker.reviewSelection(store: store)
            } label: {
                VStack(spacing: 2) {
                    Text("\(store.selectedActivityIDs.count) selected")
                        .font(.subheadline.weight(.semibold))
                    if store.hiddenSelectedCount > 0 {
                        Text("\(store.hiddenSelectedCount) hidden by filters").font(.caption2)
                    }
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
            }
            .disabled(store.selection.visibleSelectedIDs.isEmpty)
            .accessibilityHint("Review visible selected routes; \(store.hiddenSelectedCount) hidden by filters")
            .modifier(MapChromeSurface())
        }
    }

    private var mapControls: some View {
        VStack(spacing: 0) {
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
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("Map layers")

            Divider().frame(width: 24)

            Button {
                isPitched.toggle()
                updateViewport()
            } label: {
                Image(systemName: "view.3d")
                    .foregroundStyle(isPitched ? Color.blue : Color.primary)
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("3D map")
            .accessibilityValue(isPitched ? "On" : "Off")

            Divider().frame(width: 24)

            Button {
                isPitched = false
                updateViewport()
            } label: {
                Image(systemName: "scope")
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("Reset map view")
        }
        .buttonStyle(.plain)
        .font(.body.weight(.semibold))
        .foregroundStyle(Color.primary)
        .padding(4)
        .modifier(MapChromeSurface())
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

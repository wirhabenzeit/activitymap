import MapboxMaps
import SwiftUI
import UIKit

struct MapScreen: View {
    @Bindable var store: ActivityStore
    private let topOcclusion: CGFloat

    @Bindable private var context: MapContext
    @Environment(\.colorScheme) private var colorScheme
    @State private var viewport: Viewport
    @State private var acceptsCameraEvents = false

    init(store: ActivityStore, topOcclusion: CGFloat = 0) {
        self.topOcclusion = topOcclusion
        self.store = store
        self.context = store.mapContext
        _viewport = State(initialValue: store.mapContext.camera.viewport)
    }

    @State private var picker = RoutePicker()
    @ScaledMetric(relativeTo: .caption2) private var attributionFontSize: CGFloat = 11

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            GeometryReader { geometry in
                MapReader { proxy in
                    mapView(proxy: proxy, geometry: geometry)
                }
                if let attribution {
                    let layout = attributionLayout(in: geometry)
                    Text(attribution)
                        .font(.system(size: attributionFontSize))
                        .foregroundStyle(Color.primary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .frame(width: layout.creditSize.width, height: layout.creditSize.height)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 4))
                        .position(layout.creditCenter)
                        .allowsHitTesting(false)
                }
            }

            mapControls
                .padding(.trailing, 16)
                // Align with the selection menu above the bottom safe area.
                .padding(.bottom, 32)

        }
        .overlay(alignment: .bottomLeading) {
            selectionMenu
                .padding(.leading, 16)
                .padding(.trailing, 132)
                .padding(.bottom, 32)
        }
        .sheet(isPresented: $picker.isPresented, onDismiss: { picker.sheetHeight = 0 }) {
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
        .onChange(of: store.selectedActivityIDs) { _, ids in
            if ids.isEmpty {
                picker.isAdding = false
                picker.isPresented = false
            }
        }
        .onChange(of: picker.isAdding) { _, _ in picker.invalidateQuery() }
        .onChange(of: context.baseStyle) { oldStyle, newStyle in
            if oldStyle.styleURL != newStyle.styleURL { acceptsCameraEvents = false }
            picker.invalidateQuery()
        }
        .onChange(of: context.activeOverlays) { _, _ in picker.invalidateQuery() }
        .onChange(of: context.scopeRevision) { _, _ in
            picker.isPresented = false
            picker.isAdding = false
            picker.sheetHeight = 0
            viewport = context.camera.viewport
        }
        .onDisappear {
            acceptsCameraEvents = false
            picker.invalidateQuery()
        }
    }

    private func mapView(proxy: MapProxy, geometry: GeometryProxy) -> some View {
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
        .ornamentOptions(attributionLayout(in: geometry).ornamentOptions)
        .gestureHandlers(MapGestureHandlers(onBegin: { gesture in
            if gesture != .singleTap { picker.invalidateQuery() }
        }))
        .onCameraChanged { event in
            picker.invalidateQuery()
            if acceptsCameraEvents, store.selectedTab == .map { context.record(event.cameraState) }
        }
        .onStyleLoaded { _ in
            viewport = context.camera.viewport
            acceptsCameraEvents = true
            applyNavigation(proxy: proxy, geometry: geometry)
        }
        .onMapIdle { _ in applyNavigation(proxy: proxy, geometry: geometry) }
        .ignoresSafeArea()
        .onChange(of: context.pendingRequest?.id) { _, _ in applyNavigation(proxy: proxy, geometry: geometry) }
        .onChange(of: picker.sheetHeight) { _, _ in applyNavigation(proxy: proxy, geometry: geometry) }
        .onChange(of: geometry.size) { _, _ in applyNavigation(proxy: proxy, geometry: geometry) }
        .onChange(of: store.activitiesRevision, initial: true) { _, revision in
            picker.reconcile(with: store)
            store.routeGeometry.update(activities: store.activities, revision: revision)
        }
    }

    private func applyNavigation(proxy: MapProxy, geometry: GeometryProxy) {
        guard acceptsCameraEvents, store.selectedTab == .map, let map = proxy.map else { return }
        let safeArea = geometry.safeAreaInsets
        // The map extends under navigation; retain its original occluded height
        // from BrowseContent, plus the fitter's 16-point breathing room.
        // Map ignores safe areas; camera fitting uses its full physical size.
        let size = CGSize(width: geometry.size.width + safeArea.leading + safeArea.trailing,
                          height: geometry.size.height + safeArea.bottom)
        guard let camera = MapNavigation.resolve(
            store: store, map: map, size: size,
            safeArea: UIEdgeInsets(top: safeArea.top, left: safeArea.leading,
                                  bottom: safeArea.bottom, right: safeArea.trailing),
            sheetHeight: picker.isPresented ? picker.sheetHeight : 0, topOcclusion: topOcclusion
        ) else { return }
        withViewportAnimation(.default(maxDuration: 0.5)) {
            viewport = .camera(center: camera.center, zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch)
        }
    }

    private func attributionLayout(in geometry: GeometryProxy) -> MapAttributionLayout {
        MapAttributionLayout(size: geometry.size, bottomInset: geometry.safeAreaInsets.bottom,
                             credit: attribution, fontSize: attributionFontSize)
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
        if let raster = context.baseStyle.rasterSource {
            rasterSource(
                id: "selected-raster-base",
                url: raster.url,
                tileSize: raster.tileSize,
                attribution: context.baseStyle.attribution
            )

            RasterLayer(id: "selected-raster-base-layer", source: "selected-raster-base")
        }

        ForEvery(SharedMapCatalog.rasterOverlays.filter(context.activeOverlays.contains)) { overlay in
            rasterSource(
                id: overlay.sourceID,
                url: overlay.url,
                tileSize: overlay.tileSize,
                attribution: overlay.attribution
            )

            RasterLayer(id: overlay.layerID, source: overlay.sourceID)
                .rasterOpacity(overlay.opacity)
        }

    }

    @ViewBuilder
    private var selectionMenu: some View {
        if !store.selectedActivityIDs.isEmpty {
            Menu {
                Button {
                    picker.reviewSelection(store: store)
                } label: {
                    Label("Show selected routes", systemImage: "list.bullet")
                }
                .disabled(store.selection.visibleSelectedIDs.isEmpty)
                Toggle("Add routes to selection", isOn: $picker.isAdding)
                Button("Clear selection", role: .destructive) { store.clearSelection() }
            } label: {
                HStack(spacing: 6) {
                    if picker.isAdding { Image(systemName: "plus.circle") }
                    VStack(spacing: 2) {
                        Text("\(store.selectedActivityIDs.count) selected")
                            .font(.subheadline.weight(.semibold))
                        if store.hiddenSelectedCount > 0 {
                            Text("\(store.hiddenSelectedCount) hidden by filters").font(.caption2)
                        }
                    }
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.primary)
            .accessibilityLabel("\(store.selectedActivityIDs.count) selected, \(store.hiddenSelectedCount) hidden by filters")
            .accessibilityValue(picker.isAdding ? "Add routes enabled" : "Replace selection")
            .accessibilityHint("Show selected routes, add routes or clear selection")
            .modifier(MapChromeSurface())
        }
    }

    private var mapControls: some View {
        VStack(spacing: 0) {
            Menu {
                Section("Base Map") {
                    Picker("Base Map", selection: $context.baseStyle) {
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
                            if context.activeOverlays.contains(overlay) {
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
                context.request(.pitch(context.isPitched ? 0 : 50))
            } label: {
                Image(systemName: "view.3d")
                    .foregroundStyle(context.isPitched ? Color.blue : Color.primary)
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("3D map")
            .accessibilityValue(context.isPitched ? "On" : "Off")

            Divider().frame(width: 24)

            Menu {
                Button("Fit selection", systemImage: "selection.pin.in.out") { context.request(.fitSelection) }
                    .disabled(!store.filteredActivities.contains {
                        store.selectedActivityIDs.contains($0.id) && !$0.coordinates.isEmpty
                    })
                Button("Fit filtered routes", systemImage: "map") { context.request(.fitFiltered) }
                    .disabled(!store.filteredActivities.contains { !$0.coordinates.isEmpty })
                Divider()
                Button("Reset bearing", systemImage: "location.north") { context.request(.resetBearing) }
                Button("Reset map view", systemImage: "arrow.counterclockwise") { context.request(.resetView) }
            } label: {
                Image(systemName: "scope")
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("Map camera")
        }
        .buttonStyle(.plain)
        .font(.body.weight(.semibold))
        .foregroundStyle(Color.primary)
        .padding(4)
        .modifier(MapChromeSurface())
    }

    private var mapStyle: MapStyle {
        if let styleURL = context.baseStyle.styleURL,
           let url = URL(string: styleURL),
           let styleURI = StyleURI(url: url) {
            return MapStyle(uri: styleURI)
        }

        return .standard(lightPreset: colorScheme == .dark ? .night : .day)
    }

    private var attribution: String? {
        var providers = context.activeOverlays.compactMap(\.attribution)

        if let baseAttribution = context.baseStyle.attribution {
            providers.append(baseAttribution)
        }

        let uniqueProviders = Array(Set(providers)).sorted()
        return uniqueProviders.isEmpty ? nil : uniqueProviders.joined(separator: "  •  ")
    }

    private func toggleOverlay(_ overlay: SharedRasterOverlayDefinition) {
        if context.activeOverlays.contains(overlay) {
            context.activeOverlays.remove(overlay)
        } else {
            context.activeOverlays.insert(overlay)
        }
    }

    private func rasterSource(id: String, url: String, tileSize: Double, attribution: String?) -> RasterSource {
        var source = RasterSource(id: id)
            .tiles([url])
        source.tileSize = tileSize
        source.attribution = attribution
        return source
    }


}

private extension SharedRasterOverlayDefinition {
    var sourceID: String { "\(id)-source" }
    var layerID: String { "\(id)-layer" }
}

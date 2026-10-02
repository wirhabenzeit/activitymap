import MapboxMaps
import SwiftUI
import UIKit

struct MapScreen: View {
    @Bindable var store: ActivityStore
    private let topOcclusion: CGFloat

    @Bindable private var context: MapContext
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.mapStyleOverride) private var mapStyleOverride
    @State private var viewport: Viewport
    @State private var acceptsCameraEvents = false

    init(store: ActivityStore, topOcclusion: CGFloat = 0, picker: RoutePicker? = nil) {
        _picker = State(initialValue: picker ?? RoutePicker())
        self.topOcclusion = topOcclusion
        self.store = store
        self.context = store.mapContext
        _viewport = State(initialValue: store.mapContext.camera.viewport)
    }

    @State private var picker: RoutePicker

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            GeometryReader { geometry in
                MapReader { proxy in
                    mapView(proxy: proxy, geometry: geometry)
                }
                let showingResults = picker.isPresented
                // Map chrome stays at its original bottom edge. Results cover
                // it naturally; resizing does not move controls or ornaments.
                mapControls(horizontal: true)
                    .position(MapResultsLayout.controlsCenter(size: geometry.size))
                    .accessibilityIdentifier("map-controls")
                // BrowseContent hides this whole map on the list tab. Keep the
                // results subtree mounted too, preserving its exact scroll offset.
                // Keep the native presenter mounted before selection changes,
                // so UIKit receives a normal false-to-true presentation event.
                MapResultsContainer(picker: picker, store: store, size: geometry.size,
                                        topInset: max(topOcclusion, geometry.safeAreaInsets.top),
                                        bottomInset: geometry.safeAreaInsets.bottom, largeText: typeSize.isAccessibilitySize)
                if !showingResults {
                    VStack {
                        Spacer()
                        HStack { selectionMenu; Spacer(minLength: 132) }
                            .padding(.horizontal, 16).padding(.bottom, 32)
                    }
                }
            }

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
            picker.reconcile(with: store)
            if ids.isEmpty {
                picker.isAdding = false
                picker.isPresented = false
            }
        }
        .onChange(of: store.selectedTab) { _, tab in
            if tab != .map {
                picker.invalidateQuery()
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
        // Fitted and restored camera padding already includes safe areas.
        .usesSafeAreaInsetsAsPadding(false)
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
            if !acceptsCameraEvents { viewport = context.camera.viewport }
            acceptsCameraEvents = true
            applyNavigation(proxy: proxy, geometry: geometry)
        }
        .onMapIdle { _ in
            // A local/cached style can finish before SwiftUI installs its
            // onStyleLoaded subscription. Recover readiness at the first idle
            // frame as well, or camera persistence and queued fits stay blocked.
            if !acceptsCameraEvents, proxy.map?.isStyleLoaded == true {
                viewport = context.camera.viewport
                acceptsCameraEvents = true
            }
            applyNavigation(proxy: proxy, geometry: geometry)
        }
        .ignoresSafeArea()
        .onChange(of: store.selectedTab) { _, tab in
            if tab == .map { applyNavigation(proxy: proxy, geometry: geometry) }
        }
        .onChange(of: context.pendingRequest?.id) { _, _ in applyNavigation(proxy: proxy, geometry: geometry) }
        .onChange(of: picker.detent) { _, _ in applyNavigation(proxy: proxy, geometry: geometry) }
        .onChange(of: picker.isPresented) { _, _ in applyNavigation(proxy: proxy, geometry: geometry) }
        .onChange(of: geometry.size) { _, _ in applyNavigation(proxy: proxy, geometry: geometry) }
        .onChange(of: store.activitiesRevision, initial: true) { _, revision in
            picker.reconcile(with: store)
            store.routeGeometry.update(activities: store.activities, revision: revision)
        }
    }

    private func applyNavigation(proxy: MapProxy, geometry: GeometryProxy) {
        guard store.selectedTab == .map, let map = proxy.map else { return }
        if !acceptsCameraEvents {
            // A cached style may already be ready before SwiftUI observes its
            // load/idle event. An explicit fit must not wait for another idle.
            guard context.pendingRequest != nil, map.isStyleLoaded else { return }
            acceptsCameraEvents = true
        }
        if case let .activity(id) = context.pendingRequest?.action,
           store.selection.visibleSelectedIDs.contains(id) {
            // Do not activate a different remaining result if filters/deletion
            // invalidate a queued Show on map target before the renderer is ready.
            picker.reconcile(with: store)
            picker.showDetail(id, store: store)
            picker.detent = .compact
        }
        if let action = context.pendingRequest?.action,
           action == .fitSelection || action == .fitFiltered {
            // Explicit fits leave enough map space for the route and chrome.
            picker.detent = .compact
        }
        let layout = MapResultsLayout.framing(size: geometry.size,
            topInset: max(topOcclusion, geometry.safeAreaInsets.top), bottomInset: geometry.safeAreaInsets.bottom,
            detent: picker.detent, largeText: typeSize.isAccessibilitySize)
        let showingResults = picker.isPresented
        let safeArea = geometry.safeAreaInsets
        // The map extends under navigation; retain its original occluded height
        // from BrowseContent, plus the fitter's 16-point breathing room.
        // Map ignores safe areas; camera fitting uses its full physical size.
        let size = CGSize(width: geometry.size.width + safeArea.leading + safeArea.trailing,
                          height: geometry.size.height + safeArea.bottom)
        let action = context.pendingRequest?.action
        guard let camera = MapNavigation.resolve(
            store: store, map: map, size: size,
            safeArea: UIEdgeInsets(top: safeArea.top, left: safeArea.leading,
                                  bottom: safeArea.bottom, right: safeArea.trailing),
            // Fit above the panel; background controls and credits add no occlusion.
            sheetHeight: showingResults && !layout.isSidePanel
                ? max(layout.bottomOcclusion, NativeMapResultsSizing.openingHeight(count: picker.candidateIDs.count, detail: picker.detailID != nil, height: geometry.size.height, largeText: typeSize.isAccessibilitySize) + safeArea.bottom) : 0, topOcclusion: topOcclusion,
            leadingOcclusion: showingResults && layout.isSidePanel ? layout.leadingOcclusion + safeArea.leading : 0
        ) else { return }
        let padding = camera.padding ?? context.camera.padding
        let target = Viewport.camera(center: camera.center, zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch)
            .padding(EdgeInsets(top: padding.top, leading: padding.left, bottom: padding.bottom, trailing: padding.right))
        switch action {
        case .activity, .fitSelection, .fitFiltered:
            // A fit can also change projection and panel layout. The SDK's
            // animated transition can cancel during those updates, leaving the
            // initial camera after the request has already been consumed.
            viewport = target
        default:
            withViewportAnimation(.default(maxDuration: 0.5)) { viewport = target }
        }
    }

    private func attributionLayout(in geometry: GeometryProxy) -> MapAttributionLayout {
        MapAttributionLayout(bottomInset: geometry.safeAreaInsets.bottom)
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
                    Label("Show selected activities", systemImage: "list.bullet")
                }
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
            .accessibilityHint("Show selected activities, add routes or clear selection")
            .modifier(MapChromeSurface())
        }
    }

    private func mapControls(horizontal: Bool) -> some View {
        let layout = horizontal ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
        return layout {
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
                BrowseIconLabel(systemImage: "square.3.layers.3d")
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("Map layers")

            Divider().frame(width: horizontal ? 1 : 24, height: horizontal ? 24 : 1)

            Button {
                context.request(.pitch(context.isPitched ? 0 : 50))
            } label: {
                BrowseIconLabel(systemImage: "view.3d", isSelected: context.isPitched)
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("3D map")
            .accessibilityValue(context.isPitched ? "On" : "Off")

            Divider().frame(width: horizontal ? 1 : 24, height: horizontal ? 24 : 1)

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
                BrowseIconLabel(systemImage: "scope")
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("Map camera")
        }
        .buttonStyle(.plain)
        .font(.body)
        .foregroundStyle(Color.primary)
        .padding(4)
        .modifier(MapChromeSurface())
    }

    private var mapStyle: MapStyle {
        if let mapStyleOverride { return mapStyleOverride }
        if let styleURL = context.baseStyle.styleURL,
           let url = URL(string: styleURL),
           let styleURI = StyleURI(url: url) {
            return MapStyle(uri: styleURI)
        }

        return .standard(lightPreset: colorScheme == .dark ? .night : .day)
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

// Inject a local style for rendered previews/tests through the same declarative
// path as the real map. Loading a style directly on the underlying MapView races
// SwiftUI's next update, which reapplies the declared (normally remote) style.
private struct MapStyleOverrideKey: EnvironmentKey {
    static let defaultValue: MapStyle? = nil
}

extension EnvironmentValues {
    var mapStyleOverride: MapStyle? {
        get { self[MapStyleOverrideKey.self] }
        set { self[MapStyleOverrideKey.self] = newValue }
    }
}

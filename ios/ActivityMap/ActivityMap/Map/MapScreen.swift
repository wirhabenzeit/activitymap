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
    @Environment(\.mapTerrainOverride) private var mapTerrainOverride
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var viewport: Viewport
    @State private var acceptsCameraEvents = false
    @State private var cameraTransitionID: UUID?
    /// A resolved fit that arrived while the map was updating its content.
    /// Valid only while its transition is still current.
    @State private var deferredTransition: (id: UUID, viewport: Viewport)?
    @State private var location = MapLocationController()
    @State private var terrain = MapTerrainState()
    @State private var compass: MapCompassState
    @State private var positions = MapPositionState()

    init(store: ActivityStore, topOcclusion: CGFloat = 0, picker: RoutePicker? = nil) {
        _picker = State(initialValue: picker ?? RoutePicker())
        self.topOcclusion = topOcclusion
        self.store = store
        self.context = store.mapContext
        _viewport = State(initialValue: store.mapContext.camera.viewport)
        _compass = State(initialValue: MapCompassState(bearing: store.mapContext.camera.bearing))
    }

    @Namespace private var photoTransition
    @State private var photoGroups: [MapPhotoLayout.Group] = []
    @State private var photoModels: [String: Photo] = [:]
    @State private var photoMetadataRevision: Int?
    @State private var photoVisibleIDs: Set<Int> = []
    @State private var photoThumbnails = false
    @State private var photoPresentation: MapPhotoPresentation?
    @State private var pendingPhotoActivity: Int?
    @State private var lastPhotoAction: (id: String, time: Date)?
    @State private var picker: RoutePicker

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            GeometryReader { geometry in
                MapReader { proxy in
                    mapView(proxy: proxy, geometry: geometry)
                }
                // Keep the map tools anchored below navigation as results resize.
                mapControls
                    .position(MapResultsLayout.controlsCenter(size: geometry.size,
                        topInset: max(topOcclusion, geometry.safeAreaInsets.top)))
                    .accessibilityIdentifier("map-controls")
                if let center = MapCompassLayout.center(size: geometry.size,
                    topInset: max(topOcclusion, geometry.safeAreaInsets.top),
                    bottomInset: geometry.safeAreaInsets.bottom, showingResults: picker.isPresented,
                    detent: picker.detent, largeText: typeSize.isAccessibilitySize) {
                    MapCompassButton(state: compass) { context.request(.resetBearing) }
                        .position(center)
                }
                // BrowseContent hides this whole map on the list tab. Keep the
                // results subtree mounted too, preserving its exact scroll offset.
                // Keep the native presenter mounted before selection changes,
                // so UIKit receives a normal false-to-true presentation event.
                MapResultsContainer(picker: picker, store: store, size: geometry.size,
                                        topInset: max(topOcclusion, geometry.safeAreaInsets.top),
                                        bottomInset: geometry.safeAreaInsets.bottom, largeText: typeSize.isAccessibilitySize)
                    .environment(\.stackedMapPhotoViewer, StackedMapPhotoViewer(
                        request: $photoPresentation, content: photoViewer, onDismiss: finishPhotoPresentation))
                // A wide map without selected routes has no results panel.
                // Keep its viewer presenter mounted on a separate map anchor.
                Color.clear.allowsHitTesting(false)
                    .fullScreenCover(item: Binding(
                        get: {
                            let sidePanel = MapResultsLayout(size: geometry.size,
                                topInset: max(topOcclusion, geometry.safeAreaInsets.top),
                                bottomInset: geometry.safeAreaInsets.bottom, detent: picker.detent,
                                largeText: typeSize.isAccessibilitySize).isSidePanel
                            return sidePanel || !picker.isPresented ? photoPresentation : nil
                        }, set: { photoPresentation = $0 }
                    ), onDismiss: finishPhotoPresentation) { selected in
                        photoViewer(selected)
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
        .alert("Locate me", isPresented: Binding(
            get: { location.errorMessage != nil },
            set: { if !$0 { location.errorMessage = nil } }
        )) {
            if location.offersSettings {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            }
            Button("OK", role: .cancel) { location.errorMessage = nil }
        } message: { Text(location.errorMessage ?? "") }
        .alert("3D terrain", isPresented: Binding(
            get: { terrain.errorMessage != nil },
            set: { if !$0 { terrain.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { terrain.errorMessage = nil }
        } message: { Text(terrain.errorMessage ?? "") }
        .onChange(of: store.visibleActivityIDs) { _, _ in picker.reconcile(with: store) }
        .onChange(of: store.activeActivityID) { _, _ in picker.reconcile(with: store) }
        .onChange(of: store.selectedActivityIDs) { _, ids in
            picker.reconcile(with: store)
            if ids.isEmpty {
                picker.isPresented = false
            }
        }
        .onChange(of: store.selectedTab) { _, tab in
            if tab != .map {
                cameraTransitionID = nil
                location.cancel()
                context.cancelLocationRequest()
                picker.invalidateQuery()
            }
        }
        .onChange(of: store.isCombining) { _, _ in picker.invalidateQuery() }
        .onChange(of: store.onlySelected) { _, _ in picker.invalidateQuery() }
        .onChange(of: context.baseStyle) { oldStyle, newStyle in
            cameraTransitionID = nil
            if oldStyle.styleURL != newStyle.styleURL { acceptsCameraEvents = false }
            configureTerrain(restart: true)
            picker.invalidateQuery()
        }
        .onChange(of: context.activeOverlays) { _, _ in picker.invalidateQuery() }
        .onChange(of: context.scopeRevision) { _, _ in
            cameraTransitionID = nil
            picker.isPresented = false
            photoGroups = []
            photoModels = [:]
            photoMetadataRevision = nil
            photoPresentation = nil
            pendingPhotoActivity = nil
            lastPhotoAction = nil
            viewport = context.camera.viewport
            location.cancel()
            compass.record(context.camera.bearing)
            terrain.configure(enabled: false, supported: terrainConfiguration != nil)
        }
        .onChange(of: context.isPitched) { _, _ in
            configureTerrain()
        }
        .onChange(of: scenePhase) { _, phase in
            // A permission prompt can make the scene inactive. Only leaving
            // the foreground cancels the request that caused that prompt.
            if phase == .background {
                location.cancel()
                context.cancelLocationRequest()
            }
        }
        .onAppear {
            compass.record(context.camera.bearing)
            configureTerrain()
        }
        .task(id: terrain.includesTerrain ? terrain.sourceID : nil) {
            guard terrain.status == .loading else { return }
            let sourceID = terrain.sourceID
            do { try await Task.sleep(for: .seconds(20)) } catch { return }
            if terrain.status == .loading { terrain.failed(sourceID: sourceID) }
        }
        .onDisappear {
            cameraTransitionID = nil
            location.cancel()
            context.cancelLocationRequest()
            acceptsCameraEvents = false
            picker.invalidateQuery()
        }
    }

    private func mapView(proxy: MapProxy, geometry: GeometryProxy) -> some View {
        Map(viewport: $viewport) {
            baseContent
            if terrain.includesTerrain, let configuration = terrainConfiguration {
                MapTerrainContent(configuration: configuration, sourceID: terrain.sourceID)
            }
            RouteLayers(data: store.routeGeometry.data, visibleIDs: store.visibleActivityIDs,
                        selectedIDs: store.selectedActivityIDs, activeID: store.activeActivityID)

            if context.showPhotos {
                ForEvery(photoGroups) { group in
                    if let photo = photoModels[group.id], let coordinate = photo.location,
                       Int(photo.activityID).map(store.visibleActivityIDs.contains) == true {
                        MapViewAnnotation(coordinate: coordinate) {
                            MapPhotoMarker(store: store, photo: photo, count: group.photoIDs.count,
                                thumbnails: photoThumbnails) { openPhotoGroup(group) }
                                .matchedTransitionSource(id: photo.id, in: photoTransition)
                        }
                        .allowOverlap(true)
                    }
                }
            }

            routeInteraction(proxy: proxy)
            TapInteraction { context in
                if let map = proxy.map, !handlePhotoTap(at: context.point, map: map) {
                    picker.pick(at: context.point, map: map, store: store)
                }
                return true
            }
        }
        // Fitted and restored camera padding already includes safe areas.
        .usesSafeAreaInsetsAsPadding(false)
        .mapStyle(mapStyle)
        .ornamentOptions(attributionLayout(in: geometry).ornamentOptions)
        .gestureHandlers(MapGestureHandlers(onBegin: { gesture in
            if gesture != .singleTap {
                location.cancel()
                context.cancelLocationRequest()
                picker.invalidateQuery()
            }
        }))
        .onCameraChanged { event in
            picker.invalidateQuery()
            if acceptsCameraEvents, store.selectedTab == .map {
                context.record(event.cameraState)
                compass.record(event.cameraState.bearing)
            }
        }
        .onStyleLoaded { _ in
            configureTerrain(restart: true)
            if !acceptsCameraEvents { viewport = context.camera.viewport }
            acceptsCameraEvents = true
            refreshPhotos(proxy: proxy, geometry: geometry)
            scheduleNavigation(proxy: proxy)
            clearInactiveTerrain(proxy: proxy)
        }
        .onRenderFrameFinished { _ in
            refreshPositions(proxy: proxy)
            // The shell can replace a native bar when returning from List.
            // Mapbox's fitter must see its resized viewport, not the previous
            // tab's bounds. Keep the request until that layout has rendered.
            applyNavigation(proxy: proxy, geometry: geometry)
        }
        .onMapIdle { _ in
            refreshPhotos(proxy: proxy, geometry: geometry)
            // A local/cached style can finish before SwiftUI installs its
            // onStyleLoaded subscription. Recover readiness at the first idle
            // frame as well, or camera persistence and queued fits stay blocked.
            if !acceptsCameraEvents, proxy.map?.isStyleLoaded == true {
                viewport = context.camera.viewport
                acceptsCameraEvents = true
            }
            if let deferred = deferredTransition {
                deferredTransition = nil
                if deferred.id == cameraTransitionID, store.selectedTab == .map {
                    withViewportAnimation(.easeOut(duration: 0.5)) { viewport = deferred.viewport }
                }
            }
            clearInactiveTerrain(proxy: proxy)
            if terrain.status == .loading, let map = proxy.map,
               map.sourceExists(withId: terrain.sourceID),
               map.terrainProperty("source").value as? String == terrain.sourceID {
                terrain.loaded(sourceID: terrain.sourceID)
            }
        }
        .onSourceDataLoaded { event in
            if event.type == .tile, event.loaded == true { terrain.loaded(sourceID: event.sourceId) }
        }
        .onMapLoadingError { error in
            if error.sourceId == terrain.sourceID || error.type == .style {
                terrain.failed(sourceID: terrain.sourceID)
            }
        }
        .overlay { MapPositionOverlay(state: positions) }
        .ignoresSafeArea()
        .onChange(of: store.selectedTab) { _, tab in
            if tab == .map { scheduleNavigation(proxy: proxy) }
            refreshPositions(proxy: proxy)
        }
        .onChange(of: context.pendingRequest?.id, initial: true) { _, _ in
            location.cancel()
            scheduleNavigation(proxy: proxy)
        }
        .onChange(of: terrain.includesTerrain) { _, enabled in
            if !enabled { clearInactiveTerrain(proxy: proxy) }
        }
        .onChange(of: picker.detent) { _, _ in scheduleNavigation(proxy: proxy) }
        .onChange(of: picker.isPresented) { _, _ in
            scheduleNavigation(proxy: proxy)
            refreshPositions(proxy: proxy)
        }
        .onChange(of: context.locatedPosition.map { [$0.latitude, $0.longitude] }) { _, _ in refreshPositions(proxy: proxy) }
        .onChange(of: store.elevationCursor) { _, _ in refreshPositions(proxy: proxy) }
        .onChange(of: picker.detailID) { _, _ in refreshPositions(proxy: proxy) }
        .onChange(of: store.activeActivityID) { _, _ in refreshPositions(proxy: proxy) }
        .onChange(of: geometry.size) { _, _ in
            scheduleNavigation(proxy: proxy)
            refreshPhotos(proxy: proxy, geometry: geometry)
        }
        .onChange(of: context.showPhotos, initial: true) { _, _ in
            refreshPhotos(proxy: proxy, geometry: geometry)
            if !context.showPhotos { photoPresentation = nil }
        }
        .onChange(of: store.photosRevision) { _, _ in refreshPhotos(proxy: proxy, geometry: geometry) }
        .onChange(of: store.visibleActivityIDs) { _, _ in refreshPhotos(proxy: proxy, geometry: geometry) }
        .onChange(of: store.activitiesRevision, initial: true) { _, revision in
            picker.reconcile(with: store)
            store.routeGeometry.update(activities: store.activities, revision: revision)
        }
    }

    private func refreshPositions(proxy: MapProxy) {
        guard let map = proxy.map else { return }
        positions.update(map: map, located: context.locatedPosition,
            route: picker.isPresented && picker.detailID == store.activeActivityID ? store.elevationCoordinate : nil)
    }

    private func refreshPhotos(proxy: MapProxy, geometry: GeometryProxy) {
        guard context.showPhotos, let map = proxy.map, map.isStyleLoaded else {
            photoGroups = []
            if !photoModels.isEmpty { photoModels = [:] }
            photoMetadataRevision = nil
            return
        }
        let eligible = store.photos.filter {
            Int($0.activityID).map(store.visibleActivityIDs.contains) == true && MapPhotoLayout.validLocation($0.location)
        }
        if photoMetadataRevision != store.photosRevision || photoVisibleIDs != store.visibleActivityIDs {
            photoModels = Dictionary(eligible.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            photoMetadataRevision = store.photosRevision
            photoVisibleIDs = store.visibleActivityIDs
        }
        let coordinates = eligible.compactMap(\.location)
        let projected = map.points(for: coordinates)
        let points = zip(eligible, projected).map { photo, point in
            MapPhotoLayout.Point(id: photo.id, x: point.x, y: point.y)
        }
        let insets = geometry.safeAreaInsets
        let size = CGSize(width: geometry.size.width + insets.leading + insets.trailing,
                          height: geometry.size.height + insets.bottom)
        let groups = MapPhotoLayout.groups(points, size: size, zoom: map.cameraState.zoom)
        if groups != photoGroups { photoGroups = groups }
        let thumbnails = map.cameraState.zoom >= MapPhotoLayout.thumbnailZoom
        if photoThumbnails != thumbnails { photoThumbnails = thumbnails }
    }

    private func handlePhotoTap(at point: CGPoint, map: MapboxMap) -> Bool {
        guard context.showPhotos else { return false }
        // Test the current projection during camera animation, rather than the
        // settled positions used for grouping. Photos take priority over routes.
        let half: CGFloat = 22
        for group in photoGroups {
            guard let photo = photoModels[group.id], let coordinate = photo.location else { continue }
            let anchor = map.point(for: coordinate)
            if abs(point.x - anchor.x) <= half && abs(point.y - anchor.y) <= half {
                openPhotoGroup(group)
                return true
            }
        }
        return false
    }

    private func openPhotoGroup(_ group: MapPhotoLayout.Group) {
        guard context.showPhotos, let photo = photoModels[group.id], let coordinate = photo.location,
              Int(photo.activityID).map(store.visibleActivityIDs.contains) == true else { return }
        // Mapbox and the annotation button may both receive the same touch.
        if let last = lastPhotoAction, last.id == group.id, Date().timeIntervalSince(last.time) < 0.4 { return }
        lastPhotoAction = (group.id, Date())
        if !photoThumbnails, group.photoIDs.count > 1 {
            withViewportAnimation(.easeOut(duration: 0.45)) {
                viewport = .camera(center: coordinate, zoom: max(context.camera.zoom + 2, MapPhotoLayout.thumbnailZoom),
                                   bearing: context.camera.bearing, pitch: context.camera.pitch)
                    .padding(EdgeInsets(top: context.camera.padding.top, leading: context.camera.padding.left,
                                        bottom: context.camera.padding.bottom, trailing: context.camera.padding.right))
            }
            return
        }
        guard let activityID = Int(photo.activityID) else { return }
        photoPresentation = MapPhotoPresentation(id: photo.id, activityID: activityID, nearbyPhotoIDs: Set(group.photoIDs))
    }

    private func photoViewer(_ selected: MapPhotoPresentation) -> AnyView {
        AnyView(PhotoViewer(store: store, activityID: selected.activityID,
                            initialPhotoID: selected.id, transitionNamespace: photoTransition,
                            transitionSourceID: selected.id, nearbyPhotoIDs: selected.nearbyPhotoIDs,
                            requiresVisibleActivity: true, onViewActivity: { pendingPhotoActivity = $0 }))
    }

    private func finishPhotoPresentation() {
        guard let id = pendingPhotoActivity else { return }
        pendingPhotoActivity = nil
        guard store.visibleActivityIDs.contains(id) else { return }
        store.inspect(id)
        store.selectedTab = .list
    }

    private func scheduleNavigation(proxy: MapProxy) {
        guard store.selectedTab == .map, context.pendingRequest != nil else { return }
        if case let .activity(id) = context.pendingRequest?.action,
           store.visibleSelectedActivityIDs.contains(id) {
            // Do not activate a different remaining result if filters/deletion
            // invalidate a queued Show on map target before the renderer is ready.
            picker.reconcile(with: store)
            picker.showDetail(id, store: store)
            picker.detent = .medium
        }
        // Even a fit of an unchanged selection needs a frame; there may be no
        // style or source update to trigger one on an already idle map.
        proxy.map?.triggerRepaint()
    }

    private func applyNavigation(proxy: MapProxy, geometry: GeometryProxy) {
        guard store.selectedTab == .map, context.pendingRequest != nil,
              let map = proxy.map, map.isStyleLoaded else { return }
        acceptsCameraEvents = true
        let layout = MapResultsLayout(size: geometry.size,
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
                ? (picker.detent == .medium
                    ? NativeMapResultsSizing.openingHeight(height: geometry.size.height, largeText: typeSize.isAccessibilitySize,
                        topInset: max(topOcclusion, safeArea.top)) + safeArea.bottom
                    : layout.bottomOcclusion) : 0, topOcclusion: topOcclusion,
            trailingOcclusion: showingResults && layout.isSidePanel ? layout.trailingOcclusion + safeArea.trailing : 0
        ) else { return }
        let padding = camera.padding ?? context.camera.padding
        let target = Viewport.camera(center: camera.center, zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch)
            .padding(EdgeInsets(top: padding.top, leading: padding.left, bottom: padding.bottom, trailing: padding.right))
        let transitionID = UUID()
        cameraTransitionID = transitionID
        switch action {
        case .activity, .fitActivity, .fitSelection, .fitFiltered:
            // Commit navigation/results layout first. Updating the viewport
            // inside that same SwiftUI update loses its animation transaction.
            // Ease the fixed camera and final panel padding together afterwards.
            DispatchQueue.main.async {
                guard cameraTransitionID == transitionID, store.selectedTab == .map else { return }
                // The request is already consumed. Returning to Map can still be
                // adding the newly active route, and a camera move started then
                // is interrupted, so finish it at the next idle frame instead.
                guard map.isStyleLoaded else {
                    deferredTransition = (transitionID, target)
                    return
                }
                withViewportAnimation(.easeOut(duration: 0.5)) { viewport = target }
            }
        default:
            withViewportAnimation(.default(maxDuration: 0.5)) { viewport = target }
        }
    }

    private func attributionLayout(in geometry: GeometryProxy) -> MapAttributionLayout {
        MapAttributionLayout(bottomInset: geometry.safeAreaInsets.bottom)
    }

    private func clearInactiveTerrain(proxy: MapProxy) {
        guard !terrain.includesTerrain, let map = proxy.map, map.isStyleLoaded else { return }
        // Unmounting declarative Terrain restores the style's original value.
        // Custom catalogue styles can already contain terrain, so explicitly
        // flatten that too when 2D is chosen or our elevation request fails.
        let source: StylePropertyValue = map.terrainProperty("source")
        if let id = source.value as? String, !id.isEmpty { map.removeTerrain() }
    }

    private func routeInteraction(proxy: MapProxy) -> TapInteraction {
        // Route hits take priority over external feature overlays. Photo
        // annotations consume their own taps before this layer interaction.
        TapInteraction(.layer(RouteSource.ordinaryLayerID), radius: RouteHitTesting.radius) { _, context in
            if let map = proxy.map, !handlePhotoTap(at: context.point, map: map) {
                picker.pick(at: context.point, map: map, store: store)
            }
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

    private var mapControls: some View {
        VStack(spacing: 0) {
            Menu {
                Section("Activity photos") {
                    Button {
                        context.showPhotos.toggle()
                    } label: {
                        Label("Show photos on map", systemImage: context.showPhotos ? "checkmark" : "photo")
                    }
                    .accessibilityValue(context.showPhotos ? "On" : "Off")
                    if context.showPhotos, !store.photos.contains(where: {
                        Int($0.activityID).map(store.visibleActivityIDs.contains) == true && MapPhotoLayout.validLocation($0.location)
                    }) {
                        Text("No located photos in the current filter")
                    }
                }
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

            Divider().frame(width: 24, height: 1)

            Button {
                if context.isPitched {
                    context.request(.pitch(0))
                } else if terrainConfiguration != nil {
                    context.request(.pitch(50))
                } else {
                    terrain.configure(enabled: true, supported: false)
                }
            } label: {
                ZStack {
                    BrowseIconLabel(systemImage: "view.3d", isSelected: terrain.status == .ready)
                        .opacity(terrain.status == .loading ? 0 : 1)
                    if terrain.status == .loading { ProgressView().controlSize(.small) }
                }.frame(width: 44, height: 48)
            }
            .accessibilityLabel("3D map")
            .accessibilityValue(terrain.accessibilityValue)

            Divider().frame(width: 24, height: 1)

            Button {
                location.locate { coordinate in
                    context.request(.locate(latitude: coordinate.latitude, longitude: coordinate.longitude))
                }
            } label: {
                ZStack {
                    BrowseIconLabel(systemImage: "location.fill").opacity(location.isRequesting ? 0 : 1)
                    if location.isRequesting { ProgressView().controlSize(.small) }
                }.frame(width: 44, height: 48)
            }
            .disabled(location.isRequesting)
            .accessibilityLabel("Locate me")
            .accessibilityValue(location.isRequesting ? "Finding your location" : "")
            .accessibilityIdentifier("map-locate-me")
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

    private var terrainConfiguration: MapTerrainConfiguration? {
        if let mapTerrainOverride { return mapTerrainOverride }
        if mapStyleOverride != nil { return nil }
        return context.baseStyle.terrainConfiguration
    }

    private func configureTerrain(restart: Bool = false) {
        let usesTerrain = mapStyleOverride == nil || mapTerrainOverride != nil
        terrain.configure(enabled: usesTerrain && context.isPitched,
                          supported: terrainConfiguration != nil, restart: restart)
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

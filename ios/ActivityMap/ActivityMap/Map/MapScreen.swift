import MapLibre
import SwiftUI
import UIKit

struct MapScreen: View {
    @Bindable var store: ActivityStore
    private let topOcclusion: CGFloat

    @Bindable private var context: MapContext
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.mapStyleOverride) private var mapStyleOverride
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var placesOwner = UUID()
    @State private var proxy = MapProxy()
    @State private var cameraTransitionID: UUID?
    /// A resolved fit that arrived while the map was updating its content.
    /// Valid only while its transition is still current.
    @State private var location = MapLocationController()
    @State private var positions = MapPositionState()

    init(store: ActivityStore, topOcclusion: CGFloat = 0, picker: RoutePicker? = nil) {
        _picker = State(initialValue: picker ?? RoutePicker())
        self.topOcclusion = topOcclusion
        self.store = store
        self.context = store.mapContext
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
    @State private var resultsGeometry: MapResultsPresentationGeometry?
    @State private var placeGroups: [MapPlaceLayout.Group] = []
    @State private var placeModels: [String: DisplayMatchedPlace] = [:]
    @State private var openPlaceGroupID: String?
    @State private var lastPlaceAction: (id: String, time: Date)?

    var body: some View {
        #if DEBUG
        let _ = PerfProbe.count("MapScreen")
        #endif
        // Observe the geometry snapshot in this body, before GeometryReader's
        // escaping closure, so its first publication updates native sources.
        let routes = RouteLayers(data: store.routeGeometry.data, visibleIDs: store.visibleActivityIDs,
            selectedIDs: store.selectedActivityIDs, activeID: store.activeActivityID)
        ZStack(alignment: .bottomTrailing) {
            GeometryReader { geometry in
                mapView(proxy: proxy, geometry: geometry, routes: routes)
                // Keep the map tools anchored below navigation as results resize.
                mapControls
                    .position(MapResultsLayout.controlsCenter(size: geometry.size,
                        topInset: max(topOcclusion, geometry.safeAreaInsets.top)))
                    .accessibilityIdentifier("map-controls")
                // BrowseContent hides this whole map on the list tab. Keep the
                // results subtree mounted too, preserving its exact scroll offset.
                // Keep the native presenter mounted before selection changes,
                // so UIKit receives a normal false-to-true presentation event.
                MapResultsContainer(picker: picker, store: store, size: geometry.size,
                                        topInset: max(topOcclusion, geometry.safeAreaInsets.top),
                                        bottomInset: geometry.safeAreaInsets.bottom, largeText: typeSize.isAccessibilitySize,
                                        geometryChanged: { resultsGeometry = $0 })
                    .environment(\.stackedMapPhotoViewer, StackedMapPhotoViewer(
                        request: $photoPresentation, content: photoViewer, onDismiss: finishPhotoPresentation))
                // Only a custom panel (or no results) needs the map anchor.
                // A retained native sheet presents photos in every orientation.
                Color.clear.allowsHitTesting(false)
                    .fullScreenCover(item: Binding(
                        get: {
                            let layout = MapResultsLayout(size: geometry.size,
                                topInset: max(topOcclusion, geometry.safeAreaInsets.top),
                                bottomInset: geometry.safeAreaInsets.bottom, detent: picker.detent,
                                largeText: typeSize.isAccessibilitySize)
                            return !layout.usesNativePresentation || !picker.isPresented ? photoPresentation : nil
                        }, set: { photoPresentation = $0 }
                    ), onDismiss: finishPhotoPresentation) { selected in
                        photoViewer(selected)
                    }
            }

        }
        // Editors and search sheets own keyboard avoidance. Resizing the map
        // behind them can change results detents or replace the iOS 26 host.
        .ignoresSafeArea(.keyboard)
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
        .onChange(of: store.visibleActivityIDs) { _, _ in picker.reconcile(with: store) }
        .onChange(of: store.activeActivityID) { _, _ in
            picker.reconcile(with: store)
        }
        .onChange(of: store.selectedActivityIDs) { _, ids in
            picker.reconcile(with: store)
            if ids.isEmpty {
                picker.isPresented = false
                store.activityPlaces?.focus = nil
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
        .onChange(of: context.baseStyle) { _, _ in
            cameraTransitionID = nil
            picker.invalidateQuery()
        }
        .onChange(of: context.activeOverlays) { _, _ in picker.invalidateQuery() }
        .onChange(of: context.scopeRevision) { _, _ in
            cameraTransitionID = nil
            picker.isPresented = false
            resultsGeometry = nil
            photoGroups = []
            photoModels = [:]
            photoMetadataRevision = nil
            photoPresentation = nil
            pendingPhotoActivity = nil
            lastPhotoAction = nil
            placeGroups = []; placeModels = [:]; openPlaceGroupID = nil; lastPlaceAction = nil
            proxy.map?.move(to: context.camera, duration: 0)
            location.cancel()
        }
        .onChange(of: scenePhase) { _, phase in
            // A permission prompt can make the scene inactive. Only leaving
            // the foreground cancels the request that caused that prompt.
            if phase == .background {
                context.saveCamera?()
                location.cancel()
                context.cancelLocationRequest()
            }
        }
        .task(id: PlacesDemand(ids: store.visibleSelectedActivityIDs, overview: context.showPlaces ? store.visibleActivityIDs : [], priority: store.activeActivityID, session: store.activityPlaces?.sessionRevision, visible: store.selectedTab == .map)) {
            guard let loader = store.activityPlaces else { return }
            loader.demand(store.selectedTab == .map ? Set(store.visibleSelectedActivityIDs.map(String.init)) : [], owner: placesOwner,
                priority: store.activeActivityID.map(String.init), cachedOnly: store.selectedTab == .map && context.showPlaces ? Set(store.visibleActivityIDs.map(String.init)) : [])
            if let focus = loader.focus, !store.mapPlacesActivityIDs.contains(Int(focus.activityID) ?? -1) { loader.focus = nil }
        }
        .onDisappear { store.activityPlaces?.release(placesOwner) }
        .onDisappear {
            cameraTransitionID = nil
            location.cancel()
            context.cancelLocationRequest()
            picker.invalidateQuery()
        }
    }

    private func mapView(proxy: MapProxy, geometry: GeometryProxy, routes: RouteLayers) -> some View {
        #if DEBUG
        PerfProbe.count("MapScreen.map")
        #endif
        let places = renderedPlaces
        let overlays = context.activeOverlays
        let pitched = context.isPitched
        return MapLibreView(proxy: proxy, initialCamera: context.camera, style: mapStyle,
            bottomInset: geometry.safeAreaInsets.bottom,
            compassCenter: MapCompassLayout.center(size: geometry.size,
                topInset: max(topOcclusion, geometry.safeAreaInsets.top), bottomInset: geometry.safeAreaInsets.bottom,
                showingResults: picker.isPresented, detent: picker.detent, largeText: typeSize.isAccessibilitySize,
                resultsFrame: resultsFrame(in: geometry)),
            sync: { style in
                MapLayerSync.sync(style: style, base: context.baseStyle, overlays: overlays,
                    routes: routes, places: places, showPlaceLabels: context.showPlaces, pitched: pitched)
            }, styleLoaded: {
                refreshPhotos(proxy: proxy, geometry: geometry)
                refreshPlaces(proxy: proxy, geometry: geometry)
                scheduleNavigation(proxy: proxy)
            }, cameraMoved: { camera in
                picker.invalidateQuery()
                if proxy.map?.isStyleLoaded == true, store.selectedTab == .map {
                    context.record(camera)
                }
            }, idle: {
                if proxy.map?.isStyleLoaded == true { context.saveCamera?() }
                refreshPhotos(proxy: proxy, geometry: geometry)
                refreshPlaces(proxy: proxy, geometry: geometry)
            }, frameDrawn: {
                refreshPositions(proxy: proxy)
                applyNavigation(proxy: proxy, geometry: geometry)
            }, gestureStarted: {
                cameraTransitionID = nil
                location.cancel()
                context.cancelLocationRequest()
                picker.invalidateQuery()
            }, tap: { point in
                context.highlightedPlaceID = nil
                if let map = proxy.map, !handlePlaceTap(at: point, map: map) && !handlePhotoTap(at: point, map: map) {
                    picker.pick(at: point, map: map, store: store)
                }
            })
        .onChange(of: store.activityPlaces?.focus) { _, focus in
            refreshPlaces(proxy: proxy, geometry: geometry)
            guard let focus, focus.revealOnMap, let place = store.activityPlaces?.result(focus.activityID)?.places.first(where: { $0.id == focus.placeID }),
                  store.mapPlacesActivityIDs.contains(Int(focus.activityID) ?? -1), let map = proxy.map else { return }
            let coordinate = CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
            let visible = CGRect(origin: .zero, size: geometry.size).inset(by: context.camera.padding).insetBy(dx: 60, dy: 90)
            if !visible.contains(map.point(for: coordinate)) {
                var camera = context.camera; camera.center = coordinate
                map.move(to: camera, duration: 0.35)
            }
        }
        .overlay { annotationOverlay }
        .overlay { MapPositionOverlay(state: positions) }
        // Scrubbing moves the cursor per touch event. Observing it here, not
        // in this body, repositions the dot without rebuilding map content.
        .background { ElevationCursorObserver(store: store) { refreshPositions(proxy: proxy) } }
        .ignoresSafeArea()
        .onChange(of: store.selectedTab) { _, tab in
            if tab == .map { scheduleNavigation(proxy: proxy) }
            refreshPositions(proxy: proxy)
        }
        .onChange(of: context.pendingRequest?.id, initial: true) { _, _ in
            location.cancel()
            scheduleNavigation(proxy: proxy)
        }
        .onChange(of: picker.detent) { _, _ in scheduleNavigation(proxy: proxy) }
        .onChange(of: resultsGeometry) { _, _ in scheduleNavigation(proxy: proxy) }
        .onChange(of: picker.isPresented) { _, _ in
            scheduleNavigation(proxy: proxy)
            refreshPositions(proxy: proxy)
        }
        .onChange(of: context.locatedPosition.map { [$0.latitude, $0.longitude] }) { _, _ in refreshPositions(proxy: proxy) }
        .onChange(of: picker.detailID) { _, _ in refreshPositions(proxy: proxy) }
        .onChange(of: store.activeActivityID) { _, _ in refreshPositions(proxy: proxy) }
        .onChange(of: geometry.size) { _, _ in
            scheduleNavigation(proxy: proxy)
            refreshPhotos(proxy: proxy, geometry: geometry)
            refreshPlaces(proxy: proxy, geometry: geometry)
        }
        .onChange(of: context.showPhotos, initial: true) { _, _ in
            refreshPhotos(proxy: proxy, geometry: geometry)
            if !context.showPhotos { photoPresentation = nil }
        }
        .onChange(of: store.photosRevision) { _, _ in refreshPhotos(proxy: proxy, geometry: geometry) }
        .onChange(of: store.visibleActivityIDs) { _, _ in
            refreshPhotos(proxy: proxy, geometry: geometry)
            refreshPlaces(proxy: proxy, geometry: geometry)
        }
        .onChange(of: context.showPlaces, initial: true) { _, _ in
            openPlaceGroupID = nil
            refreshPlaces(proxy: proxy, geometry: geometry)
        }
        .onChange(of: store.activityPlaces?.results) { _, _ in refreshPlaces(proxy: proxy, geometry: geometry) }
        .onChange(of: store.activityPlaces?.overviewResults) { _, _ in refreshPlaces(proxy: proxy, geometry: geometry) }
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

    private var availablePlaces: [DisplayMatchedPlace] {
        guard let loader = store.activityPlaces else { return [] }
        // The place filter has its own pin.
        return DisplayMatchedPlace.aggregate(store.mapPlacesActivityIDs.compactMap { loader.result(String($0)) })
            .filter { $0.id != filteredPlace?.id }
    }

    private var filteredPlace: LibraryPlace? {
        (store.selectedPlace?.id ?? context.highlightedPlaceID).flatMap { store.placeLibrary.byID[$0] }
    }

    private var renderedPlaces: [DisplayMatchedPlace] {
        context.showPlaces
            ? placeGroups.filter { $0.pointIDs.count == 1 }.compactMap { placeModels[$0.id] }
            : availablePlaces
    }

    private func refreshPlaces(proxy: MapProxy, geometry: GeometryProxy) {
        guard context.showPlaces, let map = proxy.map, map.isStyleLoaded else {
            if !placeGroups.isEmpty { placeGroups = [] }
            if !placeModels.isEmpty { placeModels = [:] }
            return
        }
        let places = availablePlaces
        let models = Dictionary(uniqueKeysWithValues: places.map { ($0.id, $0) })
        if models != placeModels { placeModels = models }
        let coordinates = places.map { entry in
            CLLocationCoordinate2D(latitude: entry.place.latitude,
                longitude: entry.place.longitude + 360 * ((map.cameraState.center.longitude - entry.place.longitude) / 360).rounded())
        }
        let points = zip(places, map.points(for: coordinates)).map { entry, point in
            MapPlaceLayout.Point(id: entry.id, x: point.x, y: point.y)
        }
        let insets = geometry.safeAreaInsets
        let size = CGSize(width: geometry.size.width + insets.leading + insets.trailing,
                          height: geometry.size.height + insets.bottom)
        let groups = MapPlaceLayout.groups(points, size: size, focusedID: store.activityPlaces?.focus?.placeID)
        if groups != placeGroups { placeGroups = groups }
        if let openPlaceGroupID, !groups.contains(where: { $0.id == openPlaceGroupID && $0.pointIDs.count > 1 }) {
            self.openPlaceGroupID = nil
        }
    }

    private func openPlace(_ entry: DisplayMatchedPlace) {
        guard let loader = store.activityPlaces else { return }
        let ids = entry.activityIDs.filter { Int($0).map(store.mapPlacesActivityIDs.contains) == true }
        guard !ids.isEmpty else { return }
        let key = "place:\(entry.id)"
        if let last = lastPlaceAction, last.id == key, Date().timeIntervalSince(last.time) < 0.4 { return }
        lastPlaceAction = (key, Date())
        openPlaceGroupID = nil
        let current = DisplayMatchedPlace(place: entry.place, activityIDs: ids)
        if context.showPlaces { picker.pickPlace(current, store: store) }
        else { picker.invalidateQuery() }
        if loader.focus?.placeID == entry.id { loader.focus = nil; return }
        let inspected = picker.isPresented ? picker.detailID.map(String.init) : nil
        let active = store.activeActivityID.map(String.init)
        let activityID = inspected.flatMap { ids.contains($0) ? $0 : nil }
            ?? active.flatMap { ids.contains($0) ? $0 : nil } ?? ids[0]
        loader.focus = PlaceFocus(activityID: activityID, placeID: entry.id)
    }

    private func openPlaceGroup(_ group: MapPlaceLayout.Group, map: MapController?) {
        guard context.showPlaces, let map, let entry = placeModels[group.id] else { return }
        let key = "cluster:\(group.id)"
        if let last = lastPlaceAction, last.id == key, Date().timeIntervalSince(last.time) < 0.4 { return }
        lastPlaceAction = (key, Date())
        if map.cameraState.zoom >= MapPlaceLayout.chooserZoom {
            openPlaceGroupID = group.id
        } else {
            openPlaceGroupID = nil
            var camera = context.camera
            camera.center = .init(latitude: entry.place.latitude, longitude: entry.place.longitude)
            camera.zoom = min(MapPlaceLayout.chooserZoom, map.cameraState.zoom + 2)
            map.move(to: camera, duration: 0.45)
        }
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

    private func handlePlaceTap(at point: CGPoint, map: MapController) -> Bool {
        if context.showPlaces {
            for group in placeGroups where group.pointIDs.count > 1 {
                guard let entry = placeModels[group.id] else { continue }
                let anchor = map.point(for: CLLocationCoordinate2D(latitude: entry.place.latitude, longitude: entry.place.longitude))
                let offset = MapPlaceClusters.offset(group, groups: placeGroups, focusedID: store.activityPlaces?.focus?.placeID)
                if abs(point.x - anchor.x - offset.x) <= 22 && abs(point.y - anchor.y - offset.y) <= 22 {
                    openPlaceGroup(group, map: map); return true
                }
            }
        }
        for entry in renderedPlaces {
            let anchor = map.point(for: CLLocationCoordinate2D(latitude: entry.place.latitude, longitude: entry.place.longitude))
            if abs(point.x - anchor.x) <= 22 && abs(point.y - anchor.y) <= 22 {
                openPlace(entry); return true
            }
        }
        openPlaceGroupID = nil
        return false
    }
    private func handlePhotoTap(at point: CGPoint, map: MapController) -> Bool {
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
        // The map recognizer and overlay button may both receive the same touch.
        if let last = lastPhotoAction, last.id == group.id, Date().timeIntervalSince(last.time) < 0.4 { return }
        lastPhotoAction = (group.id, Date())
        if !photoThumbnails, group.photoIDs.count > 1 {
            var camera = context.camera
            camera.center = coordinate
            camera.zoom = max(camera.zoom + 2, MapPhotoLayout.thumbnailZoom)
            proxy.map?.move(to: camera, duration: 0.45)
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
            trailingOcclusion: showingResults && layout.isSidePanel
                ? layout.resolvedTrailingOcclusion(presentedFrame: resultsFrame(in: geometry)) + safeArea.trailing : 0
        ) else { return }
        cameraTransitionID = UUID()
        map.move(to: camera, fly: { if case .place = action { return true }; return false }())
    }

    private func resultsFrame(in geometry: GeometryProxy) -> CGRect {
        let layout = MapResultsLayout(size: geometry.size,
            topInset: max(topOcclusion, geometry.safeAreaInsets.top), bottomInset: geometry.safeAreaInsets.bottom,
            detent: picker.detent, largeText: typeSize.isAccessibilitySize)
        return layout.presentationFrame(measuredFrame: resultsGeometry?.frame(in: geometry.size),
            leadingSafeInset: geometry.safeAreaInsets.leading, trailingSafeInset: geometry.safeAreaInsets.trailing)
    }

    private var mapControls: some View {
        VStack(spacing: 0) {
            Menu {
                Toggle(isOn: $context.showPhotos) { Label("Photos", systemImage: "photo") }
                    .menuActionDismissBehavior(.disabled)
                if context.showPhotos, !store.photos.contains(where: {
                    Int($0.activityID).map(store.visibleActivityIDs.contains) == true && MapPhotoLayout.validLocation($0.location)
                }) {
                    Text("No located photos in the current filter")
                }
                Toggle(isOn: $context.showPlaces) { Label("Places", systemImage: "mappin.and.ellipse") }
                    .menuActionDismissBehavior(.disabled)
                if context.showPlaces, placeModels.isEmpty, store.activityPlaces?.overviewLoading != true {
                    Text("No matched places saved in the current filter")
                }
                Divider()
                Section("Base map") {
                    ForEach(SharedMapCatalog.baseMapGroups) { group in
                        let maps = BaseStyle.all.filter { group.maps.contains($0.id) }
                        if maps.count == 1, let style = maps.first {
                            // A one-item inline Picker creates its own padded menu
                            // section. A single choice stays in the base-map group.
                            Toggle(isOn: Binding(
                                get: { context.baseStyle == style },
                                set: { if $0 { context.baseStyle = style } }
                            )) {
                                Text(group.label)
                                if context.baseStyle == style { Text(style.title) }
                                RegionIcon.image(country: group.country)
                            }
                        } else if !maps.isEmpty {
                            Menu {
                                Picker(group.label, selection: $context.baseStyle) {
                                    ForEach(maps) { style in
                                        Label(style.title, systemImage: style.systemImage).tag(style)
                                    }
                                }.pickerStyle(.inline)
                            } label: {
                                // Submenu rows cannot show a checkmark, so the
                                // subtitle names the active style instead.
                                Text(group.label)
                                if maps.contains(context.baseStyle) { Text(context.baseStyle.title) }
                                RegionIcon.image(country: group.country)
                            }
                        }
                    }
                }
                Section("Overlays") {
                    let groupedIDs = Set(SharedMapCatalog.overlayGroups.flatMap(\.overlays))
                    ForEach(SharedMapCatalog.overlayGroups) { group in
                        let overlays = SharedMapCatalog.rasterOverlays.filter { group.overlays.contains($0.id) }
                        let active = overlays.filter { overlayBinding($0).wrappedValue }.count
                        Menu {
                            ForEach(overlays) { overlay in
                                Toggle(overlay.label, isOn: overlayBinding(overlay)).menuActionDismissBehavior(.disabled)
                            }
                        } label: {
                            Text(group.label)
                            if active > 0 { Text("\(active) on") }
                            RegionIcon.image(country: group.country)
                        }
                    }
                    ForEach(SharedMapCatalog.rasterOverlays.filter { !groupedIDs.contains($0.id) }) { overlay in
                        Toggle(overlay.label, isOn: overlayBinding(overlay))
                            .menuActionDismissBehavior(.disabled)
                    }
                }
            } label: {
                BrowseIconLabel(systemImage: "square.3.layers.3d")
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("Map layers")

            Divider().frame(width: 24, height: 1)

            Button {
                context.request(.pitch(context.isPitched ? 0 : 50))
            } label: {
                BrowseIconLabel(systemImage: "view.3d", isSelected: context.isPitched)
                    .frame(width: 44, height: 48)
            }
            .accessibilityLabel("3D map")
            .accessibilityValue(context.isPitched ? "On" : "Off")

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
        mapStyleOverride ?? context.baseStyle.mapLibreStyle(dark: colorScheme == .dark)
    }

    private func overlayBinding(_ overlay: SharedRasterOverlayDefinition) -> Binding<Bool> {
        Binding {
            context.activeOverlays.contains(overlay)
        } set: { on in
            if on { context.activeOverlays.insert(overlay) } else { context.activeOverlays.remove(overlay) }
        }
    }

    @ViewBuilder private var annotationOverlay: some View {
        ZStack(alignment: .topLeading) {
            if let loader = store.activityPlaces {
                MatchedPlacesLayer(places: renderedPlaces, loader: loader, overview: context.showPlaces,
                    onSelect: openPlace, positions: positions, proxy: proxy)
                if context.showPlaces {
                    MapPlaceClusters(groups: placeGroups, places: placeModels, focusedID: loader.focus?.placeID,
                        openGroupID: openPlaceGroupID, openGroup: { openPlaceGroup($0, map: proxy.map) },
                        select: openPlace, close: { openPlaceGroupID = nil }, positions: positions, proxy: proxy)
                }
            }
            if let place = filteredPlace {
                GeographicOverlay(coordinate: .init(latitude: place.place.latitude, longitude: place.place.longitude),
                    positions: positions, proxy: proxy, anchor: .bottom) { PlaceFilterPin(place: place.place) }
            }
            if context.showPhotos {
                ForEach(photoGroups) { group in
                    if let photo = photoModels[group.id], let coordinate = photo.location {
                        GeographicOverlay(coordinate: coordinate, positions: positions, proxy: proxy) {
                            MapPhotoMarker(store: store, photo: photo, count: group.photoIDs.count,
                                thumbnails: photoThumbnails) { openPhotoGroup(group) }
                                .matchedTransitionSource(id: photo.id, in: photoTransition)
                        }
                    }
                }
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
    }
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

private struct PlacesDemand: Equatable {
    let ids: Set<Int>
    let overview: Set<Int>
    let priority: Int?
    let session: Int?
    let visible: Bool
}

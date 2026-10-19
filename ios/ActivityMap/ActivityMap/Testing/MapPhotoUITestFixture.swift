#if DEBUG
import CoreLocation
import MapboxMaps
import Observation
import SwiftUI
import UIKit

/// Standalone XCUI host. Compiled out of Release; it never constructs auth/sync
/// controllers or reads the real library, token, or image-cache directory.
struct MapPhotoUITestFixture: View {
    @State private var fixture: MapPhotoUITestState

    init(resultsPresented: Bool) {
        _fixture = State(initialValue: MapPhotoUITestState(resultsPresented: resultsPresented))
    }

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 10) {
                Button("Hide ride") { fixture.store.activeSportTypes.remove(.ride) }
                    .accessibilityIdentifier("map-photo-fixture-hide-ride")
                Button("Delete on viewer") { fixture.deleteOnNextViewer = true }
                    .accessibilityIdentifier("map-photo-fixture-delete-on-next-viewer")
                Button("Restore") { fixture.restore() }
                    .accessibilityIdentifier("map-photo-fixture-restore")
            }
            .font(.caption)
            .buttonStyle(.bordered)
            Text(fixture.ready ? "Map photo fixture ready" : "Preparing map photo fixture")
                .font(.caption2)
                .accessibilityIdentifier("map-photo-fixture-state")
                .accessibilityValue(fixture.diagnostics)
            if fixture.ready {
                MapScreen(store: fixture.store, picker: fixture.picker)
                    .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))
                    .onGeometryChange(for: CGSize.self) { $0.size } action: { fixture.mapSize = $0 }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(MapPhotoPresentationProbe { fixture.samplePresentations(from: $0) }.frame(width: 0, height: 0))
        .task { await fixture.prepare() }
    }
}

@MainActor @Observable
private final class MapPhotoFetchLog {
    var paths: [String] = []
    func record(_ url: URL) { paths.append(url.path) }
}

@MainActor @Observable
private final class MapPhotoUITestState {
    let store: ActivityStore
    let picker = RoutePicker()
    let initiallyPresentedResults: Bool
    let cacheRoot: URL
    let requests: MapPhotoFetchLog
    let initialPhotos: [Photo]
    @ObservationIgnored private var initialSelection: Set<Int> = []
    var ready = false
    var preparationError = ""
    var mapSize = CGSize.zero
    var deleteOnNextViewer = false
    var deletedAfterPresentation = false
    var presenterDepth = 0
    var lastViewerDepth = 0
    var lastViewerHasTransition = false
    var lastViewerDragLocked = false
    var selectionChangedDuringViewer = false

    init(resultsPresented: Bool) {
        initiallyPresentedResults = resultsPresented
        MapboxOptions.accessToken = "pk.offline-test"
        // This fixed subtree belongs exclusively to this DEBUG fixture. XCUI
        // terminates the process, so the next launch must clean prior bytes.
        let root = FileManager.default.temporaryDirectory.appending(path: "ActivityMapMapPhotoUITestFixture", directoryHint: .isDirectory)
        cacheRoot = root
        let log = MapPhotoFetchLog()
        requests = log
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let bytes = UIGraphicsImageRenderer(size: CGSize(width: 256, height: 256), format: format).image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 256, height: 256))
        }.pngData()!
        let images = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { url in
            await log.record(url)
            return bytes
        }))
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let activities = [(1, SportType.run), (2, SportType.ride)].map { id, sport in
            Activity(id: id, name: "Activity \(id)", sportType: sport, startDate: date,
                     startDateLocal: date, timezone: "UTC", distance: 1000, movingTime: 600,
                     elapsedTime: 600, totalElevationGain: 10, averageSpeed: 2, commute: false,
                     coordinates: [.init(latitude: 46, longitude: 8), .init(latitude: 46.01, longitude: 8.01)])
        }
        store = ActivityStore(activities: activities,
                              listPresentation: ActivityListPresentation(defaults: nil), photoImages: images)
        let center = CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005)
        initialPhotos = [
            Photo(id: "a", activityID: "1", caption: "First map photo",
                  urls: ["256": "https://photos.test/thumb-a", "1600": "https://photos.test/full-a"], location: center, createdAt: nil),
            Photo(id: "b", activityID: "2", caption: "Second map photo",
                  urls: ["256": "https://photos.test/thumb-b", "1600": "https://photos.test/full-b"], location: center, createdAt: nil),
            Photo(id: "a2", activityID: "1", caption: "Second photo of the same activity",
                  urls: ["1600": "https://photos.test/full-a2"], location: nil, createdAt: nil),
            Photo(id: "unlocated", activityID: "1", caption: nil, urls: [:], location: nil, createdAt: nil),
        ]
        store.photos = initialPhotos
        store.mapContext.record(CameraState(center: center, padding: .zero, zoom: 10, bearing: 0, pitch: 0))
        store.mapContext.showPhotos = true
        if resultsPresented { store.replaceSelection(with: [2]) }
        initialSelection = store.selectedActivityIDs
        picker.isPresented = resultsPresented
        picker.detent = .compact
    }

    func prepare() async {
        guard !ready else { return }
        do {
            if FileManager.default.fileExists(atPath: cacheRoot.path) {
                try FileManager.default.removeItem(at: cacheRoot)
            }
            try await store.photoImages.configure(
                scope: StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "photo-ui-test"),
                photos: initialPhotos)
            ready = true
        } catch { preparationError = String(describing: error) }
    }

    func deleteFirst() { store.photos.removeAll { $0.id == "a" } }

    func restore() {
        store.photos = initialPhotos
        store.resetFilters()
        store.mapContext.showPhotos = true
        store.selectedTab = .map
        picker.isPresented = initiallyPresentedResults
        picker.detent = .compact
        deleteOnNextViewer = false
        deletedAfterPresentation = false
        lastViewerDepth = 0
        lastViewerHasTransition = false
        lastViewerDragLocked = false
        selectionChangedDuringViewer = false
    }

    private var usesNativePresentation: Bool {
        MapResultsLayout(size: mapSize, topInset: 0, bottomInset: 0,
                         detent: picker.detent).usesNativePresentation
    }

    var diagnostics: String {
        let object: [String: Any] = [
            "ready": ready, "error": preparationError,
            "selection": store.selectedActivityIDs.sorted(),
            "visible": store.visibleActivityIDs.sorted(),
            "photos": store.photos.map(\.id).sorted(),
            "tab": store.selectedTab.title.lowercased(), "inspection": store.inspectedActivityID ?? -1,
            "showPhotos": store.mapContext.showPhotos,
            "pendingCamera": store.mapContext.pendingRequest != nil,
            "zoom": store.mapContext.camera.zoom,
            "resultsPresented": picker.isPresented, "resultsDetent": picker.detent.rawValue,
            "usesNativePresentation": usesNativePresentation,
            "fetchPaths": requests.paths, "fetchCount": requests.paths.count,
            "presenterDepth": presenterDepth, "lastViewerDepth": lastViewerDepth,
            "lastViewerHasTransition": lastViewerHasTransition, "lastViewerDragLocked": lastViewerDragLocked,
            "selectionChangedDuringViewer": selectionChangedDuringViewer,
            "deleteArmed": deleteOnNextViewer, "deletedAfterPresentation": deletedAfterPresentation,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let string = String(data: data, encoding: .utf8) else { return "{}" }
        return string
    }

    /// Inspect documented controller relationships, never SwiftUI's private
    /// UIView/accessibility implementation. Retain viewer facts after dismissal
    /// because an actual full-screen modal hides the fixture status from XCUI.
    func samplePresentations(from root: UIViewController) {
        var chain: [UIViewController] = []
        var current = root.presentedViewController
        while let controller = current, chain.count < 8 {
            chain.append(controller)
            current = controller.presentedViewController
        }
        if presenterDepth != chain.count { presenterDepth = chain.count }
        let baselineDepth = initiallyPresentedResults && usesNativePresentation && picker.isPresented ? 1 : 0
        guard chain.count > baselineDepth else { return }
        let viewer = chain[baselineDepth]
        guard viewer.modalPresentationStyle == .fullScreen || viewer.modalPresentationStyle == .overFullScreen
                || viewer.preferredTransition != nil else { return }
        if store.selectedActivityIDs != initialSelection, !selectionChangedDuringViewer {
            selectionChangedDuringViewer = true
        }
        if lastViewerDepth != baselineDepth + 1 { lastViewerDepth = baselineDepth + 1 }
        let hasTransition = viewer.preferredTransition != nil
        if lastViewerHasTransition != hasTransition { lastViewerHasTransition = hasTransition }
        if lastViewerDragLocked != viewer.isModalInPresentation { lastViewerDragLocked = viewer.isModalInPresentation }
        if deleteOnNextViewer, !viewer.isBeingPresented, !viewer.isBeingDismissed, viewer.viewIfLoaded?.window != nil {
            deleteOnNextViewer = false
            deletedAfterPresentation = true
            deleteFirst()
        }
    }
}

private struct MapPhotoPresentationProbe: UIViewControllerRepresentable {
    let sample: @MainActor (UIViewController) -> Void
    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.sample = sample
        controller.start()
    }
    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) { controller.stop() }

    final class Controller: UIViewController {
        var sample: (@MainActor (UIViewController) -> Void)?
        private var sampling: Task<Void, Never>?
        private weak var root: UIViewController?
        func start() {
            guard sampling == nil else { return }
            sampling = Task { [weak self] in
                while !Task.isCancelled {
                    guard let self else { return }
                    if let current = view.window?.rootViewController { root = current }
                    if root == nil {
                        var current = parent
                        while let ancestor = current?.parent { current = ancestor }
                        root = current
                    }
                    if let root { sample?(root) }
                    do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
                }
            }
        }
        func stop() { sampling?.cancel(); sampling = nil; sample = nil }
    }
}
#endif

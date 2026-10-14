import CoreLocation
import MapboxMaps
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedMapPhotoTests {
    @Test func pinsZoomToThumbnailsAndViewerPreservesSelection() async throws {
        try await journey(resultsPresented: false)
    }
    @Test func viewerRetainsResultsPresentationAndReturnsToIt() async throws {
        try await journey(resultsPresented: true)
    }

    @Test func layersMenuExposesPhotoControlFirstAndPreservesBrowsingState() async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        let host = try MapPhotoHarness(root: AnyView(MapScreen(store: store)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))))
        defer { host.close() }
        try await wait { host.element(labelPrefix: "Map layers") != nil }
        #expect(try #require(host.element(labelPrefix: "Map layers")).accessibilityActivate())
        try await wait { host.menuButton() != nil }
        let button = try #require(host.menuButton())
        func actions(_ element: UIMenuElement) -> [UIAction] {
            if let action = element as? UIAction { return [action] }
            return (element as? UIMenu)?.children.flatMap(actions) ?? []
        }
        let menu = try #require(button.menu)
        let photo = try #require(actions(menu).first)
        #expect(photo.title == "Show photos on map", "Photo visibility must precede the long basemap list")
        #expect(!photo.attributes.contains(.hidden) && !photo.attributes.contains(.disabled))
        let selected = store.selectedActivityIDs
        let camera = store.mapContext.camera
        button.sendAction(photo)
        try await wait { store.mapContext.showPhotos }
        #expect(store.selectedActivityIDs == selected && store.mapContext.pendingRequest == nil)
        #expect(store.mapContext.camera.zoom == camera.zoom)
        let updated = try #require(host.menuButton()?.menu)
        button.sendAction(try #require(actions(updated).first))
        try await wait { !store.mapContext.showPhotos }
        #expect(store.selectedActivityIDs == selected && store.mapContext.pendingRequest == nil)
    }

    private func journey(resultsPresented: Bool) async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let log = MapPhotoRequestLog()
        let data = try #require(UIGraphicsImageRenderer(size: CGSize(width: 256, height: 256)).image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 256, height: 256))
        }.pngData())
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { url in await log.record(url); return data }))
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2, sport: .ride)], photoImages: cache)
        if resultsPresented { store.replaceSelection(with: [2]) }
        let selected = store.selectedActivityIDs
        let center = CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005)
        store.photos = [Photo(id: "a", activityID: "1", caption: "First map photo", urls: ["256": "https://photos.test/thumb-a", "1600": "https://photos.test/full-a"], location: center, createdAt: nil),
                        Photo(id: "b", activityID: "2", caption: "Second map photo", urls: ["256": "https://photos.test/thumb-b", "1600": "https://photos.test/full-b"], location: center, createdAt: nil),
                        Photo(id: "unlocated", activityID: "1", caption: nil, urls: [:], location: nil, createdAt: nil)]
        let initialPhotos = store.photos
        try await cache.configure(scope: StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "1"), photos: store.photos)
        store.mapContext.record(CameraState(center: center, padding: .zero, zoom: 10, bearing: 0, pitch: 0))
        store.mapContext.showPhotos = true
        let picker = RoutePicker()
        picker.isPresented = resultsPresented
        picker.detent = .compact
        let host = try MapPhotoHarness(root: AnyView(MapScreen(store: store, picker: picker)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))))
        defer { host.close() }
        let sidePanel = MapResultsLayout(size: host.window.bounds.size, topInset: 0, bottomInset: 0,
            detent: picker.detent, largeText: false).isSidePanel
        try await Task.sleep(for: .milliseconds(800))
        try host.save(resultsPresented ? "native-initial-sheet" : "native-initial")
        try await wait { host.element(labelPrefix: "Zoom into 2 photos") != nil }
        let pin = try #require(host.element(labelPrefix: "Zoom into 2 photos"))
        #expect(pin.accessibilityLabel == "Zoom into 2 photos")
        #expect(await log.paths.isEmpty, "Pins must not load image bytes")
        if resultsPresented && !sidePanel { try await wait { host.host.presentedViewController != nil } }
        #expect(pin.accessibilityActivate())
        try await wait { host.element(labelPrefix: "View 2 photos:")?.accessibilityLabel?.hasPrefix("View 2 photos:") == true }
        try await wait { store.mapContext.camera.zoom >= 12 }
        #expect(store.selectedActivityIDs == selected)
        for _ in 0..<40 {
            if !(await log.paths).isEmpty { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(!(await log.paths).isEmpty)
        #expect((await log.paths).allSatisfy { $0.hasPrefix("/thumb-") })
        try host.save(resultsPresented ? "native-stack-over-results" : "native-thumbnails")
        let thumbnail = try #require(host.element(labelPrefix: "View 2 photos:"))
        #expect(thumbnail.accessibilityActivate())
        try await wait { host.element(labelPrefix: "Close photo viewer") != nil }
        #expect(store.selectedActivityIDs == selected)
        let presented = try #require(host.host.presentedViewController)
        if resultsPresented && !sidePanel {
            #expect(presented.presentedViewController != nil, "The phone results sheet must own the full-screen presentation")
        } else {
            #expect(presented.presentedViewController == nil, "Wide panels and an empty selection use the map presenter")
        }
        let close = try #require(host.element(labelPrefix: "Close photo viewer"))
        #expect(close.accessibilityActivate())
        try await wait { host.element(labelPrefix: "Close photo viewer") == nil }
        #expect(picker.isPresented == resultsPresented && store.selectedActivityIDs == selected)
        // Filters remove one stack member; opening the survivor must still work.
        store.activeSportTypes.remove(.ride)
        try await wait { host.element(labelPrefix: "View photo:") != nil }

        #expect(try #require(host.element(labelPrefix: "View photo:")).accessibilityActivate())
        try await wait { host.element(labelPrefix: "Close photo viewer") != nil }
        store.photos.removeAll { $0.id == "a" }
        try await wait { host.element(labelPrefix: "Close photo viewer") == nil }
        try await wait { host.element(labelPrefix: "View photo:") == nil }

        let camera = store.mapContext.camera
        store.mapContext.showPhotos = false
        try await Task.sleep(for: .milliseconds(100))
        #expect(store.mapContext.camera.zoom == camera.zoom)
        #expect(store.mapContext.pendingRequest == nil)
        // The explicit handoff inspects the current photo's activity, retaining
        // both an empty selection and a pre-existing unrelated selection.
        store.photos = initialPhotos
        store.resetFilters()
        store.mapContext.showPhotos = true
        try await wait { host.element(labelPrefix: "View 2 photos:") != nil }
        #expect(try #require(host.element(labelPrefix: "View 2 photos:")).accessibilityActivate())
        try await wait { host.element(labelPrefix: "Next photo") != nil }
        #expect(try #require(host.element(labelPrefix: "Next photo")).accessibilityActivate())
        try await Task.sleep(for: .milliseconds(250))
        #expect(try #require(host.element(labelPrefix: "View activity")).accessibilityActivate())
        try await wait { store.selectedTab == .list && store.inspectedActivityID == 2 }
        #expect(store.selectedActivityIDs == selected)
    }
    private func wait(line: Int = #line, _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(15)
        while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(50)) }
        try #require(condition(), "Map-photo presentation timed out at line \(line)")
    }
}

private actor MapPhotoRequestLog {
    private(set) var paths: Set<String> = []
    func record(_ url: URL) { paths.insert(url.path) }
}

@MainActor private final class MapPhotoHarness {
    let host: UIHostingController<AnyView>
    let window: UIWindow
    let oldWindow: UIWindow?
    init(root: AnyView) throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        oldWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        host = UIHostingController(rootView: root)
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
    }
    func element(labelPrefix: String) -> NSObject? {
        var visited = Set<ObjectIdentifier>()
        func visit(_ object: NSObject) -> NSObject? {
            guard visited.insert(ObjectIdentifier(object)).inserted else { return nil }
            if let view = object as? UIView, view.isHidden || view.alpha == 0 { return nil }
            if object.accessibilityLabel?.hasPrefix(labelPrefix) == true,
               !object.accessibilityFrame.isEmpty { return object }
            if let elements = object.accessibilityElements as? [NSObject] {
                for child in elements { if let found = visit(child) { return found } }
            }
            let count = object.accessibilityElementCount()
            if count > 0, count < 1000 {
                for index in 0..<count {
                    if let child = object.accessibilityElement(at: index) as? NSObject, let found = visit(child) { return found }
                }
            }
            if let view = object as? UIView {
                for child in view.subviews { if let found = visit(child) { return found } }
            }
            return nil
        }
        return visit(window)
    }
    func menuButton() -> UIButton? {
        func containsPhoto(_ element: UIMenuElement) -> Bool {
            element.title == "Show photos on map" || (element as? UIMenu)?.children.contains(where: containsPhoto) == true
        }
        func visit(_ view: UIView) -> UIButton? {
            if let button = view as? UIButton, let menu = button.menu, containsPhoto(menu) { return button }
            for child in view.subviews { if let found = visit(child) { return found } }
            return nil
        }
        return visit(window)
    }
    func save(_ name: String) throws {
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true) }
        let root = URL(fileURLWithPath: "/private/tmp/activitymap-map-photos")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try image.pngData()?.write(to: root.appending(path: name + ".png"))
    }
    func close() { window.isHidden = true; window.rootViewController = nil; oldWindow?.makeKeyAndVisible() }
}

import Foundation
import Testing
import UIKit
import SwiftUI
import Vision
@testable import ActivityMap

@MainActor
@Suite(.serialized)
struct PhotoGalleryTests {
    static let fixtureURL = ActivityFilterTests.fixtureURL.deletingLastPathComponent().appending(path: "photo-viewer.v1.json")
    static func photo(_ id: String = "a", urls: [String: String] = ["256": "https://photos.test/a"], sizes: [String: [Double]] = [:], createdAt: Date? = nil) -> Photo {
        Photo(id: id, activityID: "1", caption: "A caption", urls: urls, location: nil, createdAt: createdAt, sizes: sizes)
    }

    @Test func consumesSharedVariantsAndOrdering() throws {
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: Self.fixtureURL)) as? [String: Any])
        let cases = try #require(root["variantCases"] as? [[String: Any]])
        #expect(cases.count == 8)
        for item in cases {
            let model = Self.photo(urls: item["urls"] as? [String: String] ?? [:], sizes: item["sizes"] as? [String: [Double]] ?? [:])
            for (name, mode) in [("thumbnail", Photo.ImageUse.thumbnail), ("full", .full)] {
                let expected = item[name] as? [String: Any]
                let variant = model.variant(mode)
                #expect(variant?.url.absoluteString == expected?["url"] as? String, "\(item["name"] ?? "") / \(name)")
                #expect(variant?.width == expected?["width"] as? Double)
                #expect(variant?.height == expected?["height"] as? Double)
            }
        }
        let ordering = try #require(root["orderCases"] as? [[String: Any]])
        for item in ordering {
            let photos = try #require(item["photos"] as? [[String: Any]]).map { raw in
                Self.photo(try #require(raw["id"] as? String), urls: [:], createdAt: (raw["created_at"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) })
            }
            #expect(Photo.ordered(photos).map(\.id) == item["expected_ids"] as? [String])
            #expect(Photo.ordered(photos.reversed()).map(\.id) == item["expected_ids"] as? [String])
        }
    }

    @Test func diskReopenWorksOfflineAndSnapshotPrunesOrphans() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "1")
        let model = Self.photo()
        let url = try #require(model.variant(.full)?.url)
        let cache = PhotoByteCache(root: root, fetch: { _ in Data([1, 2, 3]) })
        let first = UUID()
        try await cache.configure(scope: scope, photos: [model], revision: first)
        #expect(try await cache.data(photoID: model.id, url: url, revision: first) == Data([1, 2, 3]))
        let offline = PhotoByteCache(root: root, fetch: { _ in throw URLError(.notConnectedToInternet) })
        let reopened = UUID()
        try await offline.configure(scope: scope, photos: [model], revision: reopened)
        #expect(try await offline.data(photoID: model.id, url: url, revision: reopened) == Data([1, 2, 3]))
        let uncached = Self.photo("b", urls: ["256": "https://photos.test/b"])
        try await offline.configure(scope: scope, photos: [model, uncached], revision: reopened)
        await #expect(throws: URLError.self) { try await offline.data(photoID: uncached.id, url: uncached.variant(.full)!.url, revision: reopened) }
        try await offline.configure(scope: scope, photos: [uncached], revision: reopened)
        let files = try FileManager.default.contentsOfDirectory(at: root.appending(path: PhotoByteCache.digest(scope.key)), includingPropertiesForKeys: nil)
        #expect(files.map(\.lastPathComponent) == ["index.json"])
        await #expect(throws: PhotoByteCache.Failure.self) { try await offline.data(photoID: model.id, url: url, revision: reopened) }
    }

    @Test func boundsAndChangedURLsAreReconciled() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "1")
        let cache = PhotoByteCache(root: root, budget: 4, fileLimit: 3, fetch: { _ in Data([1, 2, 3]) })
        let revision = UUID()
        let a = Self.photo(), b = Self.photo("b", urls: ["256": "https://photos.test/b"])
        try await cache.configure(scope: scope, photos: [a, b], revision: revision)
        _ = try await cache.data(photoID: a.id, url: a.variant(.full)!.url, revision: revision)
        _ = try await cache.data(photoID: b.id, url: b.variant(.full)!.url, revision: revision)
        let folder = root.appending(path: PhotoByteCache.digest(scope.key))
        let names = try FileManager.default.contentsOfDirectory(atPath: folder.path)
        #expect(!names.contains(PhotoByteCache.key(photoID: a.id, url: a.variant(.full)!.url)))
        #expect(names.contains(PhotoByteCache.key(photoID: b.id, url: b.variant(.full)!.url)))
        let changed = Self.photo("b", urls: ["256": "https://photos.test/new-b"])
        try await cache.configure(scope: scope, photos: [changed], revision: revision)
        #expect(try FileManager.default.contentsOfDirectory(atPath: folder.path) == ["index.json"])
        let oversized = PhotoByteCache(root: root, fileLimit: 2, fetch: { _ in Data([1, 2, 3]) })
        try await oversized.configure(scope: scope, photos: [a], revision: revision)
        await #expect(throws: PhotoByteCache.Failure.self) { try await oversized.data(photoID: a.id, url: a.variant(.full)!.url, revision: revision) }
    }

    @Test func scopeChangeFencesDelayedDownloadAndPurgesDisk() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = DownloadGate()
        let cache = PhotoByteCache(root: root, fetch: { _ in await gate.wait() })
        let scope = StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "1")
        let photo = Self.photo()
        let first = UUID()
        try await cache.configure(scope: scope, photos: [photo], revision: first)
        let request = Task { try await cache.data(photoID: photo.id, url: photo.variant(.full)!.url, revision: first) }
        await gate.started()
        try await cache.configure(scope: StoreScope(deployment: scope.deployment, userID: "2"), photos: [photo], revision: UUID())
        await gate.finish()
        await #expect(throws: PhotoByteCache.Failure.self) { try await request.value }
        #expect(!FileManager.default.fileExists(atPath: root.appending(path: PhotoByteCache.digest(scope.key)).path))
    }

    @Test func deletionAlsoFencesDelayedDownloadAndInvalidBytesFail() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = DownloadGate()
        let bytes = PhotoByteCache(root: root, fetch: { _ in await gate.wait() })
        let scope = StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "1")
        let photo = Self.photo()
        let revision = UUID()
        try await bytes.configure(scope: scope, photos: [photo], revision: revision)
        let request = Task { try await bytes.data(photoID: photo.id, url: photo.variant(.full)!.url, revision: revision) }
        await gate.started()
        try await bytes.configure(scope: scope, photos: [], revision: UUID())
        await gate.finish()
        await #expect(throws: PhotoByteCache.Failure.self) { try await request.value }
        let images = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in Data("broken image".utf8) }))
        try await images.configure(scope: scope, photos: [photo])
        await #expect(throws: PhotoByteCache.Failure.self) { try await images.image(photo: photo, use: .full) }
    }
}

private actor DownloadGate {
    private var continuation: CheckedContinuation<Data, Never>?
    private var startWaiter: CheckedContinuation<Void, Never>?
    func wait() async -> Data {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            startWaiter?.resume()
            startWaiter = nil
        }
    }
    func started() async {
        if continuation != nil { return }
        await withCheckedContinuation { startWaiter = $0 }
    }
    func finish() { continuation?.resume(returning: Data([1, 2, 3])); continuation = nil }
}

extension PhotoGalleryTests {
    @Test(arguments: ["phone", "landscape", "large-text", "tablet"])
    func renderedPagerDoesNotResizeWhenCurrentCaptionDisappears(scenario: String) async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let data = try #require(UIGraphicsImageRenderer(size: CGSize(width: 100, height: 100)).image { context in
            UIColor.systemOrange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 100, height: 100))
        }.pngData())
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in data }))
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)], photoImages: cache)
        store.photos = [Self.photo("1"), Self.photo("2"),
                        Photo(id: "3", activityID: "1", caption: "A longer caption\nwith several lines\nto keep readable\nwhile paging", urls: Self.photo().urls, location: nil, createdAt: nil)]
        let scope = StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "1")
        try await cache.configure(scope: scope, photos: store.photos)
        let size = scenario == "landscape" ? CGSize(width: 844, height: 390)
            : scenario == "tablet" ? CGSize(width: 834, height: 1194) : CGSize(width: 390, height: 844)
        let host = try PhotoViewHarness(root: PhotoViewer(store: store, activityID: 1, initialPhotoID: "2")
            .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(400))
        let pager = try #require(host.descendants(of: UIScrollView.self).first {
            $0.contentSize.width > $0.bounds.width * 1.5 && $0.bounds.height > 50
        })
        let before = pager.convert(pager.bounds, to: host.host.view)
        #expect(before.height >= size.height * 0.9, "Floating controls must not reserve image space")
        #expect(abs(pager.bounds.width - size.width - 16) < 1, "Page stride includes a 16-point gap")
        let imageView = try #require(host.descendants(of: PhotoZoomScrollView.self).first)
        #expect(abs(imageView.bounds.width - size.width) < 1, "Settled photos retain full viewport width")
        store.photos[1] = Photo(id: "2", activityID: "1", caption: nil, urls: Self.photo().urls, location: nil, createdAt: nil)
        try await Task.sleep(for: .milliseconds(150))
        let after = pager.convert(pager.bounds, to: host.host.view)
        #expect(abs(before.height - after.height) < 1 && abs(before.minY - after.minY) < 1,
                "Changing caption presence must not move the native paging viewport: \(before) → \(after)")
    }

    @Test(arguments: ["1", "3", "9"])
    func renderedViewerPreparesAdjacentPhotosWithoutFetchingWholeGallery(initialID: String) async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let requests = PhotoRequestLog()
        let data = try #require(UIGraphicsImageRenderer(size: CGSize(width: 400, height: 400)).image { context in
            UIColor.systemOrange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 400, height: 400))
        }.pngData())
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { url in
            await requests.record(url)
            return data
        }))
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)], photoImages: cache)
        store.photos = (1...9).map { Self.photo(String($0), urls: ["1600": "https://photos.test/\($0)"]) }
        store.replaceSelection(with: [1])
        let scope = StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "1")
        try await cache.configure(scope: scope, photos: store.photos)
        let host = try PhotoViewHarness(root: PhotoViewer(store: store, activityID: 1, initialPhotoID: initialID),
                                        size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(700))
        let loaded = await requests.paths
        let initial = try #require(Int(initialID))
        let expected = Set((max(1, initial - 1)...min(9, initial + 1)).map { "/\($0)" })
        #expect(loaded == expected, "Available swipe destinations must have an image before selection changes, without loading all nine photos: \(loaded)")
        #expect(store.selectedActivityIDs == [1])
    }

    @Test(arguments: ["phone", "landscape", "large-text", "missing"])
    func renderedViewerOpensRequestedPageWithoutChangingSelection(scenario: String) async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "1")
        let size = CGSize(width: 900, height: 1600)
        let data = try #require(UIGraphicsImageRenderer(size: size).image { context in
            UIColor(red: 0.47, green: 0.61, blue: 0.67, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor(red: 0.28, green: 0.43, blue: 0.39, alpha: 1).setFill()
            let path = UIBezierPath()
            path.move(to: CGPoint(x: 0, y: 1600))
            path.addLine(to: CGPoint(x: 240, y: 500))
            path.addLine(to: CGPoint(x: 460, y: 1200))
            path.addLine(to: CGPoint(x: 700, y: 320))
            path.addLine(to: CGPoint(x: 900, y: 1100))
            path.addLine(to: CGPoint(x: 900, y: 1600))
            path.close(); path.fill()
            ("Photo 2" as NSString).draw(at: CGPoint(x: 60, y: 120), withAttributes: [.font: UIFont.systemFont(ofSize: 72), .foregroundColor: UIColor.white])
        }.pngData())
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in data }))
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)], photoImages: cache)
        store.photos = [Self.photo("1"), Self.photo("2", urls: scenario == "missing" ? [:] : ["1600": "https://photos.test/portrait"], sizes: ["1600": [900,1600]]), Self.photo("3")]
        store.replaceSelection(with: [1])
        let selected = store.selectedActivityIDs
        try await cache.configure(scope: scope, photos: store.photos)
        let viewport = scenario == "landscape" ? CGSize(width: 844, height: 390) : CGSize(width: 390, height: 844)
        let host = try PhotoViewHarness(root: PhotoViewer(store: store, activityID: 1, initialPhotoID: "2")
            .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large), size: viewport)
        defer { host.close() }
        var image = host.snapshot()
        var text = ""
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(5))
        // Cold Vision initialization can take longer than the rendering budget.
        // Let SwiftUI load/draw the photo before OCR, and never block MainActor
        // with recognition while its image-loading task is trying to publish.
        repeat {
            try await Task.sleep(for: .milliseconds(100))
            image = host.snapshot()
            if scenario == "missing" { text = try await recognizePhotoText(image) }
        } while !(scenario == "missing" ? text.contains("Photo unavailable") : containsFixturePhoto(image)) && clock.now < deadline
        if scenario != "missing" { text = try await recognizePhotoText(image) }
        #expect(text.replacingOccurrences(of: " ", with: "").contains("2of3"), "Requested photo remains page 2: \(text)")
        #expect(text.contains("A caption"), "Caption remains readable: \(text)")
        if scenario == "missing" { #expect(text.contains("Photo unavailable")) }
        else { #expect(containsFixturePhoto(image), "The requested image must actually be visible, including when its text is too small for landscape OCR") }
        #expect(store.selectedActivityIDs == selected)
        let output = URL(fileURLWithPath: "/tmp/activitymap-photo-evidence")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        try image.pngData()?.write(to: output.appending(path: "ios-\(scenario).png"))
    }
}

private actor PhotoRequestLog {
    private(set) var paths: Set<String> = []
    func record(_ url: URL) { paths.insert(url.path) }
}

private func recognizePhotoText(_ image: UIImage) async throws -> String {
    let source = try #require(image.cgImage)
    return try await Task.detached {
        let request = VNRecognizeTextRequest()
        request.minimumTextHeight = 0.003 // Fitted portrait text is small in landscape.
        try VNImageRequestHandler(cgImage: source).perform([request])
        return (request.results?.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ") ?? "")
            .replacingOccurrences(of: "0f", with: "of") // Vision can read the counter's "o" as zero.
    }.value
}

private func containsFixturePhoto(_ image: UIImage) -> Bool {
    guard let source = image.cgImage else { return false }
    var pixels = [UInt8](repeating: 0, count: 64 * 64 * 4)
    pixels.withUnsafeMutableBytes { bytes in
        guard let context = CGContext(data: bytes.baseAddress, width: 64, height: 64, bitsPerComponent: 8,
                                      bytesPerRow: 64 * 4, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
        context.draw(source, in: CGRect(x: 0, y: 0, width: 64, height: 64))
    }
    // The fixture's blue sky distinguishes image bytes from black/grey loading
    // chrome, even when the contained portrait image is small in landscape.
    return stride(from: 0, to: pixels.count, by: 4).filter {
        abs(Int(pixels[$0]) - 120) < 12 && abs(Int(pixels[$0 + 1]) - 156) < 12 && abs(Int(pixels[$0 + 2]) - 171) < 12
    }.count > 4
}

@MainActor
private final class PhotoViewHarness<Content: View> {
    let window: UIWindow
    let oldWindow: UIWindow?
    let host: UIHostingController<Content>
    init(root: Content, size: CGSize) throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        oldWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        host = UIHostingController(rootView: root)
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
    }
    func snapshot() -> UIImage {
        host.view.layoutIfNeeded()
        return UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
    }
    func descendants<T: UIView>(of type: T.Type) -> [T] {
        func visit(_ view: UIView) -> [T] {
            ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap(visit)
        }
        return visit(host.view)
    }
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

extension PhotoGalleryTests {
    @Test func fullscreenViewerUsesSystemZoomTransitionAndDismissesCleanly() async throws {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        store.photos = [Self.photo("2", urls: [:])]
        store.replaceSelection(with: [1])
        var dismissals = 0
        let host = try PhotoViewHarness(root: PhotoPresentationFixture(store: store,
            onDismiss: { dismissals += 1 }), size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(600))
        let presented = try #require(host.host.presentedViewController)
        #expect(presented.preferredTransition != nil, "SwiftUI must configure the system zoom transition")
        await withCheckedContinuation { continuation in
            presented.dismiss(animated: true) { continuation.resume() }
        }
        try await Task.sleep(for: .milliseconds(100))
        #expect(host.host.presentedViewController == nil && dismissals == 1)
        #expect(store.selectedActivityIDs == [1])
    }

    @Test(arguments: ["phone", "landscape", "tablet"])
    func nativeZoomSupportsMagnificationPanningAndReset(scenario: String) throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 900)).image { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 600, height: 900))
        }
        let size = scenario == "landscape" ? CGSize(width: 844, height: 390)
            : scenario == "tablet" ? CGSize(width: 834, height: 1194) : CGSize(width: 390, height: 844)
        let host = try PhotoViewHarness(root: ZoomablePhoto(image: image, isCurrent: true).ignoresSafeArea(), size: size)
        defer { host.close() }
        host.host.view.layoutIfNeeded()
        let zoom = try #require(host.descendants(of: PhotoZoomScrollView.self).first)
        zoom.layoutIfNeeded()
        #expect(zoom.zoomScale == 1 && !zoom.panGestureRecognizer.isEnabled)
        let point = CGPoint(x: zoom.photoView.bounds.midX, y: zoom.photoView.bounds.midY)
        zoom.zoom(at: point, animated: false)
        #expect(zoom.zoomScale > 2 && zoom.panGestureRecognizer.isEnabled)
        let offset = zoom.contentOffset
        zoom.setContentOffset(CGPoint(x: offset.x + 20, y: offset.y + 20), animated: false)
        #expect(zoom.contentOffset != offset)
        zoom.zoom(at: point, animated: false)
        #expect(zoom.zoomScale == 1 && !zoom.panGestureRecognizer.isEnabled)
        zoom.zoom(at: point, animated: false)
        host.host.rootView = ZoomablePhoto(image: image, isCurrent: false).ignoresSafeArea()
        host.host.view.layoutIfNeeded()
        #expect(zoom.zoomScale == 1, "Leaving the current page must reset zoom")
    }

    @Test func imageCacheFailureDoesNotHideSyncedMetadataAndOrphansAreExcluded() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try Data().write(to: root) // A file cannot serve as the cache directory.
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let activity = try Fixtures.activity()
        let photo = try Fixtures.photo()
        let orphan = try Fixtures.photo(["unique_id": "orphan", "activity_id": "2"])
        let source = ScriptedSyncSource([
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([activity]))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos([photo, orphan]))),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
        ])
        let images = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in throw URLError(.notConnectedToInternet) }))
        let store = ActivityStore(photoImages: images)
        let controller = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .ready)
        #expect(store.photos.map(\.id) == [photo.uniqueID])
        #expect(controller.photos.map(\.id) == [photo.uniqueID])
        #expect(store.photos.first?.sizes == photo.sizes)
        store.clearScope()
        #expect(store.photos.isEmpty)
    }
}

private struct PhotoPresentationFixture: View {
    let store: ActivityStore
    let onDismiss: () -> Void
    @Namespace private var transition
    @State private var presented = false

    var body: some View {
        Text("Photo thumbnail").frame(width: 88, height: 88)
            .matchedTransitionSource(id: "2", in: transition)
            .fullScreenCover(isPresented: $presented, onDismiss: onDismiss) {
                PhotoViewer(store: store, activityID: 1, initialPhotoID: "2", transitionNamespace: transition)
            }
            .task { presented = true }
    }
}

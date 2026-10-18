import Foundation
import Testing
import UIKit
@testable import ActivityMap

@MainActor
@Suite(.serialized)
struct PhotoPipelineTests {
    private let scope = StoreScope(deployment: URL(string: "https://activitymap.test")!, userID: "pipeline")
    private let photo = PhotoGalleryTests.photo(urls: ["1600": "https://photos.test/shared"])

    private func fixture() throws -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return try #require(UIGraphicsImageRenderer(size: CGSize(width: 2400, height: 1600), format: format).image { context in
            UIColor.systemOrange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2400, height: 1600))
        }.jpegData(compressionQuality: 0.9))
    }

    private func waitFor(_ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(5)
        while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(condition())
    }

    @Test func demandAndPrefetchShareDownloadAndSizeSpecificDecode() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fetch = PipelineFetchGate()
        let probe = PipelineDecodeProbe(blocked: true)
        defer { probe.release() }
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in try await fetch.data() }), decode: probe.decode)
        try await cache.configure(scope: scope, photos: [photo])
        let full = (0..<5).map { _ in Task { try await cache.image(photo: photo, use: .full) } }
        let thumbnail = Task { try await cache.image(photo: photo, use: .thumbnail) }
        await fetch.started(1)
        await fetch.finish(1, with: .success(try fixture()))
        try await waitFor { probe.edges.count == 2 }
        #expect(await fetch.count == 1)
        #expect(probe.edges.sorted() == [256, 2048])
        #expect(probe.mainThreadCount == 0)
        probe.release()
        let image = try await full[0].value
        for request in full { #expect(try await request.value === image) }
        #expect(try await thumbnail.value.size.width == 256)
        #expect(image.size.width == 2048)
        #expect(try await cache.image(photo: photo, use: .full) === image)
        #expect(probe.edges.count == 2)
    }

    @Test func cancellingConsumersDoesNotCancelSharedWorkOrPoisonRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fetch = PipelineFetchGate()
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in try await fetch.data() }))
        try await cache.configure(scope: scope, photos: [photo])
        let departing = Task { try await cache.image(photo: photo, use: .full) }
        await fetch.started(1)
        let remaining = Task { try await cache.image(photo: photo, use: .full) }
        departing.cancel()
        await fetch.finish(1, with: .success(try fixture()))
        await #expect(throws: CancellationError.self) { try await departing.value }
        let image = try await remaining.value
        #expect(try await cache.image(photo: photo, use: .full) === image)
        #expect(await fetch.count == 1)

        // Even the only consumer may leave: completion clears the in-flight slot.
        try await cache.configure(scope: scope, photos: [photo])
        let uncached = PhotoGalleryTests.photo("new", urls: ["256": "https://photos.test/new"])
        try await cache.configure(scope: scope, photos: [uncached])
        let sole = Task { try await cache.image(photo: uncached, use: .thumbnail) }
        await fetch.started(2)
        sole.cancel()
        await fetch.finish(2, with: .success(try fixture()))
        await #expect(throws: CancellationError.self) { try await sole.value }
        #expect(try await cache.image(photo: uncached, use: .thumbnail).size.width == 256)
        #expect(await fetch.count == 2)
    }

    @Test(arguments: ["logout", "account", "metadata"])
    func suspendedDecodeCannotPublishAfterInvalidation(change: String) async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let probe = PipelineDecodeProbe(blocked: true)
        defer { probe.release() }
        let data = try fixture()
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in data }), decode: probe.decode)
        try await cache.configure(scope: scope, photos: [photo])
        let old = Task { try await cache.image(photo: photo, use: .full) }
        try await waitFor { probe.edges.count == 1 }
        let replacement = PhotoGalleryTests.photo(urls: ["1600": "https://photos.test/changed"])
        if change == "logout" { cache.reset() }
        else {
            try await cache.configure(scope: change == "account" ? StoreScope(deployment: scope.deployment, userID: "other") : scope,
                                      photos: [change == "metadata" ? replacement : photo])
        }
        probe.release()
        do { _ = try await old.value; Issue.record("Obsolete decode published") } catch { }
        if change == "logout" {
            await #expect(throws: PhotoByteCache.Failure.self) { try await cache.image(photo: photo, use: .full) }
        } else {
            _ = try await cache.image(photo: change == "metadata" ? replacement : photo, use: .full)
            #expect(probe.edges.count == 2, "New scope/metadata must decode again")
        }
    }

    @Test func failedDownloadAndInvalidDecodeLeaveSlotsRetryable() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fetch = PipelineFetchGate()
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in try await fetch.data() }))
        try await cache.configure(scope: scope, photos: [photo])
        let failed = Task { try await cache.image(photo: photo, use: .full) }
        await fetch.started(1)
        await fetch.finish(1, with: .failure(URLError(.notConnectedToInternet)))
        await #expect(throws: URLError.self) { try await failed.value }
        let invalid = Task { try await cache.image(photo: photo, use: .full) }
        await fetch.started(2)
        await fetch.finish(2, with: .success(Data("invalid".utf8)))
        await #expect(throws: PhotoByteCache.Failure.self) { try await invalid.value }
        let recovered = Task { try await cache.image(photo: photo, use: .full) }
        await fetch.started(3)
        await fetch.finish(3, with: .success(try fixture()))
        #expect(try await recovered.value.size.width == 2048)
    }
}

private actor PipelineFetchGate {
    private(set) var count = 0
    private var pending: [Int: CheckedContinuation<Data, Error>] = [:]
    private var observers: [(Int, CheckedContinuation<Void, Never>)] = []
    func data() async throws -> Data {
        count += 1
        let index = count
        return try await withCheckedThrowingContinuation { continuation in
            pending[index] = continuation
            for (target, observer) in observers where count >= target { observer.resume() }
            observers.removeAll { count >= $0.0 }
        }
    }
    func started(_ target: Int) async {
        if count >= target { return }
        await withCheckedContinuation { observers.append((target, $0)) }
    }
    func finish(_ index: Int, with result: Result<Data, Error>) { pending.removeValue(forKey: index)?.resume(with: result) }
}

/// Synchronous probe intentionally blocks only the detached decoder, so a test
/// can invalidate scope while ImageIO is in progress without blocking the UI.
nonisolated private final class PipelineDecodeProbe: @unchecked Sendable {
    private let condition = NSCondition()
    private var blocked: Bool
    private let blockingCalls: Int?
    private var sizes: [Int] = []
    private var mainCalls = 0
    private var milliseconds: Double = 0
    init(blocked: Bool, blockingCalls: Int? = nil) { self.blocked = blocked; self.blockingCalls = blockingCalls }
    var decodeMilliseconds: Double { condition.lock(); defer { condition.unlock() }; return milliseconds }
    var edges: [Int] { condition.lock(); defer { condition.unlock() }; return sizes }
    var mainThreadCount: Int { condition.lock(); defer { condition.unlock() }; return mainCalls }
    func release() { condition.lock(); blocked = false; condition.broadcast(); condition.unlock() }
    func decode(_ data: Data, edge: Int) throws -> CGImage {
        condition.lock()
        sizes.append(edge)
        if Thread.isMainThread { mainCalls += 1 }
        let call = sizes.count
        while blocked && (blockingCalls == nil || call <= blockingCalls!) { condition.wait() }
        condition.unlock()
        let start = ContinuousClock.now
        defer {
            let duration = start.duration(to: .now).components
            condition.lock()
            milliseconds += Double(duration.seconds) * 1000 + Double(duration.attoseconds) / 1e15
            condition.unlock()
        }
        return try PhotoImageCache.decode(data, edge: edge)
    }
}

extension PhotoPipelineTests {
    @Test func syntheticBeforeAfterDemandAndMainThreadEvidence() async throws {
        let data = try fixture()
        let beforeFetch = PipelineFetchGate()
        let beforeDecode = PipelineDecodeProbe(blocked: false)
        // Reproduce the previous miss path: each suspended consumer fetched and
        // synchronously decoded, without registering shared in-flight work.
        let before = (0..<5).map { _ in Task { @MainActor in
            let bytes = try await beforeFetch.data()
            return UIImage(cgImage: try beforeDecode.decode(bytes, edge: 2048))
        } }
        await beforeFetch.started(5)
        for index in 1...5 { await beforeFetch.finish(index, with: .success(data)) }
        for task in before { _ = try await task.value }
        #expect(await beforeFetch.count == 5)
        #expect(beforeDecode.edges.count == 5 && beforeDecode.mainThreadCount == 5)

        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let afterFetch = PipelineFetchGate()
        let afterDecode = PipelineDecodeProbe(blocked: false)
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in try await afterFetch.data() }), decode: afterDecode.decode)
        try await cache.configure(scope: scope, photos: [photo])
        let after = (0..<5).map { _ in Task { try await cache.image(photo: photo, use: .full) } }
        await afterFetch.started(1)
        // Keep the miss suspended long enough for all five consumers to join.
        for _ in 0..<20 { await Task.yield() }
        await afterFetch.finish(1, with: .success(data))
        for task in after { _ = try await task.value }
        #expect(await afterFetch.count == 1)
        #expect(afterDecode.edges.count == 1 && afterDecode.mainThreadCount == 0)
        print("PHOTO_PIPELINE_SYNTHETIC before downloads=5 decodes=5 mainDecodes=5 decodeMs=\(beforeDecode.decodeMilliseconds); after downloads=1 decodes=1 mainDecodes=0 decodeMs=\(afterDecode.decodeMilliseconds)")
    }
}


extension PhotoPipelineTests {
    @Test func obsoleteInvalidDecodeCannotRemoveReplacementBytes() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fetch = PipelineFetchGate()
        let probe = PipelineDecodeProbe(blocked: true, blockingCalls: 1)
        defer { probe.release() }
        let cache = PhotoImageCache(bytes: PhotoByteCache(root: root, fetch: { _ in try await fetch.data() }), decode: probe.decode)
        try await cache.configure(scope: scope, photos: [photo])
        let old = Task { try await cache.image(photo: photo, use: .full) }
        await fetch.started(1)
        await fetch.finish(1, with: .success(Data("invalid".utf8)))
        try await waitFor { probe.edges.count == 1 }
        let other = StoreScope(deployment: scope.deployment, userID: "other")
        try await cache.configure(scope: other, photos: [photo])
        let replacement = Task { try await cache.image(photo: photo, use: .full) }
        await fetch.started(2)
        let data = try fixture()
        await fetch.finish(2, with: .success(data))
        _ = try await replacement.value
        probe.release()
        await #expect(throws: PhotoByteCache.Failure.self) { try await old.value }
        let offline = PhotoByteCache(root: root, fetch: { _ in throw URLError(.notConnectedToInternet) })
        let revision = UUID()
        try await offline.configure(scope: other, photos: [photo], revision: revision)
        #expect(try await offline.data(photoID: photo.id, url: photo.variant(.full)!.url, revision: revision) == data)
    }
}

import MapLibre
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RouteColorRenderingTests {
    @Test(arguments: ["ordinary", "selected", "active"], ActivityCategory.allCases)
    func sportColorsReachRenderedPixels(state: String, category: ActivityCategory) async throws {
        let sport = try #require(category.sportTypes.first)
        try await assertRenderedColor(sport: sport.rawValue, state: state,
                                     expected: try #require(UIColor(named: category.assetName)))
    }

    @Test func unknownSportKeepsBlackFallback() async throws {
        try await assertRenderedColor(sport: "FutureSport", state: "ordinary", expected: .black)
    }

    private func assertRenderedColor(sport: String, state: String, expected: UIColor) async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("route-color-\(UUID()).json")
        try MapStyleProjection.globeJSON(CameraHarness.style).write(to: file, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: file) }
        let center = CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005)
        let camera = MLNMapCamera(lookingAtCenter: center, altitude: 1000, pitch: 0, heading: 0)
        let options = MLNMapSnapshotOptions(styleURL: file, camera: camera, size: CGSize(width: 128, height: 128))
        options.zoomLevel = 14
        options.scale = 1
        options.showsLogo = false
        options.showsAttribution = false
        let snapshotter = MLNMapSnapshotter(options: options)
        var coordinates = [CLLocationCoordinate2D(latitude: center.latitude, longitude: 8),
                           CLLocationCoordinate2D(latitude: center.latitude, longitude: 8.01)]
        let feature = MLNPolylineFeature(coordinates: &coordinates, count: UInt(coordinates.count))
        feature.attributes = ["id": "1", "sport_type": sport]
        let data: MLNShape
        if let type = SportType(rawValue: sport) {
            var activity = ActivityStoreSelectionTests.activity(1, sport: type)
            activity.coordinates = coordinates
            data = RouteSource.data(for: [activity])
        } else {
            data = MLNShapeCollectionFeature(shapes: [feature])
        }
        let delegate = RouteColorSnapshotDelegate(routes: RouteLayers(
            data: data, visibleIDs: [1],
            selectedIDs: state == "selected" ? [1] : [], activeID: state == "active" ? 1 : nil))
        snapshotter.delegate = delegate
        let result: SnapshotResult = await withCheckedContinuation { continuation in
            snapshotter.start { snapshot, error in
                continuation.resume(returning: SnapshotResult(snapshot: snapshot, error: error))
            }
        }
        if let error = result.error { throw error }
        let snapshot = try #require(result.snapshot)
        let cgImage = try #require(snapshot.image.cgImage)
        var pixels = [UInt8](repeating: 0, count: cgImage.width * cgImage.height * 4)
        try pixels.withUnsafeMutableBytes { bytes in
            let context = try #require(CGContext(data: bytes.baseAddress, width: cgImage.width, height: cgImage.height,
                bitsPerComponent: 8, bytesPerRow: cgImage.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))
        }
        let point = snapshot.point(for: center)
        let offset = (Int(point.y.rounded()) * cgImage.width + Int(point.x.rounded())) * 4
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        expected.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        let rendered = Array(pixels[offset..<(offset + 3)]).map(Int.init)
        let wanted = [red, green, blue].map { Int(($0 * 255).rounded()) }
        #expect(zip(rendered, wanted).allSatisfy { abs($0 - $1) <= 3 },
                "\(sport) / \(state): rendered RGB \(rendered), expected \(wanted)")
        withExtendedLifetime(delegate) {}
    }
}

@MainActor
private final class RouteColorSnapshotDelegate: NSObject, MLNMapSnapshotterDelegate {
    let routes: RouteLayers
    init(routes: RouteLayers) { self.routes = routes }
    func mapSnapshotter(_ snapshotter: MLNMapSnapshotter, didFinishLoading style: MLNStyle) {
        routes.sync(style: style)
    }
}

// MapLibre's immutable result lacks Sendable annotations. It is consumed only
// on the main actor after its completion callback has finished producing it.
nonisolated private struct SnapshotResult: @unchecked Sendable {
    let snapshot: MLNMapSnapshot?
    let error: Error?
}

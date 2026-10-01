import MapboxMaps
import SwiftUI
import Testing
import UIKit
import Vision
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedMapAttributionTests {
    @Test(arguments: ["raster", "vector"])
    func sourceCreditsStayInOneNativeInfoMenu(kind: String) async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        if kind == "raster" {
            store.mapContext.baseStyle = .shared(.init(id: "offline-swisstopo", label: "Swisstopo",
                source: .raster(url: "file:///nonexistent/{z}/{x}/{y}.png", tileSize: 256),
                visibleByDefault: false, attribution: "© swisstopo"))
        }
        // Inline source metadata exercises the same SDK credit collection as
        // vector TileJSON and raster overlays, without loading remote tiles.
        let style = ##"{"version":8,"sources":{"swiss":{"type":"vector","tiles":[],"attribution":"BASE_CREDIT"},"duplicate":{"type":"vector","tiles":[],"attribution":"BASE_CREDIT"},"overlay":{"type":"raster","tiles":[],"attribution":"© NVE"}},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##.replacingOccurrences(of: "BASE_CREDIT", with: kind == "raster" ? "© NVE" : "© swisstopo")
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        let host = UIHostingController(rootView: MapScreen(store: store)
            .environment(\.mapStyleOverride, MapStyle(json: style)))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        host.view.frame = window.bounds
        try await waitUntil { self.descendants(MapView.self, in: host.view).first?.mapboxMap.isStyleLoaded == true }
        try await Task.sleep(for: .milliseconds(250))
        let map = try #require(descendants(MapView.self, in: host.view).first)
        #expect(!map.ornaments.logoView.isHidden && !map.ornaments.attributionButton.isHidden)
        let info = try #require(descendants(UIButton.self, in: map.ornaments.attributionButton).first)
        #expect(map.ornaments.attributionButton.bounds.width >= 44 && map.ornaments.attributionButton.bounds.height >= 44)
        let visible = try snapshot(host.view, name: "map-attribution-\(kind)")
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try #require(visible.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(!text.lowercased().contains("swisstopo"), "No extra provider badge on the map: \(text)")
        info.sendActions(for: .primaryActionTriggered)
        try await waitUntil { host.presentedViewController is UIAlertController }
        let menu = try #require(host.presentedViewController as? UIAlertController)
        let titles = menu.actions.compactMap(\.title)
        #expect(titles.filter { $0.lowercased().contains("swisstopo") }.count == 1,
                "Swisstopo appears once in the info menu: \(titles)")
        #expect(titles.contains { $0.contains("NVE") }, "Overlay metadata remains credited: \(titles)")
        #expect(titles.contains { $0.contains("Telemetry") })
        #expect(titles.contains { $0.contains("Privacy") })
        try await Task.sleep(for: .milliseconds(350))
        _ = try snapshot(window, name: "map-sources-\(kind)")
        menu.dismiss(animated: false)
    }

    private func descendants<T: UIView>(_ type: T.Type, in view: UIView) -> [T] {
        ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap { descendants(type, in: $0) }
    }

    private func waitUntil(_ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(10)
        while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
        try #require(condition(), "Native attribution UI did not become ready")
    }

    private func snapshot(_ view: UIView, name: String) throws -> UIImage {
        view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: view.bounds).image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        let directory = URL(fileURLWithPath: "/tmp/activitymap-attribution-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
        return image
    }
}

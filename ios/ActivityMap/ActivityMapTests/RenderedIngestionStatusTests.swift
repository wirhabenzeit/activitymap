import SwiftUI
import Testing
import UIKit
import Vision
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedIngestionStatusTests {
    @Test(arguments: ["phone-light", "phone-dark", "large-text", "ipad"])
    func serverCoverageIsReadable(layout: String) async throws {
        let suite = "ingestion-render-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let shared = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appending(path: "shared/ingestion-status-fixtures.v1.json")
        let corpus = try ActivityMapAPI.makeDecoder().decode(IngestionStatusTests.Corpus.self, from: Data(contentsOf: shared))
        let fixture = try #require(corpus.scenarios.first?.status)
        let controller = IngestionStatusController(defaults: defaults) { _ in fixture }
        let session = SyncFixtures.session()
        controller.activate(session)
        await controller.refresh(session)
        let root = NavigationStack {
            Form { IngestionStatusSection(session: SyncFixtures.session(verified: false), controller: controller) }
                .navigationTitle("Settings")
        }
        .environment(\.colorScheme, layout == "phone-dark" ? .dark : .light)
        .environment(\.dynamicTypeSize, layout == "large-text" ? .accessibility2 : .large)
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let old = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        let size = layout == "ipad" ? CGSize(width: 768, height: 1024) : CGSize(width: 375, height: 812)
        window.frame = CGRect(origin: .zero, size: size)
        let host = UIHostingController(rootView: root)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; old?.makeKeyAndVisible() }
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Settings"))
        #expect(text.contains("History") && text.contains("imported"))
        let directory = URL(fileURLWithPath: "/tmp/activitymap-ingestion-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appending(path: "\(layout).png"))
    }
}

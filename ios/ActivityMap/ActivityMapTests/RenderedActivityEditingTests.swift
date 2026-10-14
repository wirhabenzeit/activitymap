import SwiftUI
import Testing
import UIKit
import Vision
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedActivityEditingTests {
    @Test func wideDetailExposesEditBesideMapNavigation() async throws {
        let original = try Fixtures.activity(["id": "1", "description": "A day in the mountains"])
        let source = SyncFixtures.complete([original])
        let store = ActivityStore()
        let controller = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 820, height: 1180)
        let host = UIHostingController(rootView: ActivityDetailPanel(store: store, activityID: 1))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; oldWindow?.makeKeyAndVisible() }
        host.view.frame = window.bounds; host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(300))
        let directory = URL(fileURLWithPath: "/tmp/activitymap-editing-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        try image.pngData()?.write(to: directory.appending(path: "detail-entry.png"))
        let recognize = VNRecognizeTextRequest(); recognize.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([recognize])
        let text = (recognize.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Edit") && text.contains("Show on map"))
        #expect(store.activities.first?.name == original.name)
    }

    @Test(arguments: ["phone", "tablet", "large-text", "error"])
    func formRendersPrefilledFieldsAndReachableActions(scenario: String) async throws {
        let original = try Fixtures.activity(["description": "A day in the mountains"])
        let edits = ScriptedEditSource([.failure(.server(code: "validation_failed", message: "Choose a valid name", status: 400, requestID: nil, retryable: false))])
        let syncSource = SyncFixtures.complete([original])
        let controller = SyncController(activities: ActivityStore(), source: { _ in syncSource }, editSource: { _ in edits }, invalidate: { _ in })
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        let model = ActivityEditModel(activity: try StoredModelMapper.activity(original))
        if scenario == "error" {
            model.name = "Unsaved name"
            await model.save(using: controller.editing)
        }
        let size = scenario == "tablet" ? CGSize(width: 820, height: 1180) : CGSize(width: 390, height: 844)
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        let host = UIHostingController(rootView: ActivityEditForm(model: model, service: controller.editing)
            .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        host.view.frame = window.bounds; host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(350))
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let directory = URL(fileURLWithPath: "/tmp/activitymap-editing-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appending(path: "\(scenario).png"))
        let recognize = VNRecognizeTextRequest(); recognize.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([recognize])
        let text = (recognize.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Edit activity") && text.contains("Cancel") && text.contains("Save"), "\(scenario): \(text)")
        #expect(text.contains("mountains") && text.contains("Hike"), "\(scenario): \(text)")
        if scenario == "error" { #expect(text.contains("Choose a valid name") && text.contains("Unsaved name")) }
    }
}

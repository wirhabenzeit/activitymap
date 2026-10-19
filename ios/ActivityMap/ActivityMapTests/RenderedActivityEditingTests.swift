import SwiftUI
import Testing
import UIKit
import Vision
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedActivityEditingTests {
    @Test(arguments: ["phone", "tablet", "dark", "large-text"])
    func savingOverlayKeepsFormLayoutAndUnblocksAfterFailure(scenario: String) async throws {
        let original = try Fixtures.activity(["name": "Afternoon ride", "sport_type": "Ride", "description": NSNull()])
        let source = SyncFixtures.complete([original])
        let edits = GatedEditSource()
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, editSource: { _ in edits }, invalidate: { _ in })
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        let model = ActivityEditModel(activity: try StoredModelMapper.activity(original))
        model.name = "Zürich – Gabelbach"
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.overrideUserInterfaceStyle = scenario == "dark" ? .dark : .light
        window.frame = CGRect(origin: .zero, size: scenario == "tablet" ? CGSize(width: 820, height: 1180) : CGSize(width: 390, height: 844))
        let host = UIHostingController(rootView: ActivityEditForm(model: model, service: controller.editing)
            .environment(\.colorScheme, scenario == "dark" ? .dark : .light)
            .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; oldWindow?.makeKeyAndVisible() }
        host.view.frame = window.bounds; host.view.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(250))
        func snapshot() -> UIImage {
            UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
                host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
            }
        }
        func recognized(_ image: UIImage) throws -> [VNRecognizedTextObservation] {
            let request = VNRecognizeTextRequest(); request.recognitionLevel = .accurate
            try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
            return request.results ?? []
        }
        let before = try recognized(snapshot())
        let save = Task { await model.save(using: controller.editing) }
        await edits.waitForRequest()
        defer { Task { await edits.fail(.transport("Test finished")) } }
        #expect(model.isSaving && !model.canSave())
        try await Task.sleep(for: .milliseconds(300))
        let loading = snapshot()
        let directory = URL(fileURLWithPath: "/tmp/activitymap-editing-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try loading.pngData()?.write(to: directory.appending(path: "saving-\(scenario).png"))
        let observations = try recognized(loading)
        let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Saving to Strava"), "\(scenario): \(text)")
        let oldName = try #require(before.first { $0.topCandidates(1).first?.string == "Name" })
        let name = try #require(observations.first { $0.topCandidates(1).first?.string == "Name" })
        #expect(abs(name.boundingBox.midY - oldName.boundingBox.midY) < 0.01, "Saving must not insert a form row or move fields")
        await edits.fail(.server(code: "validation_failed", message: "Choose a valid name", status: 400, requestID: nil, retryable: false))
        await save.value
        #expect(!model.isSaving && model.canSave() && model.name == "Zürich – Gabelbach")
        #expect(model.errorMessage == "Choose a valid name")
        try await Task.sleep(for: .milliseconds(200))
        if scenario == "large-text" {
            func scrolls(_ view: UIView) -> [UIScrollView] {
                ((view as? UIScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scrolls)
            }
            let scroll = try #require(scrolls(host.view).filter { $0.bounds.height > 100 }.max { $0.bounds.height < $1.bounds.height })
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x,
                y: max(-scroll.adjustedContentInset.top, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)), animated: false)
            try await Task.sleep(for: .milliseconds(200))
        }
        let recovered = try recognized(snapshot()).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(!recovered.contains("Saving to Strava") && recovered.contains("Choose a valid name"))
    }

    @Test func wideDetailExposesEditAndMapInFooter() async throws {
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
        func scrolls(_ view: UIView) -> [UIScrollView] {
            ((view as? UIScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scrolls)
        }
        let scroll = try #require(scrolls(host.view).max { $0.bounds.height < $1.bounds.height })
        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x,
            y: max(-scroll.adjustedContentInset.top, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)), animated: false)
        try await Task.sleep(for: .milliseconds(200))
        let directory = URL(fileURLWithPath: "/tmp/activitymap-editing-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        try image.pngData()?.write(to: directory.appending(path: "detail-entry.png"))
        let recognize = VNRecognizeTextRequest(); recognize.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([recognize])
        let text = (recognize.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Edit activity") && text.contains("Show on map"))
        #expect(store.activities.first?.name == original.name)
    }

    @Test(arguments: ["phone", "tablet", "large-text", "error", "inherited-white", "dark", "changed"])
    func formRendersPrefilledFieldsAndReachableActions(scenario: String) async throws {
        let original = try Fixtures.activity(["name": "Evening Ride", "sport_type": "Ride", "description": "Beautiful evening 😍"])
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
        if scenario == "changed" { model.name = "Evening ride by the lake" }
        let size = scenario == "tablet" ? CGSize(width: 820, height: 1180) : CGSize(width: 390, height: 844)
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.overrideUserInterfaceStyle = scenario == "dark" ? .dark : .light
        window.frame = CGRect(origin: .zero, size: size)
        let host = UIHostingController(rootView: ActivityEditForm(model: model, service: controller.editing)
            .foregroundStyle(scenario == "inherited-white" ? Color.white : Color.primary)
            .tint(scenario == "inherited-white" ? Color.white : Color.pink)
            .environment(\.colorScheme, scenario == "dark" ? .dark : .light)
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
        #expect(text.contains("Beautiful evening") && text.contains("Ride") && text.contains("Name"), "\(scenario): \(text)")
        if scenario == "error" { #expect(text.contains("Choose a valid name") && text.contains("Unsaved name")) }
    }
}

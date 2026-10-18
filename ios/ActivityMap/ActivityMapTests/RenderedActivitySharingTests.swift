import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedActivitySharingTests {
    @Test(arguments: ["phone", "tablet", "large-text", "dark"])
    func reviewAndCreatedLinkAdaptToNativePresentation(scenario: String) async throws {
        let activity = try StoredModelMapper.activity(Fixtures.activity(["id": "1", "name": "Zürich – Gabelbach"] ))
        let model = ActivityShareModel(activities: [activity])
        let service = ActivitySharingService()
        service.session = { SyncFixtures.session() }
        service.source = { _ in ScriptedShareLinksSource() }
        let host = try SharingHarness(root: ActivityShareView(model: model)
            .environment(\.activitySharing, service)
            .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large)
            .environment(\.colorScheme, scenario == "dark" ? .dark : .light),
            size: scenario == "tablet" ? CGSize(width: 820, height: 1180) : CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(300))
        try host.save("configure-\(scenario)")
        #expect(host.element(label: "Share activities") != nil)
        model.step = .review
        try await Task.sleep(for: .milliseconds(300))
        try host.save("review-\(scenario)")
        #expect(host.element(label: "Create this link?") != nil)
        await model.create(using: service)
        try await Task.sleep(for: .milliseconds(300))
        try host.save("created-\(scenario)")
        let share = try #require(host.element(label: "Share link"))
        #expect(share.accessibilityFrame.width >= 44 && share.accessibilityFrame.height >= 44)
        #expect(host.element(label: "Your links") != nil)
    }

    @Test(arguments: [320.0, 390.0, 820.0])
    func selectionFooterKeepsShareAndClearReachable(width: Double) async throws {
        let activities = try (1...3).map { try StoredModelMapper.activity(Fixtures.activity(["id": String($0)])) }
        let store = ActivityStore(activities: activities)
        store.selectedTab = .list
        store.replaceSelection(with: [1, 2])
        let host = try SharingHarness(root: VStack {
            Spacer()
            BrowseListFooter(store: store)
        }.environment(\.verticalSizeClass, .regular), size: CGSize(width: width, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(300))
        let share = try #require(host.element(label: "Share selected activities"))
        let clear = try #require(host.element(label: "Clear selection"))
        #expect(share.accessibilityFrame.width >= 44 && clear.accessibilityFrame.minX >= share.accessibilityFrame.maxX)
        #expect(share.accessibilityFrame.minX >= 0 && clear.accessibilityFrame.maxX <= width)
        try host.save("footer-\(Int(width))")
        store.clearSelection()
        try await Task.sleep(for: .milliseconds(200))
        #expect(host.element(label: "Share selected activities") == nil)
    }

    @Test(arguments: [320.0, 390.0])
    func mapHeaderKeepsFitShareAndClearReachable(width: Double) async throws {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2)])
        store.replaceSelection(with: [1, 2])
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        let host = try SharingHarness(root: RoutePickerSheet(picker: picker, store: store, isSidePanel: true),
                                      size: CGSize(width: width, height: 700))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(300))
        let fit = try #require(host.element(label: "Fit selection"))
        let share = try #require(host.element(label: "Share selected activities"))
        let clear = try #require(host.element(label: "Clear selection"))
        #expect(fit.accessibilityFrame.maxX <= share.accessibilityFrame.minX)
        #expect(share.accessibilityFrame.width >= 44 && clear.accessibilityFrame.minX >= share.accessibilityFrame.maxX)
        #expect(clear.accessibilityFrame.maxX <= width)
        try host.save("map-header-\(Int(width))")
    }
}

@MainActor
private final class SharingHarness {
    let window: UIWindow
    let host: UIViewController
    let previous: UIWindow?
    init(root: some View, size: CGSize) throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        previous = scene.keyWindow
        window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        host = UIHostingController(rootView: root)
        window.rootViewController = host; window.makeKeyAndVisible()
        host.view.frame = window.bounds; host.view.layoutIfNeeded()
    }
    func close() { window.isHidden = true; window.rootViewController = nil; previous?.makeKeyAndVisible() }
    func save(_ name: String) throws {
        let directory = URL(fileURLWithPath: "/tmp/activitymap-sharing-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        try image.pngData()?.write(to: directory.appending(path: "\(name).png"))
    }
    func element(label: String) -> NSObject? {
        var visited: Set<ObjectIdentifier> = []
        func visit(_ object: NSObject) -> NSObject? {
            guard visited.insert(ObjectIdentifier(object)).inserted else { return nil }
            if let view = object as? UIView, view.isHidden || view.alpha == 0 { return nil }
            if object.accessibilityLabel == label, !object.accessibilityFrame.isEmpty { return object }
            let count = object.accessibilityElementCount()
            if count > 0 && count < 1000 {
                for index in 0..<count {
                    if let child = object.accessibilityElement(at: index) as? NSObject, let found = visit(child) { return found }
                }
            }
            if let view = object as? UIView {
                for child in view.subviews { if let found = visit(child) { return found } }
            }
            return nil
        }
        return visit(host.view)
    }
}

import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

extension RenderedRoutePickingTests {
    @Test(arguments: ["phone", "tablet", "large-text", "no-gps", "summary", "dark"])
    func activityActionRowsRenderAndExplainRouteQuality(scenario: String) async throws {
        var activity = try StoredModelMapper.activity(Fixtures.activity())
        if scenario == "no-gps" { activity.coordinates = []; activity.geometrySource = .none }
        if scenario == "summary" { activity.geometrySource = .summary }
        let size = scenario == "tablet" ? CGSize(width: 820, height: 1180) : CGSize(width: 375, height: 844)
        let host = try ActionsHarness(root: AnyView(ScrollView {
            ActivityDetailContent(activity: activity)
                .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large)
                .environment(\.colorScheme, scenario == "dark" ? .dark : .light)
        }.background(AppTheme.surface)), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        let stravaElement = host.element("Open in Strava")
        let gpxElement = host.element("Export GPX")
        let strava = try #require(stravaElement)
        let gpx = try #require(gpxElement)
        #expect(strava.accessibilityFrame.height >= 44 && gpx.accessibilityFrame.height >= 44)
        #expect(gpx.accessibilityFrame.width <= size.width)
        #expect(gpx.accessibilityTraits.contains(.notEnabled) == (scenario == "no-gps"))
        #expect(!strava.accessibilityTraits.contains(.notEnabled))
        let label = gpx.accessibilityLabel ?? ""
        #expect(label.contains(scenario == "no-gps" ? "No GPS route" : "Route only"))
        host.reveal(gpx.accessibilityFrame)
        try await Task.sleep(for: .milliseconds(150))
        #expect(host.element("ACTIVITY ACTIONS") == nil && host.element("Activity actions") == nil)
        if scenario != "large-text" {
            let metadataElement = host.element("Activity, Geometry status")
            let metadata = try #require(metadataElement)
            let visibleStravaElement = host.element("Open in Strava")
            let visibleStrava = try #require(visibleStravaElement)
            #expect(metadata.accessibilityFrame.maxY < visibleStrava.accessibilityFrame.minY,
                    "Both action rows belong after the final measurement group")
        }
        try host.save("rows-\(scenario)")
    }

    @Test func activityGPXShareUsesNativePresentationAndCleansUpOnCancel() async throws {
        let activity = try StoredModelMapper.activity(Fixtures.activity())
        let size = UIDevice.current.userInterfaceIdiom == .pad ? CGSize(width: 820, height: 1180) : CGSize(width: 390, height: 844)
        let host = try ActionsHarness(root: AnyView(ActivityDetailActions(activity: activity).padding(16)), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        let before = try exportDirectories()
        for pass in 0..<2 {
            let buttonElement = host.element("Export GPX")
            let button = try #require(buttonElement)
            #expect(button.accessibilityActivate())
            let presenter = try await waitForShare(host)
            let share = try #require(presenter.activityController)
            let created = try exportDirectories().subtracting(before)
            let directory = try #require(created.first)
            let url = directory.appendingPathComponent("Morning-hike.gpx")
            #expect(FileManager.default.fileExists(atPath: url.path), "The file must remain available during sharing")
            if UIDevice.current.userInterfaceIdiom == .pad {
                #expect(share.presentationController is UIPopoverPresentationController)
                let popover = try #require(share.popoverPresentationController)
                #expect(popover.sourceView === presenter.view)
                #expect(popover.sourceRect == presenter.view.bounds && popover.sourceRect.height >= 44)
            }
            try host.save("share-\(UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone")-\(pass)")
            let completion = share.completionWithItemsHandler
            await withCheckedContinuation { continuation in share.dismiss(animated: false) { continuation.resume() } }
            completion?(nil, false, nil, nil)
            try await Task.sleep(for: .milliseconds(150))
            #expect(try exportDirectories() == before)
            let availableElement = host.element("Export GPX")
            let available = try #require(availableElement)
            #expect(!available.accessibilityTraits.contains(.notEnabled))
        }
        let lastButtonElement = host.element("Export GPX")
        #expect(try #require(lastButtonElement).accessibilityActivate())
        _ = try await waitForShare(host)
        #expect(try exportDirectories().count == before.count + 1)
        host.host.rootView = AnyView(EmptyView())
        for _ in 0..<40 {
            if try exportDirectories() == before { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(try exportDirectories() == before, "Leaving detail must also release the share controller's file")
    }

    private func exportDirectories() throws -> Set<URL> {
        Set(try FileManager.default.contentsOfDirectory(at: FileManager.default.temporaryDirectory,
            includingPropertiesForKeys: nil).filter { $0.lastPathComponent.hasPrefix("activitymap-gpx-") })
    }

    @Test func activityGPXIncludesOfflineSampledElevationAndHandlesInvalidation() async throws {
        let cached = try GPXFixtures.cached()
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON().utf8))
        let dto = try Fixtures.activity(["streams": metadata])
        let activity = try StoredModelMapper.activity(dto)
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(dto)], scope: Fixtures.scope)
        let fence = await storage.streamFence()
        _ = try await storage.saveStreamSummary(cached.dto, scope: Fixtures.scope, fence: fence)
        let source = SummarySourceProbe([])
        let loader = StreamSummaryLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        await loader.load(activityID: String(activity.id))
        let host = try ActionsHarness(root: AnyView(ScrollView {
            ActivityDetailContent(activity: activity, streamSummaries: loader)
        }), size: CGSize(width: 390, height: 844))
        defer { host.close() }
        var element: NSObject?
        for _ in 0..<100 {
            element = host.element("Export GPX")
            if element?.accessibilityLabel?.contains("with elevation") == true { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let button = try #require(element)
        #expect(button.accessibilityLabel?.contains("Route with elevation") == true)
        host.reveal(button.accessibilityFrame)
        try host.save("rows-sampled-elevation")
        let before = try exportDirectories()
        #expect(button.accessibilityActivate())
        let presenter = try await waitForShare(host)
        let share = try #require(presenter.activityController)
        let directory = try #require(try exportDirectories().subtracting(before).first)
        let xml = try String(contentsOf: directory.appendingPathComponent("Morning-hike.gpx"), encoding: .utf8)
        #expect(xml.contains("<ele>400.0</ele>") && xml.contains("<ele>450.0</ele>"))
        #expect(xml.contains("sampled route with averaged elevation"))
        #expect(!xml.contains("<time>"))
        let completion = share.completionWithItemsHandler
        await withCheckedContinuation { continuation in share.dismiss(animated: false) { continuation.resume() } }
        completion?(nil, false, nil, nil)
        loader.reset()
        try await Task.sleep(for: .milliseconds(150))
        #expect(host.element("Export GPX")?.accessibilityLabel?.contains("with elevation") == false)
        #expect(await source.calls == 0, "Export only reads already cached elevation; it never fetches streams")
        #expect(try exportDirectories() == before)
    }

    private func waitForShare(_ host: ActionsHarness) async throws -> ActivityGPXSharePresenter.Controller {
        for _ in 0..<100 {
            if let controller = host.sharePresenter(), controller.activityController?.presentingViewController != nil,
               controller.activityController?.isBeingPresented == false { return controller }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw CocoaError(.executableNotLoadable)
    }
}

@MainActor private final class ActionsHarness {
    let host: UIHostingController<AnyView>
    let window: UIWindow
    let oldWindow: UIWindow?

    init(root: AnyView, size: CGSize) throws {
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

    func element(_ labelPrefix: String) -> NSObject? {
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
        return visit(host.view)
    }

    func sharePresenter() -> ActivityGPXSharePresenter.Controller? {
        func visit(_ controller: UIViewController) -> ActivityGPXSharePresenter.Controller? {
            if let controller = controller as? ActivityGPXSharePresenter.Controller { return controller }
            return controller.children.lazy.compactMap(visit).first
        }
        return visit(host)
    }

    func reveal(_ frame: CGRect) {
        func visit(_ view: UIView) -> UIScrollView? {
            if let view = view as? UIScrollView { return view }
            return view.subviews.lazy.compactMap(visit).first
        }
        if let scroll = visit(host.view) {
            scroll.setContentOffset(CGPoint(x: 0, y: max(0, scroll.contentOffset.y + frame.maxY - window.bounds.maxY + 24)), animated: false)
        }
    }

    func save(_ name: String) throws {
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let directory = URL(fileURLWithPath: "/tmp/activitymap-actions-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
    }

    func close() {
        host.dismiss(animated: false)
        window.isHidden = true
        window.rootViewController = nil
        oldWindow?.makeKeyAndVisible()
    }
}

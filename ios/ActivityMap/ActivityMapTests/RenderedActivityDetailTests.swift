import SwiftUI
import CoreLocation
import MapboxMaps
import Testing
import UIKit
import Vision
@testable import ActivityMap

extension RenderedRoutePickingTests {
    @Test(arguments: ["landscape", "landscape-large-text", "tablet"])
    func customPanelScrollsToBottomEdgeWithSafeContentInset(scenario: String) async throws {
        var activity = ActivityStoreSelectionTests.activity(1)
        activity.name = "A long activity title along the river and through the forest"
        activity.description = String(repeating: "A long description with details from the route. ", count: 60)
        let store = ActivityStore(activities: [activity, ActivityStoreSelectionTests.activity(2)])
        store.replaceSelection(with: [1, 2])
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        picker.showDetail(1, store: store, motion: .none)
        let size = scenario == "tablet" ? CGSize(width: 820, height: 1180) : CGSize(width: 844, height: 390)
        let bottom: CGFloat = 21
        let usable = CGSize(width: size.width, height: size.height - bottom)
        let largeText = scenario == "landscape-large-text"
        let host = try DetailHarness(root: MapResultsContainer(picker: picker, store: store, size: usable,
            topInset: 44, bottomInset: bottom, largeText: largeText)
            .environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large)
            .ignoresSafeArea(), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(300))
        let pager = try #require(host.controllers(of: UIPageViewController.self).first)
        let page = try #require(pager.viewControllers?.first as? MapActivityPager.Page)
        func scrolls(_ view: UIView) -> [UIScrollView] {
            ((view as? UIScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scrolls)
        }
        let scroll = try #require(scrolls(page.view).first)
        let viewport = scroll.convert(scroll.bounds, to: host.host.view)
        #expect(viewport.height >= 100, "Short landscapes must have a usable detail viewport: \(viewport)")
        #expect(abs(viewport.maxY - size.height) < 1, "Content must scroll through the bottom safe area, without a fixed blank strip: \(viewport)")
        scroll.setContentOffset(CGPoint(x: 0, y: 300), animated: false)
        try await Task.sleep(for: .milliseconds(150))
        let offset = scroll.contentOffset
        picker.detent = .compact
        try await Task.sleep(for: .milliseconds(250))
        picker.detent = .expanded
        try await Task.sleep(for: .milliseconds(250))
        #expect(pager.viewControllers?.first === page)
        #expect(scroll.contentOffset == offset, "Resizing must retain the detail's scroll position")
        let end = max(-scroll.adjustedContentInset.top,
                      scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
        scroll.setContentOffset(CGPoint(x: 0, y: end), animated: false)
        try await Task.sleep(for: .milliseconds(150))
        let image = host.snapshot()
        try host.save(image, name: "panel-bottom-\(scenario)")
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Geometry status"), "The final grouped content row must be visible at the end of scrolling: \(text)")
        let lowestText = (request.results ?? []).map(\.boundingBox.minY).min() ?? 0
        #expect(lowestText * size.height >= bottom - 1, "Final text must still stop above the home indicator")
        #expect(store.mapContext.pendingRequest == nil)
    }

    @Test func customResultsScrollThroughBottomInset() async throws {
        var activities = (1...20).map { ActivityStoreSelectionTests.activity($0) }
        activities[0].name = "Last selected route"
        let store = ActivityStore(activities: activities)
        store.replaceSelection(with: Array(1...20))
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        let size = CGSize(width: 844, height: 390)
        let host = try DetailHarness(root: MapResultsContainer(picker: picker, store: store,
            size: CGSize(width: size.width, height: size.height - 21), topInset: 44,
            bottomInset: 21, largeText: false).ignoresSafeArea(), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(300))
        let scroll = try #require(host.descendants(of: UIScrollView.self).first)
        #expect(abs(scroll.convert(scroll.bounds, to: host.host.view).maxY - size.height) < 1)
        try host.save(host.snapshot(), name: "panel-results-bottom-edge")
        scroll.setContentOffset(CGPoint(x: 0, y: scroll.contentSize.height - scroll.bounds.height
                                       + scroll.adjustedContentInset.bottom), animated: false)
        try await Task.sleep(for: .milliseconds(200))
        let image = host.snapshot()
        try host.save(image, name: "panel-results-last-row")
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Last selected route"))
    }

    @Test func customPanelHandleKeepsItsTrailingPosition() async throws {
        let store = ActivityStore(activities: (1...6).map { ActivityStoreSelectionTests.activity($0) })
        store.replaceSelection(with: Array(1...6))
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        picker.detent = .compact
        var handleFrame = CGRect.zero
        let handle = Color.gray.frame(width: 60, height: 44)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { handleFrame = $0 }
        let host = try DetailHarness(root: RoutePickerSheet(picker: picker, store: store, isSidePanel: true,
            panelHandle: AnyView(handle)).ignoresSafeArea(), size: CGSize(width: 330, height: 300))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        let initial = handleFrame
        #expect(initial.width == 60 && initial.maxX == 318)
        for state in ["results", "detail", "compact-detail", "expanded-detail", "back"] {
            switch state {
            case "results", "expanded-detail": picker.detent = .expanded
            case "detail": picker.showDetail(1, store: store, motion: .none)
            case "compact-detail": picker.detent = .compact
            default: picker.showResults()
            }
            try await Task.sleep(for: .milliseconds(250))
            #expect(handleFrame.minX == initial.minX && handleFrame.maxX == initial.maxX,
                    "The grabber must stay under the same finger in \(state)")
        }
    }

    @Test func detailUpdatesInPlaceAndHandlesDeletion() async throws {
        var activity = try StoredModelMapper.activity(Fixtures.activity([
            "sport_type": "Ride", "name": "Morning ride", "description": "Along the river", "distance": 31200,
            "elapsed_time": 7200, "average_heartrate": 124, "max_heartrate": NSNull(),
            "average_watts": NSNull(), "max_watts": 0,
        ]))
        let store = ActivityStore(activities: [activity])
        let host = try DetailHarness(root: ActivityDetailView(store: store, activityID: activity.id), size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        let before = host.snapshot()
        activity.name = "Updated ride after sync"
        activity.distance = 48200
        store.activities = [activity]
        try await Task.sleep(for: .milliseconds(200))
        let updated = host.snapshot()
        #expect(before.pngData() != updated.pngData(), "An open detail must redraw committed changes to the same activity ID")
        try host.save(updated, name: "detail-updated")
        store.activities = []
        try await Task.sleep(for: .milliseconds(200))
        let removed = host.snapshot()
        #expect(updated.pngData() != removed.pngData(), "Deleted activity must not leave its old metrics/actions visible")
        try host.save(removed, name: "detail-deleted")
    }

    @Test func mapResultsBackRetainsScrollAndBrowsingContext() async throws {
        let store = ActivityStore(activities: (1...60).map { ActivityStoreSelectionTests.activity($0) })
        store.replaceSelection(with: Array(1...60))
        store.inspect(5)
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        let host = try DetailHarness(root: RoutePickerSheet(picker: picker, store: store, isSidePanel: false), size: CGSize(width: 375, height: 500))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        let results = try #require(host.descendants(of: UIScrollView.self).first { $0.contentSize.height > $0.bounds.height + 100 })
        results.setContentOffset(CGPoint(x: 0, y: 900), animated: false)
        try await Task.sleep(for: .milliseconds(100))
        let offset = results.contentOffset
        let selection = store.selectedActivityIDs
        let request = store.mapContext.pendingRequest
        picker.showDetail(20, store: store)
        try await Task.sleep(for: .milliseconds(500))
        #expect(host.descendants(of: UIScrollView.self).contains { $0 === results }, "Results remain mounted behind the detail destination")
        #expect(picker.detailID == 20 && store.activeActivityID == 20)
        try host.save(host.snapshot(), name: "map-flow-detail")
        picker.showResults()
        try await Task.sleep(for: .milliseconds(200))
        #expect(results.contentOffset == offset, "Back restores the exact results scroll position")
        #expect(picker.detailID == nil && picker.isPresented)
        #expect(store.selectedActivityIDs == selection && store.activeActivityID == 20 && store.inspectedActivityID == 5)
        #expect(store.mapContext.pendingRequest == request, "Moving between results and detail does not request a map refit")
        try host.save(host.snapshot(), name: "map-flow-results-return")
    }

    @Test(arguments: ["tablet", "landscape", "large-text"])
    func fixedEdgePanelRetainsDetailAndSelectionAcrossCollapse(scenario: String) async throws {
        var activities = (1...60).map { ActivityStoreSelectionTests.activity($0) }
        activities[0].name = "50k detour due to a 1k construction site => change of plans"
        let store = ActivityStore(activities: activities)
        store.replaceSelection(with: Array(1...60))
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        picker.showDetail(1, store: store, motion: .none)
        let size = scenario == "landscape" ? CGSize(width: 844, height: 390) : CGSize(width: 820, height: 1180)
        let largeText = scenario == "large-text"
        let host = try DetailHarness(root: MapResultsContainer(picker: picker, store: store, size: size,
            topInset: 44, bottomInset: 0, largeText: largeText)
            .environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large).ignoresSafeArea(), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(250))
        let pager = try #require(host.controllers(of: UIPageViewController.self).first)
        let page = try #require(pager.viewControllers?.first)
        let before = pager.view.bounds.height
        let selection = store.selectedActivityIDs
        try host.save(host.snapshot(), name: "fixed-panel-\(scenario)-expanded")
        picker.detent = .compact
        try await Task.sleep(for: .milliseconds(200))
        #expect(host.controllers(of: UIPageViewController.self).first === pager)
        #expect(pager.viewControllers?.first === page)
        #expect(picker.detailID == 1 && store.selectedActivityIDs == selection)
        #expect(store.mapContext.pendingRequest == nil)
        try host.save(host.snapshot(), name: "fixed-panel-\(scenario)-collapsed")
        picker.detent = .expanded
        try await Task.sleep(for: .milliseconds(200))
        #expect(abs(pager.view.bounds.height - before) < 2, "Medium and expanded both use the full edge height")
        #expect(pager.viewControllers?.first === page)
        #expect(store.mapContext.pendingRequest == nil, "Expansion never requests an unsolicited fit")
        picker.showResults()
        try await Task.sleep(for: .milliseconds(200))
        try host.save(host.snapshot(), name: "fixed-panel-\(scenario)-results")
    }

    @Test(arguments: [ColorScheme.light, .dark])
    func mapResultsCaptionsAreReadableOverMaterial(scheme: ColorScheme) async throws {
        let activity = try StoredModelMapper.activity(Fixtures.activity([
            "id": "1", "name": "Riverside ride", "sport_type": "Ride", "distance": 31200,
            "elapsed_time": 4476, "total_elevation_gain": 820,
        ]))
        let store = ActivityStore(activities: [activity, ActivityStoreSelectionTests.activity(2)])
        store.replaceSelection(with: [1, 2])
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        let host = try DetailHarness(root: RoutePickerSheet(picker: picker, store: store, isSidePanel: false)
            .environment(\.colorScheme, scheme), size: CGSize(width: 375, height: 500))
        defer { host.close() }
        host.host.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
        try await Task.sleep(for: .milliseconds(200))
        let image = host.snapshot()
        try host.save(image, name: scheme == .dark ? "map-results-readable-dark" : "map-results-readable-light")
        // Inspect visible pixels, not accessibility labels: the regression was
        // present in the view tree but unreadable on the frosted surface.
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("2023"), "Date remains visibly rendered beside the sport badge and title: \(text)")
        // Vision may split a number into adjacent text observations ("3 1.2").
        let compactText = text.filter { !$0.isWhitespace }
        #expect(compactText.contains("31.2") && compactText.contains("1h14m") && compactText.contains("820"),
                "Distance, elapsed time and elevation are visibly rendered: \(text)")
    }

    @Test(arguments: [2, 60]) func nativeMapPagerDragsBeforeCommittingAndCancelsWithoutChangingFocus(count: Int) async throws {
        let store = ActivityStore(activities: (1...count).map { ActivityStoreSelectionTests.activity($0) })
        store.replaceSelection(with: Array(1...count))
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        let start = min(30, count)
        picker.showDetail(start, store: store, motion: .none)
        let host = try DetailHarness(root: RoutePickerSheet(picker: picker, store: store, isSidePanel: false), size: CGSize(width: 375, height: 500))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(300))
        let pager = try #require(host.controllers(of: UIPageViewController.self).first)
        #expect(pager.transitionStyle == .scroll && pager.navigationOrientation == .horizontal)
        let scroll = try #require(host.descendants(of: UIScrollView.self).first { $0.contentSize.width > $0.bounds.width * 1.5 })
        #expect(scroll.panGestureRecognizer.isEnabled)
        let initialOffset = scroll.contentOffset
        let before = host.snapshot()
        scroll.setContentOffset(CGPoint(x: initialOffset.x + 30, y: initialOffset.y), animated: false)
        try await Task.sleep(for: .milliseconds(50))
        #expect(before.pngData() != host.snapshot().pngData(), "Native page content moves before the drag is committed")
        #expect(picker.detailID == start && store.activeActivityID == start)
        try host.save(host.snapshot(), name: "map-native-page-drag")
        scroll.setContentOffset(initialOffset, animated: false)
        let initial = try #require(pager.viewControllers?.first)
        let next = try #require(pager.dataSource?.pageViewController(pager, viewControllerAfter: initial))
        let headerBefore = host.snapshotRegion(CGRect(x: 0, y: 18, width: 375, height: 52))
        pager.delegate?.pageViewController?(pager, willTransitionTo: [next])
        #expect(picker.isPaging)
        try await Task.sleep(for: .milliseconds(50))
        #expect(host.snapshotRegion(CGRect(x: 0, y: 18, width: 375, height: 52)) == headerBefore,
                "Paging arrows keep their appearance during a native drag")
        pager.delegate?.pageViewController?(pager, didFinishAnimating: true, previousViewControllers: [initial], transitionCompleted: false)
        #expect(!picker.isPaging && picker.detailID == start && store.activeActivityID == start)
        pager.delegate?.pageViewController?(pager, willTransitionTo: [next])
        pager.setViewControllers([next], direction: .forward, animated: false)
        pager.delegate?.pageViewController?(pager, didFinishAnimating: true, previousViewControllers: [initial], transitionCompleted: true)
        #expect(picker.detailID == start - 1 && store.activeActivityID == start - 1)
        let coordinator = try #require(pager.delegate as? MapActivityPager.Coordinator)
        for _ in 0..<20 {
            let current = try #require(pager.viewControllers?.first)
            let following = try #require(pager.dataSource?.pageViewController(pager, viewControllerAfter: current))
            pager.setViewControllers([following], direction: .forward, animated: false)
            pager.delegate?.pageViewController?(pager, didFinishAnimating: true, previousViewControllers: [current], transitionCompleted: true)
            #expect(coordinator.pages.count <= 3, "Large selections retain only current/adjacent hosted pages")
        }
        #expect(store.selectedActivityIDs.count == count && store.mapContext.pendingRequest == nil)
    }

    @Test(arguments: ["phone", "accessibility", "tablet", "landscape", "no-gps"])
    func detailAdaptivePresentation(scenario: String) async throws {
        let tablet = scenario == "tablet"
        let landscape = scenario == "landscape"
        let accessibility = scenario == "accessibility"
        let size = tablet ? CGSize(width: 768, height: 1024) : landscape ? CGSize(width: 844, height: 390) : CGSize(width: 390, height: 844)
        var activity = try StoredModelMapper.activity(Fixtures.activity([
            "sport_type": "Ride", "name": "A long ride through the hills and home along the river",
            // Keep this genuinely overflowing now that default details are
            // denser; the test still exercises scroll reachability in all hosts.
            "description": String(repeating: "Quiet roads, a steep climb, and a stop by the lake.\n", count: 40),
            "distance": 31200, "elapsed_time": 4476, "total_elevation_gain": 820,
            "moving_time": 4000, "average_speed": 7.8, "max_speed": 16,
            "elev_high": NSNull(), "elev_low": -12, "average_heartrate": 124, "max_heartrate": NSNull(),
            "average_watts": NSNull(), "max_watts": 0, "weighted_average_watts": 180,
        ]))
        if scenario == "no-gps" { activity.coordinates = []; activity.distance = nil; activity.totalElevationGain = 0 }
        let store = ActivityStore(activities: [activity])
        store.selectedTab = .list
        store.inspect(activity.id)
        let root = Group {
            if tablet {
                NavigationStack { ListScreen(store: store).navigationTitle("Activities") }
                    .environment(\.horizontalSizeClass, .regular)
            } else {
                ActivityDetailView(store: store, activityID: activity.id)
            }
        }
        .environment(\.dynamicTypeSize, accessibility ? .accessibility3 : .large)
        .preferredColorScheme(scenario == "no-gps" ? .dark : .light)
        let host = try DetailHarness(root: root, size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(250))
        #expect(store.selectedActivityIDs.isEmpty && store.activeActivityID == nil, "Opening list detail must not change map selection")
        try host.save(host.snapshot(), name: "detail-\(scenario)")
        let scrolls = host.descendants(of: UIScrollView.self)
        let detailScroll = try #require(scrolls.first { $0.contentSize.height > $0.bounds.height + 100 })
        detailScroll.setContentOffset(CGPoint(x: 0, y: detailScroll.contentSize.height - detailScroll.bounds.height), animated: false)
        try await Task.sleep(for: .milliseconds(100))
        #expect(detailScroll.contentOffset.y > 0, "Long detail content remains reachable by scrolling")
        try host.save(host.snapshot(), name: "detail-\(scenario)-scrolled")
    }
}

@MainActor
private final class DetailHarness<Content: View> {
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
    func snapshotRegion(_ rect: CGRect) -> Data? {
        let image = snapshot()
        let pixels = rect.applying(CGAffineTransform(scaleX: image.scale, y: image.scale))
        return image.cgImage?.cropping(to: pixels).flatMap { UIImage(cgImage: $0).pngData() }
    }
    func save(_ image: UIImage, name: String) throws {
        let directory = URL(fileURLWithPath: "/tmp/activitymap-detail-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
    }
    func descendants<T: UIView>(of type: T.Type) -> [T] {
        func visit(_ view: UIView) -> [T] {
            ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap(visit)
        }
        return visit(host.view)
    }
    func controllers<T: UIViewController>(of type: T.Type) -> [T] {
        func visit(_ controller: UIViewController) -> [T] {
            ((controller as? T).map { [$0] } ?? []) + controller.children.flatMap(visit)
        }
        return visit(host)
    }
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}


extension RenderedRoutePickingTests {
    @Test func offlineElevationUsesCompactRecoveryRow() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let activity = try Fixtures.activity(["id": "1"])
        try await storage.apply([.upsertActivity(activity)], scope: Fixtures.scope)
        let loader = StreamSummaryLoader(source: { _ in SummarySourceProbe([]) })
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        await loader.load(activityID: "1")
        let store = ActivityStore(activities: [try StoredModelMapper.activity(activity)])
        store.streamSummaries = loader
        for (name, size, scheme) in [("light", DynamicTypeSize.large, ColorScheme.light),
                                      ("dark", .large, .dark), ("large-text", .accessibility3, .light)] {
            let renderer = ImageRenderer(content: ElevationProfileView(store: store, activityID: 1, isRelevant: false)
                .padding(.horizontal, 16).frame(width: 375)
                .environment(\.dynamicTypeSize, size).environment(\.colorScheme, scheme)
                .background(Color(uiColor: scheme == .dark ? .black : .white)))
            let image = try #require(renderer.uiImage)
            if size == .large { #expect(image.size.height < 100, "Offline status must not reserve an empty chart") }
            let directory = URL(fileURLWithPath: "/tmp/activitymap-detail-preview")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try image.pngData()?.write(to: directory.appendingPathComponent("elevation-offline-\(name).png"))
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
            let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
            #expect(text.contains("offline") && text.contains("Retry"), "Offline explanation and recovery must remain visible: \(text)")
        }
    }

    @Test func elevationProfileLayoutsAndVisibleDemand() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let activity = try Fixtures.activity(["id": "1", "name": "Alpine morning ride"])
        try await storage.apply([.upsertActivity(activity)], scope: Fixtures.scope)
        let fence = await storage.streamFence()
        _ = try await storage.saveStreamSummary(ElevationFixtures.dto(), scope: Fixtures.scope, fence: fence, now: .now)
        let source = SummarySourceProbe([])
        let loader = StreamSummaryLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        let store = ActivityStore(activities: [try StoredModelMapper.activity(activity)])
        store.streamSummaries = loader
        // An offscreen/prefetched pager must not even demand a cached summary.
        let hidden = try DetailHarness(root: ElevationProfileView(store: store, activityID: 1, isRelevant: false), size: CGSize(width: 375, height: 500))
        try await Task.sleep(for: .milliseconds(100))
        #expect(loader.state(for: "1") == .notRequested)
        hidden.close()
        for (name, width, typeSize) in [("phone", 375.0, DynamicTypeSize.large), ("tablet", 700.0, .large), ("large-text", 375.0, .accessibility3)] {
            let host = try DetailHarness(root: ScrollView {
                ElevationProfileView(store: store, activityID: 1).padding(16)
            }.environment(\.dynamicTypeSize, typeSize), size: CGSize(width: width, height: 844))
            try await Task.sleep(for: .milliseconds(400))
            #expect(loader.currentSummary(for: "1") != nil)
            try host.save(host.snapshot(), name: "elevation-\(name)")
            host.close()
        }
        #expect(await source.calls == 0)
        store.selectedTab = .list
        let detail = try DetailHarness(root: ActivityDetailView(store: store, activityID: 1), size: CGSize(width: 390, height: 844))
        try await Task.sleep(for: .milliseconds(300))
        try detail.save(detail.snapshot(), name: "elevation-list-detail")
        detail.close()
    }
}


extension RenderedRoutePickingTests {
    @Test func elevationCursorRendersAndSuspendsPaging() async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try Fixtures.activity(["id": "1"]))], scope: Fixtures.scope)
        let fence = await storage.streamFence()
        _ = try await storage.saveStreamSummary(ElevationFixtures.dto(), scope: Fixtures.scope, fence: fence, now: .now)
        let loader = StreamSummaryLoader(source: { _ in SummarySourceProbe([]) })
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        await loader.load(activityID: "1")
        let cached = try #require(loader.currentSummary(for: "1"))
        let profile = try #require(ElevationProfile.decode(cached))
        var activity = ActivityStoreSelectionTests.activity(1)
        activity.coordinates = profile.points.map { CLLocationCoordinate2D(latitude: $0.latitude!, longitude: $0.longitude!) }
        let store = ActivityStore(activities: [activity, ActivityStoreSelectionTests.activity(2)])
        store.streamSummaries = loader
        store.replaceSelection(with: [1, 2])
        let picker = RoutePicker()
        picker.showDetail(1, store: store)
        picker.detent = .medium
        let host = try DetailHarness(root: MapScreen(store: store, picker: picker)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 768, height: 1024))
        defer { host.close() }
        for _ in 0..<100 where host.descendants(of: MapView.self).first?.mapboxMap.isStyleLoaded != true {
            try await Task.sleep(for: .milliseconds(20))
        }
        let map = try #require(host.descendants(of: MapView.self).first)
        map.mapboxMap.setCamera(to: CameraOptions(center: activity.coordinates[2], zoom: 14))
        try await Task.sleep(for: .milliseconds(300))
        let pager = try #require(host.controllers(of: UIPageViewController.self).first)
        let scroll = try #require(pager.view.subviews.compactMap { $0 as? UIScrollView }.first)
        #expect(scroll.isScrollEnabled)
        let baseline = host.snapshot()
        let owner = UUID()
        store.elevationCursor = .init(owner: owner, activityID: 1, cached: cached, point: profile.points[2])
        try await Task.sleep(for: .milliseconds(200))
        // An accessibility-adjusted cursor has no drag to protect; paging stays available.
        #expect(scroll.isScrollEnabled)
        store.elevationScrubOwner = owner
        try await Task.sleep(for: .milliseconds(200))
        #expect(!scroll.isScrollEnabled, "UIKit paging must yield to elevation scrubbing")
        #expect(store.elevationCoordinate?.latitude == profile.points[2].latitude)
        let marked = host.snapshot()
        #expect(baseline.pngData() != marked.pngData())
        try host.save(marked, name: "elevation-map-cursor")
        store.elevationScrubOwner = nil
        store.elevationCursor = nil
        try await Task.sleep(for: .milliseconds(100))
        #expect(scroll.isScrollEnabled)
        #expect(host.descendants(of: MapView.self).first === map, "Scrubbing must reuse the renderer")
    }

    @Test func elevationDetailSwitchCancelsObsoleteDemand() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let activities = try ["1", "2"].map { try Fixtures.activity(["id": $0]) }
        try await storage.apply(activities.map { .upsertActivity($0) }, scope: Fixtures.scope)
        let second = SummarySourceProbe.Response(payload: try ElevationFixtures.dto(id: "2"), statusCode: 200,
            retryAfter: nil, requestID: nil, body: Data())
        let source = SummarySourceProbe([.success(second)], hold: true)
        let loader = StreamSummaryLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(), storage: storage)
        let store = ActivityStore(activities: try activities.map(StoredModelMapper.activity))
        store.streamSummaries = loader
        store.selectedTab = .list
        let host = try DetailHarness(root: ActivityDetailView(store: store, activityID: 1), size: CGSize(width: 390, height: 844))
        defer { host.close() }
        for _ in 0..<100 where await source.calls < 1 { try await Task.sleep(for: .milliseconds(10)) }
        #expect(await source.calls == 1)
        host.host.rootView = ActivityDetailView(store: store, activityID: 2)
        for _ in 0..<100 where loader.currentSummary(for: "2") == nil { try await Task.sleep(for: .milliseconds(10)) }
        await source.resolve(.init(payload: try ElevationFixtures.dto(), statusCode: 200,
            retryAfter: nil, requestID: nil, body: Data()))
        try await Task.sleep(for: .milliseconds(100))
        #expect(loader.currentSummary(for: "2") != nil)
        #expect(loader.currentSummary(for: "1") == nil)
        #expect(await source.calls == 2)
    }
}


extension RenderedRoutePickingTests {
    @Test func elevationStatesReserveStableLayout() async throws {
        var heights: [String: CGFloat] = [:]
        for scenario in ["ready", "unavailable", "pending", "error", "loading"] {
            let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
            try await storage.apply([.upsertActivity(try Fixtures.activity(["id": "1"]))], scope: Fixtures.scope)
            let dto: ActivityMapAPI.ActivityCompactStreamSummary
            if scenario == "unavailable" || scenario == "pending" {
                dto = try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.ActivityCompactStreamSummary.self,
                    from: Data(StreamFixtures.summaryJSON(id: "1", summary: nil,
                        state: scenario == "pending" ? "not_fetched" : "current").utf8))
            } else { dto = try ElevationFixtures.dto() }
            let response = SummarySourceProbe.Response(payload: dto, statusCode: scenario == "pending" ? 202 : 200,
                retryAfter: scenario == "pending" ? 120 : nil, requestID: nil, body: Data())
            let result: Result<SummarySourceProbe.Response, APIClient.RequestError> = scenario == "error"
                ? .failure(.transport("Offline")) : .success(response)
            let source = SummarySourceProbe([result], hold: scenario == "loading")
            let loader = StreamSummaryLoader(source: { _ in source })
            await loader.configure(SyncFixtures.session(), storage: storage)
            let store = ActivityStore()
            store.streamSummaries = loader
            let host = try DetailHarness(root: ElevationProfileView(store: store, activityID: 1)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { heights[scenario] = $0 }
                .padding(16), size: CGSize(width: 375, height: 600))
            try await Task.sleep(for: .milliseconds(300))
            try host.save(host.snapshot(), name: "elevation-state-\(scenario)")
            host.close()
            if scenario == "loading" { await source.resolve(response) }
        }
        let ready = try #require(heights["ready"])
        // A profile that may still arrive keeps its space; none at all takes none.
        let waiting = heights.filter { $0.key != "unavailable" }
        #expect(waiting.count == 4)
        #expect(waiting.values.allSatisfy { abs($0 - ready) < 1 }, "Profile states must reserve the same space: \(heights)")
        #expect((heights["unavailable"] ?? 0) < 1, "An activity without elevation must not reserve space: \(heights)")
    }
}

extension RenderedRoutePickingTests {
    @Test(arguments: [1, 2])
    func phoneElevationSharesMediumSheetWithMap(count: Int) async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try Fixtures.activity(["id": "1"]))], scope: Fixtures.scope)
        let fence = await storage.streamFence()
        let fixture = try ElevationFixtures.dto()
        let dto = ActivityMapAPI.ActivityCompactStreamSummary(activityID: "1", metadata: fixture.metadata,
            summary: try CompactStreamCodec.encode(ElevationFixtures.summary(distance: [0, 10000, 23000, 42700])),
            lastError: nil, nextRetryAt: nil)
        _ = try await storage.saveStreamSummary(dto, scope: Fixtures.scope, fence: fence, now: .now)
        let loader = StreamSummaryLoader(source: { _ in SummarySourceProbe([]) })
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        await loader.load(activityID: "1")
        let cached = try #require(loader.currentSummary(for: "1"))
        let profile = try #require(ElevationProfile.decode(cached))
        var activity = ActivityStoreSelectionTests.activity(1)
        activity.name = "Alpine morning ride"
        activity.distance = 42700
        activity.movingTime = 7380
        activity.elapsedTime = 14820
        activity.totalElevationGain = 865
        activity.averageHeartrate = 142
        activity.maxHeartrate = 176
        activity.averageWatts = 195
        activity.description = "Riverside climb and forest descent"
        activity.averageSpeed = 8.17
        activity.maxSpeed = 18
        activity.elevLow = 406
        activity.elevHigh = 743
        activity.maxWatts = 788
        activity.weightedAverageWatts = 254
        activity.kilojoules = 4630
        activity.coordinates = profile.points.map { CLLocationCoordinate2D(latitude: $0.latitude!, longitude: $0.longitude!) }
        let store = ActivityStore(activities: [activity] + (count > 1 ? [ActivityStoreSelectionTests.activity(2)] : []))
        store.streamSummaries = loader
        store.replaceSelection(with: Array(1...count))
        let picker = RoutePicker()
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let host = try DetailHarness(root: MapScreen(store: store, picker: picker)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style))
            .preferredColorScheme(count == 2 ? .dark : .light), size: scene.coordinateSpace.bounds.size)
        host.window.overrideUserInterfaceStyle = count == 2 ? .dark : .light
        host.host.overrideUserInterfaceStyle = count == 2 ? .dark : .light
        defer { host.host.dismiss(animated: false); host.close() }
        for _ in 0..<100 where host.descendants(of: MapView.self).first?.mapboxMap.isStyleLoaded != true {
            try await Task.sleep(for: .milliseconds(20))
        }
        let map = try #require(host.descendants(of: MapView.self).first)
        store.showOnMap(1)
        try await Task.sleep(for: .milliseconds(900))
        #expect(picker.detent == .medium, "Show on map must open the elevation profile without a manual sheet expansion")
        // The activity heading's Fit route action queues this same command.
        store.showOnMap(1)
        try await Task.sleep(for: .milliseconds(600))
        #expect(picker.detent == .medium && picker.detailID == 1, "Reframing must retain visible activity detail")
        #expect(store.mapContext.pendingRequest == nil)
        let sheet = try #require(host.host.presentedViewController)
        let sheetFrame = sheet.view.convert(sheet.view.bounds, to: host.window)
        #expect(sheetFrame.minY > host.window.bounds.height * 0.4, "The profile must leave substantial map space")
        #expect(picker.detent == .medium)
        store.elevationCursor = .init(owner: UUID(), activityID: 1, cached: cached, point: profile.points[2])
        try await Task.sleep(for: .milliseconds(200))
        let marker = map.convert(map.mapboxMap.point(for: activity.coordinates[2]), to: host.window)
        #expect(marker.y > 80 && marker.y < sheetFrame.minY - 10, "The scrubbed point must be above the sheet: \(marker), \(sheetFrame)")
        let image = UIGraphicsImageRenderer(bounds: host.window.bounds).image { _ in
            host.window.drawHierarchy(in: host.window.bounds, afterScreenUpdates: true)
        }
        try host.save(image, name: "elevation-phone-medium-\(count)")
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Elevation (m)") && text.contains("Distance (km)"),
                "The entire chart, including both axes and units, must be visible before scrolling: \(text)")
        #expect(!text.contains("Elevation profile") && !text.contains("elevation 400"))
        let compactText = text.filter { !$0.isWhitespace }
        #expect(compactText.contains("42.7km") && compactText.contains("2h3m") && compactText.contains("865m"),
                "Stats must use activity distance, moving time and elevation gain: \(text)")
        #expect(!text.contains("21.35"), "Axis ticks should use automatic round intervals, not half the recorded span")
        #expect(text.contains("Moving time") && text.contains("Elevation gain"))
        let observations = request.results ?? []
        let title = try #require(observations.first { $0.topCandidates(1).first?.string.contains("Alpine morning ride") == true })
        let axis = try #require(observations.first { $0.topCandidates(1).first?.string.contains("Distance (km)") == true })
        let stats = try #require(observations.first { $0.topCandidates(1).first?.string.contains("42.7") == true })
        let description = try #require(observations.first { $0.topCandidates(1).first?.string.contains("Riverside climb") == true })
        #expect(title.boundingBox.minY > axis.boundingBox.maxY && axis.boundingBox.minY > description.boundingBox.maxY && description.boundingBox.minY > stats.boundingBox.maxY,
                "The visible hierarchy must be title, graph, description, then stats")
        #expect(observations.filter { $0.topCandidates(1).first?.string.contains("42.7") == true }.count == 1,
                "Distance must appear in one stats row only")
        let cursorLayers = map.mapboxMap.allLayerIdentifiers.filter { $0.type == .circle }
        #expect(cursorLayers.contains { map.mapboxMap.layerProperty(for: $0.id, property: "circle-emissive-strength").value as? Double == 1 },
                "The cursor must preserve its color under dark map lighting")
        picker.detent = .expanded
        try await Task.sleep(for: .milliseconds(600))
        let expanded = UIGraphicsImageRenderer(bounds: host.window.bounds).image { _ in
            host.window.drawHierarchy(in: host.window.bounds, afterScreenUpdates: true)
        }
        try host.save(expanded, name: "elevation-phone-expanded-\(count)")
        try VNImageRequestHandler(cgImage: try #require(expanded.cgImage)).perform([request])
        let expandedText = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(expandedText.contains("Elapsed time") && expandedText.contains("Time & speed") && expandedText.contains("Power"),
                "Expanding the sheet must reveal grouped activity measurements: \(expandedText)")
        #expect(!expandedText.contains("All recorded details"), "Groups must always be open")
        func scrollViews(_ view: UIView) -> [UIScrollView] {
            ((view as? UIScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scrollViews)
        }
        let detailScroll = try #require(scrollViews(sheet.view).first {
            $0.bounds.height > 200 && $0.contentSize.height > $0.bounds.height + 50 && $0.contentSize.width <= $0.bounds.width + 1
        })
        detailScroll.setContentOffset(CGPoint(x: 0, y: detailScroll.contentSize.height - detailScroll.bounds.height), animated: false)
        try await Task.sleep(for: .milliseconds(300))
        let bottom = UIGraphicsImageRenderer(bounds: host.window.bounds).image { _ in
            host.window.drawHierarchy(in: host.window.bounds, afterScreenUpdates: true)
        }
        try host.save(bottom, name: "elevation-phone-details-bottom-\(count)")
        try VNImageRequestHandler(cgImage: try #require(bottom.cgImage)).perform([request])
        let bottomText = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(bottomText.contains("Activity"),
                "Recording metadata must remain available by scrolling: \(bottomText)")
    }
}


extension RenderedRoutePickingTests {
    @Test func elevationNativeSelectionAnnotation() async throws {
        let profile = try #require(ElevationProfile.make(ElevationFixtures.summary(distance: [0, 10000, 23000, 42700])))
        var selected: ElevationProfile.Point?
        let root: (Double?) -> AnyView = { distance in
            AnyView(ElevationPlot(profile: profile, compact: true, selectedX: .constant(distance),
                onSelection: { selected = $0 }).padding(16).preferredColorScheme(.dark))
        }
        let host = try DetailHarness(root: root(nil), size: CGSize(width: 390, height: 260))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(400))
        host.host.rootView = root(10)
        try await Task.sleep(for: .milliseconds(400))
        #expect(selected?.id == 1, "Native chart selection must resolve the corresponding route sample")
        let image = host.snapshot()
        try host.save(image, name: "elevation-native-selection")
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("10 km") && text.contains("410 m") && !text.contains("m elevation"),
                "Selection should use a short readout above the chart: \(text)")
        let readout = try #require(request.results?.first { $0.topCandidates(1).first?.string.contains("410 m") == true })
        let upperTick = try #require(request.results?.first { $0.topCandidates(1).first?.string == "440" })
        #expect(readout.boundingBox.minY > upperTick.boundingBox.maxY,
                "The selected values must sit above the plot, never overlay its line or fill")
        host.host.rootView = root(42.7)
        try await Task.sleep(for: .milliseconds(400))
        #expect(selected?.id == 3)
        let endpointImage = host.snapshot()
        try host.save(endpointImage, name: "elevation-native-selection-end")
        try VNImageRequestHandler(cgImage: try #require(endpointImage.cgImage)).perform([request])
        let endpointText = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(endpointText.contains("Distance (km)") && endpointText.contains("Elevation (m)") && endpointText.contains("450 m"),
                "An endpoint selection must preserve the readout, axes and units: \(endpointText)")
        host.host.rootView = root(nil)
        try await Task.sleep(for: .milliseconds(400))
        #expect(selected == nil, "Clearing the native chart selection must remove the route cursor")
    }
}


extension RenderedRoutePickingTests {
    @Test func landscapePanelShowsLoadedProfileWithScrollingHeading() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity(["id": "1", "name": "Landscape ride"])
        try await storage.apply([.upsertActivity(dto)], scope: Fixtures.scope)
        let fence = await storage.streamFence()
        _ = try await storage.saveStreamSummary(ElevationFixtures.dto(), scope: Fixtures.scope, fence: fence, now: .now)
        let loader = StreamSummaryLoader(source: { _ in SummarySourceProbe([]) })
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        await loader.load(activityID: "1")
        let store = ActivityStore(activities: [try StoredModelMapper.activity(dto), ActivityStoreSelectionTests.activity(2)])
        store.streamSummaries = loader
        store.replaceSelection(with: [1, 2])
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        picker.showDetail(1, store: store, motion: .none)
        let size = CGSize(width: 844, height: 390)
        let host = try DetailHarness(root: MapResultsContainer(picker: picker, store: store,
            size: CGSize(width: size.width, height: size.height - 21), topInset: 44,
            bottomInset: 21, largeText: false).ignoresSafeArea(), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(500))
        let image = host.snapshot()
        try host.save(image, name: "combined-landscape-elevation")
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Landscape ride") && text.contains("Elevation (m)") && text.contains("Distance (km)"),
                "The scrolling heading and complete chart axes must fit in the opening landscape panel: \(text)")
        #expect(!text.contains("Fit route"), "Fit is the title-row icon, not a footer")
    }
}

extension RenderedRoutePickingTests {
    @Test(arguments: [false, true])
    func nativeSheetUsesCompactHeadingAndScrollsThroughBottom(largeText: Bool) async throws {
        var activities = (1...20).map { ActivityStoreSelectionTests.activity($0) }
        activities[0].name = "Alpine morning ride with a very long title"
        let store = ActivityStore(activities: activities)
        store.replaceSelection(with: Array(1...20))
        let picker = RoutePicker()
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let size = scene.coordinateSpace.bounds.size
        let host = try DetailHarness(root: MapResultsContainer(picker: picker, store: store,
            size: size, topInset: 0, bottomInset: 0, largeText: largeText)
            .environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large), size: size)
        defer { host.host.dismiss(animated: false); host.close() }
        picker.reviewSelection(store: store)
        try await Task.sleep(for: .milliseconds(700))
        let sheet = try #require(host.host.presentedViewController)
        func scrolls(_ view: UIView) -> [UIScrollView] {
            ((view as? UIScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scrolls)
        }
        let list = try #require(scrolls(sheet.view).first)
        let viewport = list.convert(list.bounds, to: sheet.view)
        #expect(abs(viewport.maxY - sheet.view.bounds.maxY) < 1,
                "The list must reach the sheet bottom instead of stopping above a fixed strip: \(viewport), \(sheet.view.bounds)")
        let offset = CGPoint(x: 0, y: 100)
        list.setContentOffset(offset, animated: false)
        func screenshot(_ name: String) throws -> String {
            let image = UIGraphicsImageRenderer(bounds: host.window.bounds).image { _ in
                host.window.drawHierarchy(in: host.window.bounds, afterScreenUpdates: true)
            }
            try host.save(image, name: "native-sheet-\(name)-\(largeText)")
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
            return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        }
        _ = try screenshot("list-bottom")
        for detail in [false, true] {
            if detail { picker.showDetail(1, store: store, motion: .none) }
            picker.detent = .compact
            try await Task.sleep(for: .milliseconds(500))
            #expect(sheet.view.bounds.height < (largeText ? 220 : 150), "Collapsed sheets should fit only their heading")
            let text = try screenshot(detail ? "compact-detail" : "compact-results")
            #expect(!text.contains("activities to explore") && !text.contains("Expand to review"))
            #expect(detail ? text.contains("Alpine") : text.contains("20 selected"), "Compact heading must stay visible: \(text)")
            picker.detent = .medium
            try await Task.sleep(for: .milliseconds(400))
            #expect(list.contentOffset == offset, "Collapsing must preserve the list position")
        }
    }
}

import SwiftUI
import Testing
import UIKit
import Vision
@testable import ActivityMap

extension RenderedRoutePickingTests {
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

    @Test func mapSheetTracksDragBeforeReleaseAndKeepsOneContentDuringSettling() async throws {
        var activity = ActivityStoreSelectionTests.activity(1)
        activity.name = "Lake ride"
        let store = ActivityStore(activities: [activity, ActivityStoreSelectionTests.activity(2)])
        store.replaceSelection(with: [1, 2])
        let picker = RoutePicker()
        picker.reviewSelection(store: store)
        picker.showDetail(1, store: store, motion: .none)
        let resizing = MapResultsResizeState()
        let size = CGSize(width: 375, height: 812)
        let heights = MapResultsDetent.allCases.map {
            MapResultsLayout(size: size, topInset: 0, bottomInset: 0, detent: $0).contentHeight
        }
        let host = try DetailHarness(root: MapResultsContainer(picker: picker, store: store, size: size,
            topInset: 0, bottomInset: 0, largeText: false, resizing: resizing).ignoresSafeArea(), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(250))
        let pager = try #require(host.controllers(of: UIPageViewController.self).first)
        let before = pager.view.bounds.height
        resizing.height = resizing.drag.update(translation: -90, currentHeight: heights[1], heights: heights)
        try await Task.sleep(for: .milliseconds(80))
        #expect(picker.detent == .medium && resizing.drag.isDragging)
        #expect(abs(pager.view.bounds.height - before - 90) < 2, "The detail viewport grows with the finger before release")
        #expect(abs((resizing.presentedHeight ?? 0) - heights[1] - 90) < 2)
        try host.save(host.snapshot(), name: "map-sheet-live-resize")
        _ = resizing.drag.finish(translation: -90, prediction: -90, heights: heights)
        picker.detent = .compact
        try await Task.sleep(for: .milliseconds(60))
        let progress = try #require(resizing.presentedHeight)
        #expect(progress > heights[0] + 1 && progress < heights[1] + 90,
                "Collapse interpolates the panel height instead of jumping layout and fading multiple contents")
        let image = host.snapshot()
        try host.save(image, name: "map-sheet-settling")
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.components(separatedBy: "Lake ride").count == 2, "One detail heading during settling: \(text)")
        try await Task.sleep(for: .milliseconds(500))
        #expect(abs((resizing.presentedHeight ?? 0) - heights[0]) < 2)
        #expect(picker.detailID == 1 && store.activeActivityID == 1 && store.selectedActivityIDs == [1, 2])
        #expect(store.mapContext.pendingRequest == nil, "A resize must not request a route fit")
        try host.save(host.snapshot(), name: "map-sheet-collapsed")
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
        #expect(text.contains("Ride") && text.contains("2023"), "Sport and date are visibly rendered: \(text)")
        #expect(text.contains("31.2") && text.contains("1h 14m") && text.contains("820"),
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

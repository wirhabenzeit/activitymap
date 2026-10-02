import MapboxMaps
import Observation
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

extension RenderedRoutePickingTests {
    @Test func listControlsAndInspectionSurviveMapRoundTripWithLazyLargeResults() async throws {
        let previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = previousToken }
        let presentation = ActivityListPresentation(defaults: nil)
        presentation.settings.sort = .init(field: .id, direction: .ascending)
        presentation.settings.visibleMetrics = [.distance, .elapsedTime, .elevationGain, .maxPower]
        presentation.settings.density = .compact
        let store = ActivityStore(activities: (1...2000).map { ActivityStoreSelectionTests.activity($0) },
                                  listPresentation: presentation)
        store.selectedTab = .list
        let host = try ListHarness(root: NavigationStack { BrowseContent(store: store) }
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: Self.listOfflineStyle)), size: CGSize(width: 768, height: 1024))
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).contains { $0.contentSize.height > $0.bounds.height * 2 } }
        let list = try #require(host.descendants(of: UICollectionView.self).first { $0.contentSize.height > $0.bounds.height * 2 })
        let total = (0..<list.numberOfSections).reduce(0) { $0 + list.numberOfItems(inSection: $1) }
        #expect(total == 2000, "Every filtered activity must have a reachable row")
        #expect(list.visibleCells.count < 100, "Lazy results must not instantiate thousands of rich rows")
        let lastSection = list.numberOfSections - 1
        list.scrollToItem(at: IndexPath(item: list.numberOfItems(inSection: lastSection) - 1, section: lastSection), at: .bottom, animated: false)
        try await Task.sleep(for: .milliseconds(200))
        let bottom = try #require(list.indexPathsForVisibleItems.max())
        #expect(bottom.item == list.numberOfItems(inSection: lastSection) - 1)
        store.inspect(2000)
        try await Task.sleep(for: .milliseconds(200))
        let offset = list.contentOffset.y
        let settings = presentation.settings
        store.selectedTab = .map
        try await Task.sleep(for: .milliseconds(200))
        store.selectedTab = .list
        try await Task.sleep(for: .milliseconds(200))
        #expect(presentation.settings == settings)
        #expect(store.inspectedActivityID == 2000 && store.selectedActivityIDs.isEmpty)
        #expect(host.descendants(of: UICollectionView.self).contains { $0 === list })
        #expect(abs(list.contentOffset.y - offset) < 1, "Retained List restores its exact scroll position and adjacent detail")
        try host.save("list-tablet-retained-inspection")
    }

    @Test(arguments: ["phone", "large-text", "tablet"])
    func listDetailUsesNavigationAndBackRetainsContext(scenario: String) async throws {
        let tablet = scenario == "tablet"
        let presentation = ActivityListPresentation(defaults: nil)
        presentation.settings.sort = .init(field: .id, direction: .ascending)
        let store = ActivityStore(activities: (1...200).map { ActivityStoreSelectionTests.activity($0) }, listPresentation: presentation)
        store.selectedTab = .list
        store.replaceSelection(with: [3])
        store.activate(3)
        let host = try ListHarness(root: NavigationStack {
            ListScreen(store: store).navigationTitle("Activities").navigationBarTitleDisplayMode(.inline)
        }
        .environment(\.horizontalSizeClass, tablet ? .regular : .compact)
        .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large),
        size: tablet ? CGSize(width: 820, height: 1180) : CGSize(width: 390, height: 844))
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).first?.visibleCells.isEmpty == false }
        let list = try #require(host.descendants(of: UICollectionView.self).first)
        list.setContentOffset(CGPoint(x: 0, y: 617), animated: false)
        try await Task.sleep(for: .milliseconds(150))
        let offset = list.contentOffset
        let selection = store.selectedActivityIDs
        let settings = presentation.settings
        func cameraValues() -> [Double] {
            let value = store.mapContext.camera
            return [value.center.latitude, value.center.longitude, Double(value.zoom), value.bearing, Double(value.pitch)]
        }
        let camera = cameraValues()
        let request = store.mapContext.pendingRequest
        let navigation = try #require(host.controllers(of: UINavigationController.self).first)
        store.inspect(10)
        if tablet {
            try await Task.sleep(for: .milliseconds(250))
            #expect(navigation.viewControllers.count == 1, "Wide List shows adjacent detail without pushing")
            #expect(list.contentOffset == offset)
        } else {
            try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
            #expect(host.host.presentedViewController == nil, "Phone detail is a navigation destination, not a modal sheet")
            #expect(host.controllers(of: UIPageViewController.self).isEmpty, "List detail has no neighbouring-activity pager")
        }
        try host.save("list-detail-\(scenario)")
        #expect(store.selectedActivityIDs == selection && store.activeActivityID == 3)
        #expect(cameraValues() == camera && store.mapContext.pendingRequest == request)
        if tablet { store.dismissInspection() }
        else { navigation.popViewController(animated: false) }
        try await listWait { store.inspectedActivityID == nil && navigation.viewControllers.count == 1 }
        #expect(host.descendants(of: UICollectionView.self).contains { $0 === list }, "Back returns to the same retained native List")
        #expect(abs(list.contentOffset.y - offset.y) < 1, "Back restores the exact scroll offset")
        #expect(presentation.settings == settings && store.selectedActivityIDs == selection && store.activeActivityID == 3)
        #expect(cameraValues() == camera && store.mapContext.pendingRequest == request)
        try host.save("list-back-\(scenario)")
        // Filter invalidation also closes the destination, with selection intact.
        store.inspect(10)
        if !tablet { try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil } }
        store.searchText = "No matching activity"
        try await listWait { store.inspectedActivityID == nil && navigation.viewControllers.count == 1 }
        #expect(store.selectedActivityIDs == selection)
    }

    @Test func largeListNavigationReusesBrowsingSnapshots() async throws {
        let presentation = ActivityListPresentation(defaults: nil)
        // Persisted totals preferences cannot reinsert the removed summary UI.
        presentation.settings.summaryMode = .filtered
        let store = ActivityStore(activities: (1...4575).map { ActivityStoreSelectionTests.activity($0) },
                                  listPresentation: presentation)
        store.selectedTab = .list
        let host = try ListHarness(root: NavigationStack {
            ListScreen(store: store).navigationTitle("Activities").navigationBarTitleDisplayMode(.inline)
        }.environment(\.horizontalSizeClass, .compact), size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).first?.visibleCells.isEmpty == false }
        let list = try #require(host.descendants(of: UICollectionView.self).first)
        #expect((0..<list.numberOfSections).reduce(0) { $0 + list.numberOfItems(inSection: $1) } == 4575,
                "The List contains activities only, even with a saved summary preference")
        list.setContentOffset(CGPoint(x: 0, y: 617), animated: false)
        try await Task.sleep(for: .milliseconds(100))
        let offset = list.contentOffset
        let filters = store.filterBuildCount, sorts = store.sortBuildCount
        let navigation = try #require(host.controllers(of: UINavigationController.self).first)
        for id in [4567, 4566, 4565] {
            store.inspect(id)
            try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
            #expect(navigation.interactivePopGestureRecognizer?.isEnabled == true)
            navigation.popViewController(animated: true)
            try await listWait { store.inspectedActivityID == nil && navigation.transitionCoordinator == nil }
            #expect(host.descendants(of: UICollectionView.self).contains { $0 === list })
            #expect(list.contentOffset == offset)
            #expect(store.filterBuildCount == filters && store.sortBuildCount == sorts,
                    "Native push/pop uses warm browsing snapshots instead of sorting all 4,575 activities")
        }
        try host.save("list-glass-no-summary")
    }

    @Test func listPushedDetailSurvivesWindowResizing() async throws {
        let store = ActivityStore(activities: (1...20).map { ActivityStoreSelectionTests.activity($0) })
        store.selectedTab = .list
        let layout = ListLayoutFixture()
        let host = try ListHarness(root: AdaptiveListFixture(store: store, layout: layout), size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).first?.visibleCells.isEmpty == false }
        let navigation = try #require(host.controllers(of: UINavigationController.self).first)
        store.inspect(10)
        try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        host.window.frame.size = CGSize(width: 820, height: 1180)
        host.host.view.frame = host.window.bounds
        layout.sizeClass = .regular
        try await Task.sleep(for: .milliseconds(300))
        #expect(navigation.viewControllers.count == 2 && store.inspectedActivityID == 10,
                "Resizing keeps the open detail and its navigation context")
        host.window.frame.size = CGSize(width: 390, height: 844)
        host.host.view.frame = host.window.bounds
        layout.sizeClass = .compact
        try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        #expect(store.inspectedActivityID == 10, "Returning to compact layout retains the open detail")
        navigation.popViewController(animated: false)
        try await listWait { store.inspectedActivityID == nil }
    }

    @Test(arguments: ["phone", "tablet"])
    func defaultListDensityFitsAtLeastNineRows(scenario: String) async throws {
        let tablet = scenario == "tablet"
        let activities = try (1...20).map { id in
            try StoredModelMapper.activity(Fixtures.activity([
                "id": String(id), "sport_type": "Ride", "name": "Morning ride along the river",
                "distance": 14800, "elapsed_time": 3600, "total_elevation_gain": 180,
            ]))
        }
        let store = ActivityStore(activities: activities, listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        store.replaceSelection(with: [19])
        let root = NavigationStack {
            ListScreen(store: store).navigationTitle("Activities").navigationBarTitleDisplayMode(.inline)
        }.environment(\.horizontalSizeClass, tablet ? .regular : .compact)
        let host = try ListHarness(root: root, size: tablet ? CGSize(width: 820, height: 1180) : CGSize(width: 375, height: 812))
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).first?.visibleCells.isEmpty == false }
        let list = try #require(host.descendants(of: UICollectionView.self).first)
        #expect(list.visibleCells.count >= 9, "Default rows should preserve browsing density even with longer activity names")
        #expect(list.visibleCells.allSatisfy { $0.bounds.height <= 76 }, "Default rows keep the name, local date, sport badge and three metrics within 76pt; measured heights: \(list.visibleCells.map { $0.bounds.height })")
        #expect(store.selectedActivityIDs == [19])
        try host.save("list-dense-\(scenario)")
    }

    @Test(arguments: ["small-phone", "large-text", "tablet", "scrolling-metrics"])
    func listControlsAdaptToDeviceAndDensity(scenario: String) async throws {
        let presentation = ActivityListPresentation(defaults: nil)
        let largeText = scenario == "large-text"
        let tablet = scenario == "tablet"
        let scrolling = scenario == "scrolling-metrics"
        if scrolling {
            presentation.settings.visibleMetrics = Set(ActivityListMetric.allCases)
            presentation.settings.width = .scrollingMetrics
            presentation.settings.density = .compact
        }
        let activity = try StoredModelMapper.activity(Fixtures.activity([
            "name": "A long ride through the hills with friends and home along the river",
            "sport_type": "Ride", "distance": NSNull(), "elapsed_time": 0, "total_elevation_gain": 1200,
            "private": false, "description": "A long description remains accessible in Details.",
        ]))
        let store = ActivityStore(activities: [activity], listPresentation: presentation)
        store.selectedTab = .list
        store.selectAllFiltered()
        let size = tablet ? CGSize(width: 768, height: 1024) : CGSize(width: 320, height: 700)
        let root = NavigationStack { ListScreen(store: store).navigationTitle("Activities") }
            .environment(\.horizontalSizeClass, tablet ? .regular : .compact)
            .environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large)
        let host = try ListHarness(root: root, size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(250))
        #expect(host.descendants(of: UICollectionView.self).first?.visibleCells.isEmpty == false)
        try host.save("list-\(scenario)")
    }

    private static let listOfflineStyle = ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##
}

@MainActor
private func listWait(sourceLocation: SourceLocation = #_sourceLocation, _ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(8)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(50)) }
    try #require(condition(), sourceLocation: sourceLocation)
}

@MainActor
private final class ListHarness<Content: View> {
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
    func save(_ name: String) throws {
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let directory = URL(fileURLWithPath: "/private/tmp/activitymap-ios-211-screenshots")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
    }
    func descendants<T: UIView>(of type: T.Type) -> [T] {
        func visit(_ view: UIView) -> [T] { ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap(visit) }
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

@MainActor @Observable
private final class ListLayoutFixture {
    var sizeClass = UserInterfaceSizeClass.compact
}

private struct AdaptiveListFixture: View {
    let store: ActivityStore
    @Bindable var layout: ListLayoutFixture
    var body: some View {
        NavigationStack {
            ListScreen(store: store).navigationTitle("Activities").navigationBarTitleDisplayMode(.inline)
        }.environment(\.horizontalSizeClass, layout.sizeClass)
    }
}

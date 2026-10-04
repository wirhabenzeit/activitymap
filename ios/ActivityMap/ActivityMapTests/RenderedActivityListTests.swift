import MapboxMaps
import Observation
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

extension RenderedRoutePickingTests {
    @Test func filtersReplaceNativeMapSheetAndRestoreSelection() async throws {
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: try GalleryLibrary.load().activities)
        store.selectedTab = .map
        store.replaceSelection(with: Array(store.activities.prefix(2).map(\.id)))
        let picker = RoutePicker()
        let sheets = BrowseSheetPresentation()
        let host = try ListHarness(root: AppShell(store: store, mapPicker: picker, sheets: sheets)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.mapStyleOverride, MapStyle(json: Self.listOfflineStyle)),
            size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        picker.reviewSelection(store: store)
        try await listWait { sheets.mapResultsPresented }
        let selection = store.selectedActivityIDs
        sheets.showsFilters = true
        try await listWait { sheets.shellSheetPresented && !sheets.mapResultsPresented }
        #expect(sheets.showsFilters, "The filter request must survive dismissal of map selection")
        store.searchText = "Ride"
        sheets.showsFilters = false
        try await listWait { sheets.mapResultsPresented && !sheets.shellSheetPresented }
        #expect(store.selectedActivityIDs == selection && picker.isPresented)
        sheets.accountDestination = .about
        try await listWait { sheets.shellSheetPresented && !sheets.mapResultsPresented }
        sheets.accountDestination = nil
        try await listWait { sheets.mapResultsPresented && !sheets.shellSheetPresented }
    }

    @Test func nativeMapSheetUsesContentHeightAndRetainsPaging() async throws {
        let store = ActivityStore(activities: try GalleryLibrary.load().activities)
        store.selectedTab = .map
        store.replaceSelection(with: Array(store.activities.prefix(2).map(\.id)))
        let picker = RoutePicker()
        let host = try ListHarness(root: MapResultsContainer(picker: picker, store: store,
            size: CGSize(width: 390, height: 844), topInset: 0, bottomInset: 34, largeText: false),
            size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(150))
        #expect(host.host.presentedViewController == nil)
        picker.reviewSelection(store: store)
        try await listWait { host.host.presentedViewController?.sheetPresentationController != nil }
        let controller = try #require(host.host.presentedViewController)
        let sheet = try #require(controller.sheetPresentationController)
        #expect(sheet.selectedDetentIdentifier != .large, "Initial presentation must start at its content height")
        var animatedEntrance = controller.transitionCoordinator?.isAnimated == true
        for _ in 0..<8 {
            animatedEntrance = animatedEntrance || controller.transitionCoordinator?.isAnimated == true
            let height = controller.presentationController?.presentedView?.layer.presentation()?.bounds.height
                ?? controller.view.bounds.height
            #expect(height < 360, "Two-route entrance must not animate down from full height: \(height)")
            try await Task.sleep(for: .milliseconds(30))
        }
        #expect(animatedEntrance, "Opening selection must use an animated native presentation")
        try await Task.sleep(for: .milliseconds(400))
        let image = UIGraphicsImageRenderer(bounds: host.window.bounds).image { _ in
            host.window.drawHierarchy(in: host.window.bounds, afterScreenUpdates: true)
        }
        try image.pngData()?.write(to: URL(fileURLWithPath: "/tmp/native-map-two-routes.png"))
        #expect(sheet.detents.count == 3)
        #expect(sheet.largestUndimmedDetentIdentifier != nil, "Map remains interactive behind the sheet")
        #expect(NativeMapResultsSizing.openingHeight(count: 2, detail: false, height: 844, largeText: false)
                < NativeMapResultsSizing.openingHeight(count: 20, detail: false, height: 844, largeText: false))
        picker.detent = .expanded
        try await Task.sleep(for: .milliseconds(300))
        #expect(sheet.selectedDetentIdentifier == .large)
        let first = try #require(picker.candidateIDs.first)
        picker.showDetail(first, store: store)
        try await Task.sleep(for: .milliseconds(300))
        #expect(host.host.presentedViewController === controller)
        #expect(sheet.selectedDetentIdentifier == .large, "Inspection respects manual expansion")
        picker.showResults()
        store.selectedTab = .list
        try await listWait { host.host.presentedViewController == nil }
        #expect(picker.isPresented, "Tab changes retain the map selection")
    }

    @Test(arguments: [375.0, 390.0, 402.0])
    func compactMetricPairsRetainTableColumns(width: Double) async throws {
        let presentation = ActivityListPresentation(defaults: nil)
        #expect(ActivityTableLayout.supports(presentation.settings, typeSize: .large, availableWidth: width))
        presentation.settings.visibleMetrics = [.distance, .averageSpeed]
        #expect(ActivityTableLayout.supports(presentation.settings, typeSize: .large, availableWidth: width))
        let store = ActivityStore(activities: try GalleryLibrary.load().activities, listPresentation: presentation)
        store.selectedTab = .list
        let host = try ListHarness(root: NavigationStack { ListScreen(store: store) },
                                  size: CGSize(width: width, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(300))
        try host.save("list-distance-speed-\(Int(width))")
        presentation.settings.visibleMetrics = [.distance, .elapsedTime, .elevationGain, .averageSpeed]
        #expect(!ActivityTableLayout.supports(presentation.settings, typeSize: .large, availableWidth: width))
        presentation.settings.visibleMetrics = [.distance, .averageSpeed]
        #expect(!ActivityTableLayout.supports(presentation.settings, typeSize: .accessibility3, availableWidth: width))
        presentation.settings.width = .details
        #expect(!ActivityTableLayout.supports(presentation.settings, typeSize: .large, availableWidth: width))
    }

    @Test func listDisplaySheetSurvivesColumnLayoutChanges() async throws {
        let presentation = ActivityListPresentation(defaults: nil)
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)], listPresentation: presentation)
        store.selectedTab = .list
        let host = try ListHarness(root: NavigationStack {
            ListScreen(store: store, displayOpen: true)
        }, size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await listWait { host.host.presentedViewController != nil }
        let sheet = try #require(host.host.presentedViewController)
        #expect(ActivityTableLayout.supports(presentation.settings, typeSize: .large))
        presentation.settings.visibleMetrics.insert(.maxPower)
        try await Task.sleep(for: .milliseconds(400))
        #expect(!ActivityTableLayout.supports(presentation.settings, typeSize: .large))
        #expect(host.host.presentedViewController === sheet, "Changing header branch must retain the open display sheet")
        presentation.settings.visibleMetrics = []
        try await Task.sleep(for: .milliseconds(200))
        #expect(host.host.presentedViewController === sheet)
        presentation.settings.visibleMetrics = [.distance, .elapsedTime, .elevationGain]
        try await Task.sleep(for: .milliseconds(200))
        #expect(ActivityTableLayout.supports(presentation.settings, typeSize: .large))
        #expect(host.host.presentedViewController === sheet, "Restoring table columns must retain the same sheet")
        presentation.settings.width = .details
        try await Task.sleep(for: .milliseconds(200))
        #expect(host.host.presentedViewController === sheet)
    }

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
        // Opening the adjacent detail changes the width and therefore the
        // estimated heights of 2,000 lazy rows. Capture the browsing position
        // after that layout settles, not during its asynchronous correction.
        try await listWait { list.bounds.width < 500 }
        let layoutDeadline = Date().addingTimeInterval(3)
        var previousSize = list.contentSize
        var previousOffset = list.contentOffset
        var stableSamples = 0
        while stableSamples < 5 && Date() < layoutDeadline {
            try await Task.sleep(for: .milliseconds(100))
            list.layoutIfNeeded()
            if list.contentSize == previousSize && list.contentOffset == previousOffset {
                stableSamples += 1
            } else { stableSamples = 0 }
            previousSize = list.contentSize
            previousOffset = list.contentOffset
        }
        try #require(stableSamples == 5, "The inspected list must settle before testing a tab round trip")
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

    @Test(arguments: ["phone", "large-text", "tablet", "tablet-landscape", "split-window", "tablet-large-text", "sidebar-portrait"])
    func listDetailUsesNavigationAndBackRetainsContext(scenario: String) async throws {
        let overlay = scenario == "sidebar-portrait"
        let regular = scenario.hasPrefix("tablet") || scenario == "split-window" || overlay
        let largeText = scenario.contains("large-text")
        let size: CGSize = switch scenario {
        case "tablet-landscape": CGSize(width: 1180, height: 820)
        case "tablet", "tablet-large-text": CGSize(width: 820, height: 1180)
        case "split-window": CGSize(width: 650, height: 1000)
        case "sidebar-portrait": CGSize(width: 499, height: 1180)
        default: CGSize(width: 390, height: 844)
        }
        let tablet = regular && size.width >= 760 && !largeText
        let presentation = ActivityListPresentation(defaults: nil)
        presentation.settings.sort = .init(field: .id, direction: .ascending)
        let store = ActivityStore(activities: (1...200).map { ActivityStoreSelectionTests.activity($0) }, listPresentation: presentation)
        store.selectedTab = .list
        store.replaceSelection(with: [3])
        store.activate(3)
        let host = try ListHarness(root: NavigationStack {
            ListScreen(store: store).navigationTitle("Activities").navigationBarTitleDisplayMode(.inline)
        }
        .environment(\.filterSidebarVisible, overlay)
        .environment(\.horizontalSizeClass, regular ? .regular : .compact)
        .environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large),
        size: size)
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).first?.visibleCells.isEmpty == false }
        let list = try #require(host.descendants(of: UICollectionView.self).first)
        let browsingWidth = list.bounds.width
        #expect(browsingWidth >= size.width - 40, "Without inspection, browsing must use the window width")
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
            #expect(list.bounds.width >= 400 && list.bounds.width <= browsingWidth - 340,
                    "Inspection must leave usable list and detail columns")
        } else if overlay {
            try await listWait { navigation.presentedViewController != nil }
            #expect(navigation.viewControllers.count == 1, "The sidebar layout must remain behind the detail overlay")
        } else {
            try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
            #expect(host.host.presentedViewController == nil, "Phone detail is a navigation destination, not a modal sheet")
            #expect(host.controllers(of: UIPageViewController.self).isEmpty, "List detail has no neighbouring-activity pager")
        }
        try host.save("list-detail-\(scenario)")
        #expect(store.selectedActivityIDs == selection && store.activeActivityID == 3)
        #expect(cameraValues() == camera && store.mapContext.pendingRequest == request)
        if tablet || overlay { store.dismissInspection() }
        else { navigation.popViewController(animated: false) }
        try await listWait { store.inspectedActivityID == nil && navigation.viewControllers.count == 1 }
        #expect(host.descendants(of: UICollectionView.self).contains { $0 === list }, "Back returns to the same retained native List")
        try await listWait { abs(list.bounds.width - browsingWidth) < 1 }
        #expect(abs(list.contentOffset.y - offset.y) < 1, "Back restores the exact scroll offset")
        #expect(presentation.settings == settings && store.selectedActivityIDs == selection && store.activeActivityID == 3)
        #expect(cameraValues() == camera && store.mapContext.pendingRequest == request)
        try host.save("list-back-\(scenario)")
        // Filter invalidation also closes the destination, with selection intact.
        store.inspect(10)
        if !tablet && !overlay { try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil } }
        store.searchText = "No matching activity"
        try await listWait { store.inspectedActivityID == nil && navigation.viewControllers.count == 1 }
        #expect(store.selectedActivityIDs == selection)
    }

    @Test func shellHeaderStaysOutsideListDetailNavigation() async throws {
        let previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = previousToken }
        let store = ActivityStore(activities: (1...100).map { ActivityStoreSelectionTests.activity($0) },
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        let host = try ListHarness(root: AppShell(store: store)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.mapStyleOverride, MapStyle(json: Self.listOfflineStyle)),
            size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).first?.visibleCells.isEmpty == false }
        let navigation = try #require(host.controllers(of: UINavigationController.self).first)
        let list = try #require(host.descendants(of: UICollectionView.self).first)
        list.setContentOffset(CGPoint(x: 0, y: 200), animated: false)
        try await Task.sleep(for: .milliseconds(200))
        let offset = list.contentOffset
        let navigationTop = navigation.view.convert(.zero, to: host.host.view).y
        #expect(navigationTop >= 54, "The native stack starts below the persistent app header")
        store.inspect(90)
        var openingFrames: [CGRect] = []
        var openingInsets: [CGFloat] = []
        // Include the animation itself: the regression occurred at its end,
        // before the old post-transition checks started observing the view.
        for _ in 0..<40 {
            try await Task.sleep(for: .milliseconds(40))
            if navigation.viewControllers.count == 2, let destination = navigation.topViewController {
                openingFrames.append(destination.view.frame)
                openingInsets.append(destination.view.safeAreaInsets.top)
                #expect(navigation.isNavigationBarHidden)
            }
        }
        #expect(!openingFrames.isEmpty)
        #expect(openingFrames.allSatisfy { $0 == openingFrames.first })
        #expect(openingInsets.allSatisfy { $0 == 0 }, "Native bar insets must not move the fixed Back row during the push")
        try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        let barFrame = navigation.navigationBar.convert(navigation.navigationBar.bounds, to: host.host.view)
        let contentFrame = navigation.topViewController?.view.frame
        for _ in 0..<5 {
            try await Task.sleep(for: .milliseconds(200))
            #expect(navigation.navigationBar.convert(navigation.navigationBar.bounds, to: host.host.view) == barFrame,
                    "The Back bar must not move after the push transition completes")
            #expect(navigation.topViewController?.view.frame == contentFrame,
                    "Detail content must not shift after the push transition completes")
        }
        #expect(navigation.isNavigationBarHidden)
        let popGesture = try #require(navigation.interactivePopGestureRecognizer)
        #expect(popGesture.isEnabled)
        #expect(popGesture.delegate?.gestureRecognizerShouldBegin?(popGesture) == true,
                "The native edge-swipe recognizer must accept a pop with the bar hidden")
        let detailGestureDelegate = popGesture.delegate
        #expect(navigation.view.convert(.zero, to: host.host.view).y == navigationTop)
        store.selectedTab = .map
        try await Task.sleep(for: .milliseconds(200))
        store.selectedTab = .list
        try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        #expect(store.inspectedActivityID == 90)
        navigation.popViewController(animated: true)
        try await listWait { store.inspectedActivityID == nil && navigation.transitionCoordinator == nil }
        #expect(list.contentOffset == offset)
        #expect(store.selectedActivityIDs.isEmpty)
        #expect(popGesture.delegate !== detailGestureDelegate, "Restore UIKit's gesture delegate after leaving detail")
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

    @Test(arguments: ["small-phone", "large-text", "tablet", "details"])
    func listControlsAdaptToDeviceAndDensity(scenario: String) async throws {
        let presentation = ActivityListPresentation(defaults: nil)
        let largeText = scenario == "large-text"
        let tablet = scenario == "tablet"
        let details = scenario == "details"
        if details {
            presentation.settings.visibleMetrics = Set(ActivityListMetric.allCases)
            presentation.settings.width = .details
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
        if details {
            #expect(host.descendants(of: UIScrollView.self).allSatisfy { $0 is UICollectionView },
                    "Details metrics must wrap inside the List, without a nested gesture-owning scroll view")
        }
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

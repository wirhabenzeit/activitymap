import MapboxMaps
import Observation
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

extension RenderedRoutePickingTests {
    @Test(arguments: ["light", "dark"])
    func inspectionAndSelectionHaveIndependentRowFeedback(appearance: String) async throws {
        let store = ActivityStore(activities: (1...4).map { ActivityStoreSelectionTests.activity($0, route: false) },
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        store.replaceSelection(with: [2, 3])
        let host = try ListHarness(root: NavigationStack { ListScreen(store: store) }
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.colorScheme, appearance == "dark" ? .dark : .light),
            size: CGSize(width: 834, height: 1194))
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).first?.visibleCells.count == 4 }
        store.inspect(1)
        try await Task.sleep(for: .milliseconds(250))
        let values = host.accessibilityValues()
        #expect(values.contains { $0.contains("Inspected. Not selected") })
        #expect(values.contains { $0.contains("Not inspected. Selected") })
        #expect(values.contains { $0.contains("Not inspected. Not selected") })
        try host.save("row-feedback-\(appearance)-inspected")
        store.inspect(3)
        try await Task.sleep(for: .milliseconds(200))
        #expect(host.accessibilityValues().contains { $0.contains("Inspected. Selected") })
        #expect(store.selectedActivityIDs == [2, 3], "Inspection never changes selection")
        try host.save("row-feedback-\(appearance)-both")
        store.dismissInspection()
        try await Task.sleep(for: .milliseconds(200))
        #expect(!host.accessibilityValues().contains { $0.contains("Inspected.") })
        #expect(store.selectedActivityIDs == [2, 3])
    }

    @Test func filtersAndSettingsStackOverNativeMapSheet() async throws {
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
        // Presented by the results sheet itself, so it opens at once instead of
        // waiting for the results to fade out (device review, 2026-10-06).
        let stacked = { host.host.presentedViewController?.presentedViewController != nil }
        sheets.showsFilters = true
        try await listWait { stacked() }
        #expect(sheets.mapResultsPresented && !sheets.shellSheetPresented, "Filters stack over the map results")
        store.searchText = "Ride"
        sheets.showsFilters = false
        try await listWait { !stacked() }
        #expect(sheets.mapResultsPresented && store.selectedActivityIDs == selection && picker.isPresented)
        sheets.accountDestination = .about
        try await listWait { stacked() }
        #expect(sheets.mapResultsPresented, "Settings stack over the map results")
        sheets.accountDestination = nil
        try await listWait { !stacked() && sheets.mapResultsPresented }
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
        presentation.displayOpen = true
        let host = try ListHarness(root: NavigationStack {
            ListScreen(store: store)
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

    @Test(arguments: ["phone", "large-text", "tablet", "tablet-landscape", "split-window", "tablet-large-text"])
    func listDetailUsesNavigationAndBackRetainsContext(scenario: String) async throws {
        let regular = scenario.hasPrefix("tablet") || scenario == "split-window"
        let largeText = scenario.contains("large-text")
        let size: CGSize = switch scenario {
        case "tablet-landscape": CGSize(width: 1180, height: 820)
        case "tablet", "tablet-large-text": CGSize(width: 820, height: 1180)
        case "split-window": CGSize(width: 650, height: 1000)
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
        try await listWait { abs(list.bounds.width - browsingWidth) < 1 }
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

    @Test(arguments: [false, true])
    func listMapActionDoesNotPresentSheetOverPushedDetail(globe: Bool) async throws {
        let previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = previousToken }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1),
                                               ActivityStoreSelectionTests.activity(2)],
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        store.addToSelection([1])
        let picker = RoutePicker(), sheets = BrowseSheetPresentation()
        let host = try ListHarness(root: AppShell(store: store, mapPicker: picker, sheets: sheets)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.mapStyleOverride, MapStyle(json: globe
                ? Self.listOfflineStyle.replacingOccurrences(of: "\"sources\":{}", with: "\"projection\":{\"name\":\"globe\"},\"sources\":{}")
                : Self.listOfflineStyle)),
            size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).first?.visibleCells.isEmpty == false
            && host.descendants(of: MapView.self).first?.mapboxMap.isStyleLoaded == true }
        let map = try #require(host.descendants(of: MapView.self).first)
        let navigation = try #require(host.controllers(of: UINavigationController.self).last)
        store.inspect(2)
        try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        let reference = try #require(host.controllers(of: DetailBackGesture.Controller.self).last?.navigationReference)
        #expect(reference.controller === navigation)
        #expect(!sheets.mapResultsPresented)

        try host.save("list-detail-map-trailing")
        let captureDirectory = ProcessInfo.processInfo.environment["ACTIVITYMAP_LIST_MAP_HANDOFF_OUTPUT"]
            .map { URL(fileURLWithPath: $0) }
        if let directory = captureDirectory {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data().write(to: directory.appendingPathComponent("ready"))
            let deadline = Date().addingTimeInterval(60)
            while !FileManager.default.fileExists(atPath: directory.appendingPathComponent("recording").path), Date() < deadline {
                try await Task.sleep(for: .milliseconds(100))
            }
            try #require(FileManager.default.fileExists(atPath: directory.appendingPathComponent("recording").path))
            try await Task.sleep(for: .seconds(1))
        }
        let detailController = try #require(navigation.topViewController)
        let startZoom = map.mapboxMap.cameraState.zoom
        var zoomSamples = [startZoom]
        showActivityOnMapFromDetail(2, store: store, navigationController: reference.controller)
        for _ in 0..<45 {
            try await Task.sleep(for: .milliseconds(16))
            zoomSamples.append(map.mapboxMap.cameraState.zoom)
            if sheets.mapResultsPresented || host.host.presentedViewController != nil {
                #expect(navigation.viewControllers.count == 1,
                        "The Map sheet must never appear over a still-pushed List detail")
                #expect(navigation.transitionCoordinator?.viewController(forKey: .from) !== detailController,
                        "The outgoing detail must finish its transition before Map's sheet appears")
            }
        }
        try await listWait { sheets.mapResultsPresented && picker.detailID == 2 }
        try await listWait {
            guard case .state = map.viewport.status else { return false }
            return map.mapboxMap.cameraState.zoom > startZoom + 1
        }
        let end = map.mapboxMap.cameraState
        let delta = end.zoom - startZoom
        #expect(zoomSamples.filter { $0 > startZoom + delta * 0.1 && $0 < end.zoom - delta * 0.1 }.count >= 3,
                "Show on map must move through intermediate cameras while opening results, instead of jumping")
        #expect(zip(zoomSamples, zoomSamples.dropFirst()).allSatisfy { abs($1 - $0) < delta * 0.6 },
                "No single frame may jump most of the way to the fitted zoom")
        #expect(host.descendants(of: MapView.self).first === map, "Navigation must retain the loaded map")
        #expect(map.mapboxMap.projection?.name == .mercator)
        let route = try #require(store.activities.first { $0.id == 2 }).coordinates
        let visible = map.bounds.inset(by: end.padding).insetBy(dx: -2, dy: -2)
        #expect(map.mapboxMap.points(for: route).allSatisfy { visible.contains($0) },
                "The animation must finish with the route framed above the opening results sheet")
        #expect(store.selectedTab == .map && store.inspectedActivityID == nil)
        #expect(store.activeActivityID == 2 && store.selectedActivityIDs == [1, 2])
        #expect(host.host.presentedViewController?.sheetPresentationController != nil)
        try host.save("list-detail-map-handoff")
        if let directory = captureDirectory { try Data().write(to: directory.appendingPathComponent("done")) }

        // An already-idle map must also render and consume explicit commands
        // without a tab switch, source change or new selection to wake it up.
        store.mapContext.request(.resetView)
        try await listWait {
            guard case .state = map.viewport.status else { return false }
            return store.mapContext.pendingRequest == nil
                && abs(map.mapboxMap.cameraState.zoom - MapCamera.initial.zoom) < 0.01
        }
        store.mapContext.request(.fitSelection)
        try await listWait {
            guard case .state = map.viewport.status else { return false }
            return store.mapContext.pendingRequest == nil
                && map.mapboxMap.cameraState.zoom > MapCamera.initial.zoom + 1
        }
        let fittedArea = map.bounds.inset(by: map.mapboxMap.cameraState.padding).insetBy(dx: -2, dy: -2)
        let selectedRoute = store.activities.filter { store.selectedActivityIDs.contains($0.id) }.flatMap(\.coordinates)
        #expect(map.mapboxMap.points(for: selectedRoute).allSatisfy { fittedArea.contains($0) })
        #expect(host.descendants(of: MapView.self).first === map)
    }

    @Test(arguments: ["phone", "landscape", "large-text", "split-window"])
    func pushedListDetailReplacesTheShellHeader(scenario: String) async throws {
        let previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = previousToken }
        let store = ActivityStore(activities: (1...100).map { ActivityStoreSelectionTests.activity($0) },
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        let size = scenario == "landscape" ? CGSize(width: 844, height: 390)
            : scenario == "split-window" ? CGSize(width: 650, height: 1000) : CGSize(width: 390, height: 844)
        let host = try ListHarness(root: AppShell(store: store)
            .environment(\.horizontalSizeClass, scenario == "split-window" ? .regular : .compact)
            .environment(\.verticalSizeClass, scenario == "landscape" ? .compact : .regular)
            .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large)
            .environment(\.mapStyleOverride, MapStyle(json: Self.listOfflineStyle)),
            size: size)
        defer { host.close() }
        try await listWait { host.descendants(of: UICollectionView.self).first?.visibleCells.isEmpty == false }
        let navigation = try #require(host.controllers(of: UINavigationController.self).last)
        let list = try #require(host.descendants(of: UICollectionView.self).first)
        list.setContentOffset(CGPoint(x: 0, y: 200), animated: false)
        try await Task.sleep(for: .milliseconds(200))
        let offset = list.contentOffset
        #expect(!navigation.isNavigationBarHidden)
        let headerBottom = navigation.navigationBar.convert(navigation.navigationBar.bounds, to: host.host.view).maxY
        let listTop = list.convert(list.bounds, to: host.host.view).minY
        #expect(listTop + list.adjustedContentInset.top >= headerBottom,
                "The retained List starts below the visible shell bar")
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
                #expect(!navigation.isNavigationBarHidden)
            }
        }
        #expect(!openingFrames.isEmpty)
        #expect(openingFrames.allSatisfy { $0 == openingFrames.first })
        #expect(openingInsets.allSatisfy { abs($0 - (openingInsets.first ?? $0)) < 1 }, "Root and detail keep the same native bar inset during the push")
        try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        let barFrame = navigation.navigationBar.convert(navigation.navigationBar.bounds, to: host.host.view)
        #expect(abs(barFrame.minY - host.host.view.safeAreaInsets.top) < 2,
                "The detail's native Back/title bar occupies the top header position")
        #expect(host.controllers(of: UINavigationController.self).filter {
            !$0.isNavigationBarHidden && $0.navigationBar.window != nil
        }.count == 1, "Exactly one native navigation bar is visible")
        let contentFrame = navigation.topViewController?.view.frame
        try host.save("list-single-header-\(scenario)")
        for _ in 0..<5 {
            try await Task.sleep(for: .milliseconds(200))
            #expect(navigation.navigationBar.convert(navigation.navigationBar.bounds, to: host.host.view) == barFrame,
                    "The Back bar must not move after the push transition completes")
            #expect(navigation.topViewController?.view.frame == contentFrame,
                    "Detail content must not shift after the push transition completes")
        }
        #expect(!navigation.isNavigationBarHidden)
        let popGesture = try #require(navigation.interactivePopGestureRecognizer)
        #expect(popGesture.isEnabled)
        #expect(popGesture.delegate?.gestureRecognizerShouldBegin?(popGesture) == true,
                "The native edge-swipe recognizer must accept a pop with the bar hidden")
        let detailGestureDelegate = popGesture.delegate
        store.selectedTab = .map
        try await Task.sleep(for: .milliseconds(200))
        #expect(host.accessibilityElement(label: "Settings") != nil,
                "The browsing header returns on Map while List retains its detail")
        store.selectedTab = .list
        try await listWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        #expect(store.inspectedActivityID == 90)
        navigation.popViewController(animated: true)
        try await listWait { store.inspectedActivityID == nil && navigation.transitionCoordinator == nil }
        #expect(list.contentOffset == offset)
        #expect(store.selectedActivityIDs.isEmpty)
        #expect(popGesture.delegate !== detailGestureDelegate, "Restore UIKit's gesture delegate after leaving detail")
        #expect(!navigation.isNavigationBarHidden && navigation.viewControllers.count == 1,
                "Back restores the browsing toolbar in the same native header")
        try host.save("list-single-header-back-\(scenario)")
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
    func accessibilityElement(label: String) -> NSObject? {
        var visited: Set<ObjectIdentifier> = []
        func visit(_ object: NSObject) -> NSObject? {
            guard visited.insert(ObjectIdentifier(object)).inserted else { return nil }
            if let view = object as? UIView, view.isHidden || view.alpha == 0 { return nil }
            if object.accessibilityLabel == label,
               !object.accessibilityFrame.isEmpty { return object }
            let count = object.accessibilityElementCount()
            if count > 0, count < 1000 {
                for index in 0..<count {
                    if let child = object.accessibilityElement(at: index) as? NSObject,
                       let found = visit(child) { return found }
                }
            }
            if let view = object as? UIView {
                for child in view.subviews { if let found = visit(child) { return found } }
            }
            return nil
        }
        return visit(host.view)
    }
    func accessibilityValues() -> [String] {
        var visited: Set<ObjectIdentifier> = []
        func visit(_ object: NSObject) -> [String] {
            guard visited.insert(ObjectIdentifier(object)).inserted else { return [] }
            var values = object.accessibilityValue.map { [$0] } ?? []
            if let view = object as? UIView { values += view.subviews.flatMap(visit) }
            let count = object.accessibilityElementCount()
            if count > 0, count < 1000 {
                for index in 0..<count {
                    if let child = object.accessibilityElement(at: index) as? NSObject { values += visit(child) }
                }
            }
            return values
        }
        return visit(host.view)
    }
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

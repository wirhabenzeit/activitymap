import SwiftUI
import Testing
import UIKit
import MapboxMaps
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedFilterTests {
    @Test func filterPinIsLandscapeOnlyAndNeedsRoomForDetail() {
        func pins(_ width: CGFloat, _ height: CGFloat, regular: Bool = true, large: Bool = false) -> Bool {
            BrowsePaneLayout.filtersCanPin(size: CGSize(width: width, height: height), regular: regular, accessibilityText: large)
        }
        // iPad mini, 11-inch and 13-inch landscape fit filters, overview and detail.
        #expect(pins(1133, 744) && pins(1194, 834) && pins(1366, 1024))
        // Portrait, even on the 13-inch iPad, always overlays filters.
        #expect(!pins(744, 1133) && !pins(834, 1194) && !pins(1024, 1366))
        // Split View, compact windows and accessibility text never pin.
        #expect(!pins(980, 834) && !pins(1194, 834, regular: false) && !pins(1194, 834, large: true))
        #expect(BrowsePaneLayout.filtersUseSidebar(width: 834, regular: true, accessibilityText: false))
        #expect(!BrowsePaneLayout.filtersUseSidebar(width: 700, regular: true, accessibilityText: false))
        #expect(!BrowsePaneLayout.filtersUseSidebar(width: 1194, regular: true, accessibilityText: true))
    }

    @Test func filterButtonReadsTheActiveCount() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        #expect(FilterCountBadge.label(count: store.activeFilterCount) == "Filters")
        store.searchText = "ride"
        store.privateFilter = false
        store.distanceFilter = NumericFilter(value: 10000, upperLimit: 80000)
        #expect(store.activeFilterCount == 3)
        #expect(FilterCountBadge.label(count: store.activeFilterCount) == "Filters, 3 active")
    }

    @Test(arguments: [AppTab.map, .list, .stats])
    func tabletFiltersOpenAsOverlayAndSurviveDestinationSwitches(tab: AppTab) async throws {
        let pinDefaults = filterDefaults(pinned: nil)
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)],
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = tab
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets).defaultAppStorage(pinDefaults)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 834, height: 1194))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(350))
        #expect(!host.showsFilterSidebar, "iPad filters start closed")
        sheets.showsFilters = true
        try await Task.sleep(for: .milliseconds(450))
        // The wide-window host is the overlay sidebar, never a duplicate sheet.
        #expect(host.host.presentedViewController == nil && !sheets.shellSheetPresented)
        #expect(host.showsFilterSidebar)
        try host.save(host.snapshot(), name: "overlay-filters-\(tab.title.lowercased())")
        for next in [AppTab.map, .list, .stats, tab] {
            store.selectedTab = next
            try await Task.sleep(for: .milliseconds(200))
            #expect(sheets.showsFilters && host.showsFilterSidebar, "Switching to \(next.title) keeps filters open")
        }
        sheets.showsFilters = false
        try await filterWait { !host.showsFilterSidebar }
        for next in [AppTab.map, .list, .stats, tab] {
            store.selectedTab = next
            try await Task.sleep(for: .milliseconds(200))
            #expect(!host.showsFilterSidebar, "Switching to \(next.title) keeps filters closed")
        }
    }

    @Test func resizingDismissesFilterSheetWhenSidebarBecomesAvailable() async throws {
        let pinDefaults = filterDefaults(pinned: nil)
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)])
        store.selectedTab = .list
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets).defaultAppStorage(pinDefaults)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 600, height: 834))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(350))
        sheets.showsFilters = true
        try await filterWait { host.host.presentedViewController != nil && host.host.presentedViewController?.isBeingPresented == false }
        host.window.frame.size.width = 1194
        host.host.view.frame = host.window.bounds
        try await filterWait { host.host.presentedViewController == nil && !sheets.showsFilters && !sheets.shellSheetPresented }
        #expect(!host.showsFilterSidebar, "Resizing closes the sheet without opening the sidebar")
        store.selectedTab = .stats
        try await Task.sleep(for: .milliseconds(250))
        sheets.showsFilters = true
        try await Task.sleep(for: .milliseconds(350))
        #expect(host.host.presentedViewController == nil && !sheets.shellSheetPresented)
        #expect(host.showsFilterSidebar)
        sheets.showsFilters = false
    }

    @Test(arguments: [AppTab.map, .list, .stats])
    func narrowTabletUsesFilterSheetAcrossTabs(tab: AppTab) async throws {
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)])
        store.selectedTab = tab
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 600, height: 834))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(350))
        sheets.showsFilters = true
        try await filterWait { sheets.shellSheetPresented && host.host.presentedViewController?.isBeingPresented == false }
        sheets.showsFilters = false
        try await filterWait { host.host.presentedViewController == nil }
        #expect(store.selectedTab == tab)
    }

    @Test(arguments: ["portrait", "landscape", "pinned"])
    func listDetailNeverChangesFilterVisibility(layout: String) async throws {
        let pinDefaults = filterDefaults(pinned: layout == "pinned" ? true : nil)
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)],
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        let size = layout == "portrait" ? CGSize(width: 834, height: 1194) : CGSize(width: 1194, height: 834)
        let pinned = layout == "pinned"
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets).defaultAppStorage(pinDefaults)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(450))
        #expect(host.showsFilterSidebar == pinned)
        let list = try #require(host.descendants(of: UICollectionView.self).first { $0.bounds.width > 400 })
        let availableWidth = pinned ? size.width - 321 : size.width
        #expect(abs(list.bounds.width - availableWidth) < 2)
        store.inspect(1)
        try await Task.sleep(for: .milliseconds(500))
        #expect(host.host.presentedViewController == nil)
        #expect(host.descendants(of: UICollectionView.self).contains { $0 === list })
        let expectedListWidth = availableWidth - min(420, max(340, availableWidth * 0.42)) - 1
        #expect(abs(list.bounds.width - expectedListWidth) < 2, "Detail stays beside the retained list rather than pushing")
        #expect(host.showsFilterSidebar == pinned, "Opening detail never shows or hides filters")
        if !pinned {
            // The overlay covers the List and its detail without resizing them.
            sheets.showsFilters = true
            try await Task.sleep(for: .milliseconds(400))
            #expect(host.showsFilterSidebar && abs(list.bounds.width - expectedListWidth) < 2)
        }
        try host.save(host.snapshot(), name: "list-detail-filters-\(layout)")
        // Map and Stats do not borrow or return a filter column either (#354).
        for tab in [AppTab.map, .stats, .list] {
            store.selectedTab = tab
            try await Task.sleep(for: .milliseconds(250))
            #expect(host.showsFilterSidebar == (pinned || sheets.showsFilters), "\(tab.title) keeps filter visibility")
        }
        store.dismissInspection()
        try await Task.sleep(for: .milliseconds(400))
        #expect(host.showsFilterSidebar == (pinned || sheets.showsFilters), "Closing detail never shows or hides filters")
        #expect(abs(list.bounds.width - availableWidth) < 2)
        #expect(pinDefaults.bool(forKey: filterPinKey) == pinned)
        sheets.showsFilters = false
    }

    @Test func pinnedFiltersStepAsideInPortraitAndReturnInLandscape() async throws {
        let pinDefaults = filterDefaults(pinned: true)
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)])
        store.selectedTab = .map
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets).defaultAppStorage(pinDefaults)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 1194, height: 834))
        defer { host.close() }
        try await filterWait { host.showsFilterSidebar }
        host.resize(CGSize(width: 834, height: 1194))
        try await filterWait { !host.showsFilterSidebar }
        #expect(!sheets.showsFilters, "Portrait never keeps filters resident")
        // Closing the portrait overlay keeps the landscape pin.
        sheets.showsFilters = true
        try await filterWait { host.showsFilterSidebar }
        sheets.showsFilters = false
        try await filterWait { !host.showsFilterSidebar }
        host.resize(CGSize(width: 1194, height: 834))
        try await filterWait { host.showsFilterSidebar }
        #expect(pinDefaults.bool(forKey: filterPinKey))
    }

    @Test func landscapePhoneCanDismissFiltersWithoutChangingContext() async throws {
        let store = ActivityStore(activities: try GalleryLibrary.load().activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        store.searchText = "ride"
        store.dateDayRange = ActivityDayRange(start: "2026-01-01", end: "2026-12-31")
        let filters = StatsFilterScope(store), dates = store.dateDayRange
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.verticalSizeClass, .compact), size: CGSize(width: 844, height: 390))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(250))
        sheets.showsFilters = true
        let presentationDeadline = Date().addingTimeInterval(3)
        while (host.host.presentedViewController == nil || host.host.presentedViewController?.isBeingPresented == true)
            && Date() < presentationDeadline {
            try await Task.sleep(for: .milliseconds(50))
        }
        let presented = try #require(host.host.presentedViewController)
        try await Task.sleep(for: .milliseconds(150))
        let image = UIGraphicsImageRenderer(bounds: presented.view.bounds).image { _ in
            presented.view.drawHierarchy(in: presented.view.bounds, afterScreenUpdates: true)
        }
        try host.save(image, name: "compact-height-filter-sheet")
        sheets.showsFilters = false
        let deadline = Date().addingTimeInterval(3)
        while host.host.presentedViewController != nil && Date() < deadline {
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(host.host.presentedViewController == nil)
        #expect(StatsFilterScope(store) == filters && store.dateDayRange == dates)
        #expect(store.selectedTab == .list)
    }

    @Test func statsFilterPresentationKeepsBrowsingDates() async throws {
        let store = ActivityStore(activities: try GalleryLibrary.load().activities)
        store.dateDayRange = ActivityDayRange(start: "2000-01-01", end: "2000-12-31")
        #expect(store.filteredActivities.isEmpty && !store.statsActivities.isEmpty)
        let host = try FilterHarness(root: NavigationStack {
            FilterPanel(store: store, scope: .stats).navigationTitle("Filters")
        }, size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(250))
        try host.save(host.snapshot(), name: "stats-filter-scope")
        FilterScope.stats.reset(store)
        #expect(store.dateDayRange != nil && store.activeStatsFilterCount == 0)
    }

    @Test func landscapeSidebarKeepsFiltersWhileInspecting() async throws {
        let pinDefaults = filterDefaults(pinned: true)
        let store = ActivityStore(activities: try GalleryLibrary.load().activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        store.distanceFilter = NumericFilter(value: 10000, upperLimit: 80000)
        let root = AppShell(store: store).defaultAppStorage(pinDefaults).environment(\.horizontalSizeClass, .regular)
        let host = try FilterHarness(root: root, size: CGSize(width: 1180, height: 820))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(600))
        let selection = store.selectedActivityIDs
        store.inspect(20279947341)
        try await Task.sleep(for: .milliseconds(600))
        #expect(store.distanceFilter == NumericFilter(value: 10000, upperLimit: 80000))
        #expect(store.selectedActivityIDs == selection)
        #expect(host.host.presentedViewController == nil, "A wide window fits filters, list and detail together")
        try host.save(host.snapshot(), name: "sidebar-landscape-detail")
    }

    @Test(arguments: ["phone", "accessibility", "tablet"])
    func panelRedrawsCountsAndAppliedFilters(scenario: String) async throws {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2, sport: .ride)])
        let size = scenario == "tablet" ? CGSize(width: 768, height: 1024) : CGSize(width: 390, height: 844)
        let root = NavigationStack { FilterPanel(store: store).navigationTitle("Filters") }
            .environment(\.dynamicTypeSize, scenario == "accessibility" ? .accessibility3 : .large)
        let host = try FilterHarness(root: root, size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        let initial = host.snapshot()
        try host.save(initial, name: "filters-\(scenario)-default")
        store.searchText = "Activity 1"
        store.privateFilter = false
        try await Task.sleep(for: .milliseconds(200))
        #expect(store.filteredActivities.isEmpty, "Unknown private flags are excluded by No")
        let filtered = host.snapshot()
        #expect(initial.pngData() != filtered.pngData(), "Count, restrictions and search must redraw")
        try host.save(filtered, name: "filters-\(scenario)-restricted")
        store.resetFilters()
        try await Task.sleep(for: .milliseconds(200))
        #expect(store.filteredActivities.count == 2 && store.activeFilterCount == 0)
        try host.save(host.snapshot(), name: "filters-\(scenario)-reset")
    }

    @Test(arguments: ["phone", "accessibility"])
    func numericEditorDisplaysAppliedUnitsAndRedrawsReset(scenario: String) async throws {
        let store = ActivityStore()
        store.distanceFilter = NumericFilter(operatorType: .lte, value: 1250)
        let root = Form {
            NumericFilterRow(title: "Distance", icon: "ruler", unit: "km", scale: 1000, filter: Binding(
                get: { store.distanceFilter }, set: { store.distanceFilter = $0 }
            ))
        }
        .environment(\.dynamicTypeSize, scenario == "accessibility" ? .accessibility3 : .large)
        let host = try FilterHarness(root: root, size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        #expect(host.descendants(of: UITextField.self).isEmpty, "Compact ranges do not expose text entry")
        let applied = host.snapshot()
        try host.save(host.snapshot(), name: "numeric-\(scenario)-applied")
        store.distanceFilter = nil
        try await Task.sleep(for: .milliseconds(200))
        #expect(applied.pngData() != host.snapshot().pngData(), "External reset must redraw the range and summary")
        try host.save(host.snapshot(), name: "numeric-\(scenario)-reset")
    }
}

let filterPinKey = "browse.filterSidebarPinned"

/// A private preference store, so suites running in parallel never see each
/// other's saved pin. Pass it to the shell with `.defaultAppStorage(_:)`.
func filterDefaults(pinned: Bool? = nil) -> UserDefaults {
    let name = "filter-tests-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    if let pinned { defaults.set(pinned, forKey: filterPinKey) }
    return defaults
}

/// Sets the app-wide saved pin (nil removes it) for the serial gallery run,
/// and returns a restore action.
func setFilterPin(_ value: Bool?) -> () -> Void {
    let defaults = UserDefaults.standard, saved = defaults.object(forKey: filterPinKey)
    if let value { defaults.set(value, forKey: filterPinKey) } else { defaults.removeObject(forKey: filterPinKey) }
    return {
        if let saved { defaults.set(saved, forKey: filterPinKey) }
        else { defaults.removeObject(forKey: filterPinKey) }
    }
}

@MainActor
private func filterWait(_ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(6)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(50)) }
    try #require(condition())
}

@MainActor
private final class FilterHarness<Content: View> {
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
        return UIGraphicsImageRenderer(bounds: host.view.bounds).image {
            _ in host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
    }
    func save(_ image: UIImage, name: String) throws {
        let directory = URL(fileURLWithPath: "/tmp/activitymap-filter-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
    }
    func descendants<T: UIView>(of type: T.Type) -> [T] {
        func visit(_ view: UIView) -> [T] {
            ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap(visit)
        }
        return visit(host.view)
    }
    /// The pinned column or the overlay; both are the 320pt filter panel.
    var showsFilterSidebar: Bool {
        descendants(of: UIScrollView.self).contains { abs($0.bounds.width - 320) < 2 && $0.window != nil }
    }
    func resize(_ size: CGSize) {
        window.frame.size = size
        host.view.frame = window.bounds
    }
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

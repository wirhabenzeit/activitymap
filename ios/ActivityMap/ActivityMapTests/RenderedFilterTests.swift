import SwiftUI
import Testing
import UIKit
import MapboxMaps
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedFilterTests {
    @Test func railFitsListAndDetailWhereThePanelCannot() {
        // Portrait iPads from 10.9-inch to 13-inch: the 320pt panel leaves too
        // little for List and its detail, the rail does not (#354).
        #expect([820, 834, 1024].allSatisfy { BrowsePaneLayout.panelSqueezesDetail(width: $0) })
        // Landscape fits the panel beside List and detail.
        #expect([1133, 1180, 1194, 1366].allSatisfy { !BrowsePaneLayout.panelSqueezesDetail(width: $0) })
        #expect(BrowsePaneLayout.filtersUseSidebar(width: 834, regular: true, accessibilityText: false))
        #expect(!BrowsePaneLayout.filtersUseSidebar(width: 744, regular: true, accessibilityText: false))
        #expect(!BrowsePaneLayout.filtersUseSidebar(width: 1194, regular: false, accessibilityText: false))
        #expect(!BrowsePaneLayout.filtersUseSidebar(width: 1194, regular: true, accessibilityText: true))
    }

    @Test func filterButtonAndRailReadTheActiveFilters() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        #expect(FilterCountBadge.label(count: store.activeFilterCount) == "Filters")
        #expect(FilterPart.allCases.allSatisfy { !$0.isActive(store) })
        store.searchText = "ride"
        store.privateFilter = false
        store.distanceFilter = NumericFilter(value: 10000, upperLimit: 80000)
        #expect(store.activeFilterCount == 3)
        #expect(FilterCountBadge.label(count: store.activeFilterCount) == "Filters, 3 active")
        #expect(Set(FilterPart.allCases.filter { $0.isActive(store) }) == [.search, .distance, .details])
        #expect(!FilterPart.available(in: .stats).contains(.dates))
        #expect(FilterPart.available(in: .browsing) == FilterPart.allCases)
    }

    @Test(arguments: [AppTab.map, .list, .stats])
    func tabletRailStaysAndThePanelSurvivesDestinationSwitches(tab: AppTab) async throws {
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)],
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = tab
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 834, height: 1194))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(350))
        #expect(host.showsFilterRail && !host.showsFilterPanel, "iPad filters start as the rail")
        sheets.showsFilters = true
        try await Task.sleep(for: .milliseconds(450))
        // The wide-window host is the panel, never a duplicate sheet.
        #expect(host.host.presentedViewController == nil && !sheets.shellSheetPresented)
        #expect(host.showsFilterPanel)
        try host.save(host.snapshot(), name: "filter-panel-\(tab.title.lowercased())")
        for next in [AppTab.map, .list, .stats, tab] {
            store.selectedTab = next
            try await Task.sleep(for: .milliseconds(200))
            #expect(sheets.showsFilters && host.showsFilterPanel, "Switching to \(next.title) keeps the panel")
        }
        sheets.showsFilters = false
        try await filterWait { !host.showsFilterPanel && host.showsFilterRail }
        for next in [AppTab.map, .list, .stats, tab] {
            store.selectedTab = next
            try await Task.sleep(for: .milliseconds(200))
            #expect(!host.showsFilterPanel && host.showsFilterRail, "Switching to \(next.title) keeps the rail")
        }
    }

    @Test func resizingDismissesFilterSheetWhenSidebarBecomesAvailable() async throws {
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)])
        store.selectedTab = .list
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 600, height: 834))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(350))
        #expect(!host.showsFilterRail, "Narrow windows use the sheet, not the rail")
        sheets.showsFilters = true
        try await filterWait { host.host.presentedViewController != nil && host.host.presentedViewController?.isBeingPresented == false }
        host.resize(CGSize(width: 1194, height: 834))
        try await filterWait { host.host.presentedViewController == nil && !sheets.showsFilters && !sheets.shellSheetPresented }
        #expect(host.showsFilterRail && !host.showsFilterPanel, "Resizing closes the sheet and shows the rail")
        store.selectedTab = .stats
        try await Task.sleep(for: .milliseconds(250))
        sheets.showsFilters = true
        try await Task.sleep(for: .milliseconds(350))
        #expect(host.host.presentedViewController == nil && !sheets.shellSheetPresented)
        #expect(host.showsFilterPanel)
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

    @Test(arguments: ["portrait", "landscape"])
    func filtersNeverSqueezeListAndDetail(layout: String) async throws {
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)],
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        let portrait = layout == "portrait"
        let size = portrait ? CGSize(width: 834, height: 1194) : CGSize(width: 1194, height: 834)
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(450))
        let list = try #require(host.descendants(of: UICollectionView.self).first { $0.bounds.width > 400 })
        let beside = size.width - FilterRail.width - 1
        #expect(abs(list.bounds.width - beside) < 2)
        store.inspect(1)
        try await Task.sleep(for: .milliseconds(500))
        #expect(host.host.presentedViewController == nil && list.window != nil)
        let withDetail = Self.listWidth(beside: beside)
        #expect(abs(list.bounds.width - withDetail) < 2, "Detail stays beside the retained list rather than pushing")
        sheets.showsFilters = true
        try await Task.sleep(for: .milliseconds(450))
        #expect(host.showsFilterPanel && list.window != nil)
        if portrait {
            // The panel floats over List and its detail instead of squeezing them.
            #expect(abs(list.bounds.width - withDetail) < 2)
        } else {
            // Landscape fits the panel as a column beside both.
            let narrower = Self.listWidth(beside: size.width - BrowsePaneLayout.filterWidth - 1)
            #expect(abs(list.bounds.width - narrower) < 2)
        }
        try host.save(host.snapshot(), name: "list-detail-panel-\(layout)")
        // Map and Stats are one column, so the panel sits beside them; no
        // destination shows or hides it (#354).
        for tab in [AppTab.map, .stats, .list] {
            store.selectedTab = tab
            try await Task.sleep(for: .milliseconds(250))
            #expect(sheets.showsFilters && host.showsFilterPanel, "\(tab.title) keeps the panel")
        }
        sheets.showsFilters = false
        try await filterWait {
            host.showsFilterRail && !host.showsFilterPanel && abs(list.bounds.width - withDetail) < 2
        }
        #expect(abs(list.bounds.width - withDetail) < 2)
        store.dismissInspection()
        try await Task.sleep(for: .milliseconds(400))
        #expect(abs(list.bounds.width - beside) < 2)
        #expect(host.showsFilterRail, "Closing detail never shows or hides filters")
    }

    @Test func openingAnActivityCollapsesTheExpandedPanelInPortrait() async throws {
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)],
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        let sheets = BrowseSheetPresentation()
        sheets.showsFilters = true
        let size = CGSize(width: 834, height: 1194)
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(450))
        let list = try #require(host.descendants(of: UICollectionView.self).first { $0.bounds.width > 400 })
        #expect(host.showsFilterPanel)
        #expect(abs(list.bounds.width - (size.width - BrowsePaneLayout.filterWidth - 1)) < 2,
                "One-column List keeps the panel as a column")
        store.inspect(1)
        try await filterWait { !sheets.showsFilters && host.showsFilterRail }
        try await Task.sleep(for: .milliseconds(400))
        // List waited for the rail instead of pushing its detail full width.
        #expect(list.window != nil && host.host.presentedViewController == nil)
        #expect(abs(list.bounds.width - Self.listWidth(beside: size.width - FilterRail.width - 1)) < 2)
        try host.save(host.snapshot(), name: "list-detail-collapsed-panel")
        store.dismissInspection()
        try await Task.sleep(for: .milliseconds(400))
        #expect(!sheets.showsFilters, "Closing detail leaves the rail rather than restoring the panel")
    }

    /// ListScreen's adjacent detail: 340–420pt plus a divider.
    private static func listWidth(beside width: CGFloat) -> CGFloat {
        width - min(420, max(340, width * 0.42)) - 1
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
        let store = ActivityStore(activities: try GalleryLibrary.load().activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        store.distanceFilter = NumericFilter(value: 10000, upperLimit: 80000)
        let sheets = BrowseSheetPresentation()
        sheets.showsFilters = true
        let root = AppShell(store: store, sheets: sheets).environment(\.horizontalSizeClass, .regular)
        let host = try FilterHarness(root: root, size: CGSize(width: 1180, height: 820))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(600))
        let selection = store.selectedActivityIDs
        store.inspect(20279947341)
        try await Task.sleep(for: .milliseconds(600))
        #expect(store.distanceFilter == NumericFilter(value: 10000, upperLimit: 80000))
        #expect(store.selectedActivityIDs == selection)
        #expect(host.host.presentedViewController == nil, "A wide window fits filters, list and detail together")
        #expect(sheets.showsFilters && host.showsFilterPanel)
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
    /// The full filter panel, as a column or floating over List and its detail.
    var showsFilterPanel: Bool {
        descendants(of: UIScrollView.self).contains {
            abs($0.bounds.width - BrowsePaneLayout.filterWidth) < 2 && $0.window != nil
        }
    }
    var showsFilterRail: Bool {
        descendants(of: UIScrollView.self).contains { abs($0.bounds.width - FilterRail.width) < 1 && $0.window != nil }
    }
    func resize(_ size: CGSize) {
        window.frame.size = size
        host.view.frame = window.bounds
    }
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

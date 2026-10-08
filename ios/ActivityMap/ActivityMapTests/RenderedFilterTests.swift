import SwiftUI
import Testing
import UIKit
import MapboxMaps
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedFilterTests {
    @Test(arguments: [AppTab.map, .list, .stats])
    func nativeTabletHeaderDoesNotPresentFiltersOverSidebar(tab: AppTab) async throws {
        let key = "browse.filterSidebarVisible", defaults = UserDefaults.standard
        let saved = defaults.object(forKey: key)
        defaults.set(true, forKey: key)
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer {
            MapboxOptions.accessToken = token
            if let saved { defaults.set(saved, forKey: key) }
            else { defaults.removeObject(forKey: key) }
        }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)],
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = tab
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 1194, height: 834))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(350))
        let sidebar = try #require(host.descendants(of: UIScrollView.self).first { abs($0.bounds.width - 320) < 2 })
        // A stale sheet request must never duplicate filters while the native
        // toolbar's wide-window presentation uses the sidebar.
        sheets.showsFilters = true
        try await Task.sleep(for: .milliseconds(450))
        #expect(host.host.presentedViewController == nil && !sheets.shellSheetPresented)
        #expect(host.descendants(of: UIScrollView.self).contains { $0 === sidebar })
        sheets.showsFilters = false
        try host.save(host.snapshot(), name: "native-sidebar-\(tab.title.lowercased())")
    }

    @Test func resizingDismissesFilterSheetWhenSidebarBecomesAvailable() async throws {
        let key = "browse.filterSidebarVisible", defaults = UserDefaults.standard
        let saved = defaults.object(forKey: key)
        defaults.set(true, forKey: key)
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer {
            MapboxOptions.accessToken = token
            if let saved { defaults.set(saved, forKey: key) }
            else { defaults.removeObject(forKey: key) }
        }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)])
        store.selectedTab = .list
        let sheets = BrowseSheetPresentation()
        let host = try FilterHarness(root: AppShell(store: store, sheets: sheets)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 600, height: 834))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(350))
        sheets.showsFilters = true
        try await filterWait { host.host.presentedViewController != nil && host.host.presentedViewController?.isBeingPresented == false }
        host.window.frame.size.width = 1194
        host.host.view.frame = host.window.bounds
        try await filterWait { host.host.presentedViewController == nil && !sheets.showsFilters && !sheets.shellSheetPresented }
        store.selectedTab = .stats
        try await Task.sleep(for: .milliseconds(250))
        sheets.showsFilters = true
        try await Task.sleep(for: .milliseconds(350))
        #expect(host.host.presentedViewController == nil && !sheets.shellSheetPresented)
        #expect(host.descendants(of: UIScrollView.self).contains { abs($0.bounds.width - 320) < 2 })
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

    @Test(arguments: ["portrait", "landscape", "sidebar-hidden"])
    func listDetailAdaptsFiltersAndRestoresPreference(layout: String) async throws {
        let key = "browse.filterSidebarVisible", defaults = UserDefaults.standard
        let saved = defaults.object(forKey: key)
        let prefersSidebar = layout != "sidebar-hidden"
        defaults.set(prefersSidebar, forKey: key)
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer {
            MapboxOptions.accessToken = token
            if let saved { defaults.set(saved, forKey: key) }
            else { defaults.removeObject(forKey: key) }
        }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, route: false)],
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        let size = layout == "landscape" ? CGSize(width: 1194, height: 834) : CGSize(width: 834, height: 1194)
        let host = try FilterHarness(root: AppShell(store: store)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(450))
        let list = try #require(host.descendants(of: UICollectionView.self).first { $0.bounds.width > 400 })
        let initialWidth = list.bounds.width
        store.inspect(1)
        try await Task.sleep(for: .milliseconds(500))
        #expect(host.host.presentedViewController == nil)
        #expect(host.descendants(of: UICollectionView.self).contains { $0 === list })
        let availableWidth = layout == "landscape" ? size.width - 321 : size.width
        let expectedListWidth = availableWidth - min(420, max(340, availableWidth * 0.42)) - 1
        #expect(abs(list.bounds.width - expectedListWidth) < 2, "Detail stays beside the retained list rather than pushing")
        let sidebarShown = host.descendants(of: UIScrollView.self).contains { abs($0.bounds.width - 320) < 2 }
        #expect(sidebarShown == (layout == "landscape"))
        #expect(defaults.bool(forKey: key) == prefersSidebar, "Automatic collapse does not change the saved preference")
        try host.save(host.snapshot(), name: "adaptive-list-detail-\(layout)")
        store.dismissInspection()
        try await Task.sleep(for: .milliseconds(400))
        #expect(abs(list.bounds.width - initialWidth) < 2)
        #expect(host.descendants(of: UIScrollView.self).contains { abs($0.bounds.width - 320) < 2 } == prefersSidebar)
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
        let key = "browse.filterSidebarVisible"
        let previous = UserDefaults.standard.object(forKey: key)
        UserDefaults.standard.set(true, forKey: key)
        defer {
            if let previous { UserDefaults.standard.set(previous, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
        let store = ActivityStore(activities: try GalleryLibrary.load().activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        store.distanceFilter = NumericFilter(value: 10000, upperLimit: 80000)
        let root = AppShell(store: store).environment(\.horizontalSizeClass, .regular)
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
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

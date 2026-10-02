import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct RenderedFilterTests {
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
        let field = try #require(host.descendants(of: UITextField.self).last)
        #expect(field.text == "1.25", "Editor must convert metres to displayed kilometres")
        try host.save(host.snapshot(), name: "numeric-\(scenario)-applied")
        store.distanceFilter = nil
        try await Task.sleep(for: .milliseconds(200))
        #expect(field.text == "", "External reset clears the displayed threshold")
        try host.save(host.snapshot(), name: "numeric-\(scenario)-reset")
    }
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

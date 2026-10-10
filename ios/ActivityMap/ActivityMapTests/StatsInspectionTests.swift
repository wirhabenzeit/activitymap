import SwiftUI
import UIKit
import Observation
import MapboxMaps
import Testing
@testable import ActivityMap

/// Exercise the real NavigationStack and adaptive inspector, including the
/// second pop back to the retained dashboard. Selection is independent of Stats.
@MainActor @Suite(.serialized) struct StatsInspectionTests {
    @Test func productionShellKeepsStatsInspectionSeparateFromListNavigation() async throws {
        try await inspectionWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState()
        await StatsDashboardTests.load(state, store)
        let id = try #require(store.activities.first?.id)
        let originalSelected = store.selectedActivityIDs
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let host = try InspectionHarness(root: AppShell(store: store, statsContent: destination)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##)),
            size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await inspectionWait { host.navigation != nil }
        let navigation = try #require(host.navigation)
        state.toggleExpansion(.records)
        try await inspectionWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        state.inspectedActivityID = id
        try await inspectionWait { navigation.viewControllers.count == 3 && navigation.transitionCoordinator == nil }
        try await inspectionWait { host.accessible(label: "Back to Records") != nil }
        #expect(store.inspectedActivityID == nil && store.selectedActivityIDs == originalSelected)
        navigation.popViewController(animated: false)
        try await inspectionWait { navigation.viewControllers.count == 2 && state.inspectedActivityID == nil }
        #expect(state.expandedTile == .records && store.selectedTab == .stats)
        navigation.popViewController(animated: false)
        try await inspectionWait { navigation.viewControllers.count == 1 && state.expandedTile == nil }
        #expect(store.inspectedActivityID == nil && store.selectedActivityIDs == originalSelected)
    }

    @Test(arguments: [false, true])
    func narrowInspectionReturnsToSameFocusAndChoices(largeText: Bool) async throws {
        try await inspectionWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState()
        let tile = try #require(StatsDashboard.tiles.first { $0.id == .monthVsLastMonth })
        state.select(.elevation, for: tile)
        let selectedDay = store.stats.reportingDay
        state.inspection(.monthVsLastMonth)?.monthDay = selectedDay
        await StatsDashboardTests.load(state, store)
        let id = try #require(store.activities.first?.id)
        let originalSelected = store.selectedActivityIDs, originalActive = store.activeActivityID
        let host = try InspectionHarness(root: StatsScreen(store: store, dashboard: state)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large), size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await inspectionWait { host.navigation != nil }
        let navigation = try #require(host.navigation)
        state.toggleExpansion(.monthVsLastMonth)
        try await inspectionWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        state.inspectedActivityID = id
        try await inspectionWait { navigation.viewControllers.count == 3 && navigation.transitionCoordinator == nil }
        #expect(store.selectedTab == .stats && store.selectedActivityIDs == originalSelected && store.activeActivityID == originalActive)
        #expect(store.inspectedActivityID == nil, "Stats inspection must not replace List inspection")
        #expect(host.accessible(label: "Back to This month") != nil)
        navigation.popViewController(animated: false)
        try await inspectionWait { navigation.viewControllers.count == 2 && state.inspectedActivityID == nil }
        #expect(state.expandedTile == .monthVsLastMonth && state.option(.monthVsLastMonth) == .elevation)
        #expect(state.inspection(.monthVsLastMonth)?.monthDay == selectedDay)
        navigation.popViewController(animated: false)
        try await inspectionWait { navigation.viewControllers.count == 1 && state.expandedTile == nil }
        #expect(state.option(.monthVsLastMonth) == .elevation && state.inspection(.monthVsLastMonth)?.monthDay == selectedDay)
    }

    @Test(arguments: ["phone", "wide"])
    func capturesRecordsPodiumsAndActivityInspection(width: String) async throws {
        try await inspectionWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let library = try GalleryLibrary.load()
        let store = ActivityStore(activities: library.activities, listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-10-07")), timeZone: .gmt)
        store.selectedTab = .stats
        let state = StatsDashboardState()
        await StatsDashboardTests.load(state, store)
        let wide = width == "wide"
        let host = try InspectionHarness(root: StatsScreen(store: store, dashboard: state)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, wide ? .regular : .compact)
            .environment(\.colorScheme, .light),
            size: wide ? CGSize(width: 1194, height: 1000) : CGSize(width: 402, height: 874))
        defer { host.close() }
        try await inspectionWait { host.navigation != nil }
        let navigation = try #require(host.navigation)
        state.toggleExpansion(.records)
        try await inspectionWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        try await Task.sleep(for: .milliseconds(200))
        try host.capture("records-\(width)")
        guard case .records(let records, _, _) = state.result(.records, source: StatsDashboardSource(store)) else {
            Issue.record("Missing records"); return
        }
        state.inspectedActivityID = try #require(records.activities[.distance]?.activityID)
        try await inspectionWait {
            wide ? host.accessible(label: "Close activity details") != nil
                : navigation.viewControllers.count == 3 && navigation.transitionCoordinator == nil
        }
        try await Task.sleep(for: .milliseconds(200))
        try host.capture("records-\(width)-activity")
        #expect(store.selectedActivityIDs.isEmpty && store.inspectedActivityID == nil)
    }

    @Test func regularPanelReflowsToPushWithoutLosingActivityOrRecordPeriod() async throws {
        try await inspectionWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState(), viewport = InspectionViewport()
        state.inspection(.records)?.recordsRange = .allTime
        await StatsDashboardTests.load(state, store)
        let ids = Array(store.activities.prefix(2).map(\.id))
        try #require(ids.count == 2)
        let originalSelected = store.selectedActivityIDs, originalActive = store.activeActivityID
        let host = try InspectionHarness(root: InspectionAdaptiveRoot(store: store, state: state, viewport: viewport),
                                         size: CGSize(width: 1194, height: 1000))
        defer { host.close() }
        try await inspectionWait { host.navigation != nil }
        let navigation = try #require(host.navigation)
        state.toggleExpansion(.records)
        try await inspectionWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        state.inspectedActivityID = ids[0]
        try await inspectionWait { host.accessible(label: "Close activity details") != nil }
        #expect(navigation.viewControllers.count == 2, "Regular width keeps inspection alongside Records")
        state.inspectedActivityID = ids[1]
        try await Task.sleep(for: .milliseconds(100))
        #expect(navigation.viewControllers.count == 2 && state.inspectedActivityID == ids[1])
        let close = try #require(host.accessible(label: "Close activity details"))
        #expect(close.accessibilityFrame.width >= 44 && close.accessibilityFrame.height >= 44)
        viewport.width = 650
        try await inspectionWait { navigation.viewControllers.count == 3 && navigation.transitionCoordinator == nil }
        #expect(state.inspectedActivityID == ids[1])
        viewport.width = 1100
        try await Task.sleep(for: .milliseconds(100))
        #expect(navigation.viewControllers.count == 3, "An already-pushed detail stays stable through a width change")
        navigation.popViewController(animated: false)
        try await inspectionWait { navigation.viewControllers.count == 2 && state.inspectedActivityID == nil }
        #expect(state.expandedTile == .records && state.inspection(.records)?.recordsRange == .allTime)
        #expect(store.selectedActivityIDs == originalSelected && store.activeActivityID == originalActive && store.inspectedActivityID == nil)
        state.inspectedActivityID = ids[0]
        try await inspectionWait { host.accessible(label: "Close activity details") != nil }
        #expect(navigation.viewControllers.count == 2, "The next inspection uses the newly available wide panel")
        state.inspectedActivityID = nil
        try await inspectionWait { host.accessible(label: "Close activity details") == nil }
        #expect(state.expandedTile == .records)
    }
}

@MainActor @Observable private final class InspectionViewport { var width: CGFloat = 1100 }
private struct InspectionAdaptiveRoot: View {
    let store: ActivityStore
    let state: StatsDashboardState
    let viewport: InspectionViewport
    var body: some View {
        StatsScreen(store: store, dashboard: state)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, .regular)
            .frame(width: viewport.width, height: 950)
    }
}
@MainActor private func inspectionWait(_ condition: () -> Bool, file: StaticString = #fileID, line: UInt = #line) async throws {
    let deadline = Date().addingTimeInterval(12)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(40)) }
    try #require(condition(), "Stats activity inspection did not reach the expected state at \(file):\(line)")
}
@MainActor private final class InspectionHarness<Content: View> {
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
    var navigation: UINavigationController? {
        func find(_ controller: UIViewController) -> UINavigationController? {
            if let navigation = controller as? UINavigationController { return navigation }
            return controller.children.compactMap(find).first
        }
        return find(host)
    }
    func accessible(label: String) -> NSObject? {
        var visited: Set<ObjectIdentifier> = []
        func visit(_ object: NSObject) -> NSObject? {
            guard visited.insert(ObjectIdentifier(object)).inserted else { return nil }
            if object.accessibilityLabel == label && !object.accessibilityFrame.isEmpty { return object }
            let count = object.accessibilityElementCount()
            if count > 0 && count < 1000 {
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
    func capture(_ name: String) throws {
        host.view.layoutIfNeeded()
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds, format: format).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let directory = URL(fileURLWithPath: "/tmp/activitymap-stats-parity-inspection")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try #require(image.pngData()).write(to: directory.appendingPathComponent("\(name).png"))
    }
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

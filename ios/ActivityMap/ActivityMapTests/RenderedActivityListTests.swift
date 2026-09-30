import MapboxMaps
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
        #expect(abs(list.contentOffset.y - offset) < 1, "Retained List restores its exact scroll position and inline expansion")
        try host.save("list-tablet-retained-inspection")
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
private func listWait(_ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(8)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(50)) }
    try #require(condition())
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
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

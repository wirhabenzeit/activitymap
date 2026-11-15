import SwiftUI
import Testing
import UIKit
import Vision
@testable import ActivityMap

extension RenderedRoutePickingTests {
    @Test func statsPreparingHistoryRendersLoadingInsteadOfBlankDashboard() async throws {
        let store = ActivityStore()
        store.selectedTab = .stats
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let host = try SummaryHarness(root: StatsScreen(store: store).environment(\.localStore, storage),
                                      size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(250))
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        let image = UIGraphicsImageRenderer(bounds: host.host.view.bounds).image { _ in
            host.host.view.drawHierarchy(in: host.host.view.bounds, afterScreenUpdates: true)
        }
        try VNImageRequestHandler(cgImage: try #require(image.cgImage)).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        #expect(text.contains("Loading activity history"), "The actual Stats screen explains its initial loading state: \(text)")
        #expect(!text.contains("No activity history"))
        try host.save("stats-history-loading")
    }

    @Test func savedListSummaryRestoresWithoutBreakingLazyRows() async throws {
        let preferences = ActivityListPresentation(defaults: nil)
        preferences.settings.summaryMode = .filtered
        let models = (1...2000).map { id in
            var activity = ActivityStoreSelectionTests.activity(id)
            activity.distance = Double(id)
            return activity
        }
        let store = ActivityStore(activities: models, listPresentation: preferences)
        store.selectedTab = .list
        let host = try SummaryHarness(root: NavigationStack { ListScreen(store: store) }
            .environment(\.horizontalSizeClass, .regular), size: CGSize(width: 768, height: 1024))
        defer { host.close() }
        try await summaryWait { host.descendants(of: UICollectionView.self).contains { $0.contentSize.height > $0.bounds.height * 2 } }
        let list = try #require(host.descendants(of: UICollectionView.self).first { $0.contentSize.height > $0.bounds.height * 2 })
        let original = try #require(store.activitySummary)
        #expect(original.activityCount == 2000 && original[.distance].value == 2_001_000)
        #expect(list.visibleCells.count < 100)
        #expect((0..<list.numberOfSections).reduce(0) { $0 + list.numberOfItems(inSection: $1) } == 2001,
                "Saved filtered totals add one scrollable summary before the lazy activity rows")
        try host.save("summary-tablet-filtered")
        list.setContentOffset(CGPoint(x: 0, y: 2400), animated: false)
        try await Task.sleep(for: .milliseconds(120))
        store.inspect(1980)
        store.dismissInspection()
        preferences.settings.sort = .init(field: .id, direction: .ascending)
        try await Task.sleep(for: .milliseconds(120))
        #expect(store.activitySummary == original)
        #expect(store.summaryCache.buildCount == 1, "Rows offscreen and detail/sort transitions cannot invalidate a whole-filter total")
        #expect(store.selectedActivityIDs.isEmpty)
    }

    @Test(arguments: ["small-phone", "large-text", "tablet-expanded", "selected-hidden", "empty-filtered", "all-unknown"])
    func summariesAdaptAndDiscloseExactScope(scenario: String) async throws {
        let preferences = ActivityListPresentation(defaults: nil)
        preferences.settings.summaryMode = scenario == "selected-hidden" ? .selected : .filtered
        let partial = try StoredModelMapper.activity(Fixtures.activity([
            "id": "1", "distance": 1200, "elapsed_time": 600, "total_elevation_gain": 50,
            "moving_time": 540, "average_speed": 2, "average_heartrate": 120,
            "elev_high": NSNull(), "elev_low": -12, "average_watts": 0,
        ]))
        var unknown = partial
        unknown.distance = nil; unknown.elapsedTime = nil; unknown.totalElevationGain = nil
        unknown.movingTime = nil; unknown.averageSpeed = nil; unknown.averageHeartrate = nil
        unknown.elevLow = nil; unknown.averageWatts = nil; unknown.maxWatts = nil; unknown.weightedAverageWatts = nil
        let second = try StoredModelMapper.activity(Fixtures.activity([
            "id": "2", "distance": 0, "elapsed_time": 0, "total_elevation_gain": 0, "sport_type": "Ride",
        ]))
        let store = ActivityStore(activities: scenario == "all-unknown" ? [unknown] : [partial, second], listPresentation: preferences)
        store.selectedTab = .list
        if scenario == "selected-hidden" {
            store.replaceSelection(with: [1, 2])
            store.searchText = "No activity matches"
            #expect(store.filteredActivities.isEmpty && store.hiddenSelectedCount == 2)
            #expect(store.activitySummary?.activityCount == 2 && store.activitySummary?[.distance].value == 1200)
        } else if scenario == "empty-filtered" {
            store.searchText = "No activity matches"
            #expect(store.activitySummary?.activityCount == 0 && store.activitySummary?[.distance].value == 0)
        }
        let tablet = scenario == "tablet-expanded"
        let size = tablet ? CGSize(width: 768, height: 1024) : CGSize(width: 320, height: 700)
        let root = ScrollView {
            ActivitySummaryView(store: store, allMetricsExpanded: tablet || scenario == "large-text").padding()
        }
        .environment(\.horizontalSizeClass, tablet ? .regular : .compact)
        .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large)
        let host = try SummaryHarness(root: NavigationStack { root.navigationTitle("Activities") }, size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(250))
        try host.save("summary-\(scenario)")
        if scenario == "large-text" {
            let scroll = try #require(host.descendants(of: UIScrollView.self).first { $0.contentSize.height > $0.bounds.height })
            scroll.setContentOffset(CGPoint(x: 0, y: min(700, scroll.contentSize.height - scroll.bounds.height)), animated: false)
            try await Task.sleep(for: .milliseconds(100))
            try host.save("summary-large-text-scrolled")
        }
    }
}

@MainActor
private func summaryWait(_ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(10)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
    try #require(condition())
}

@MainActor
private final class SummaryHarness<Content: View> {
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
        let directory = URL(fileURLWithPath: "/private/tmp/activitymap-ios-212-screenshots")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
    }
    func descendants<T: UIView>(of type: T.Type) -> [T] {
        func visit(_ view: UIView) -> [T] { ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap(visit) }
        return visit(host.view)
    }
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

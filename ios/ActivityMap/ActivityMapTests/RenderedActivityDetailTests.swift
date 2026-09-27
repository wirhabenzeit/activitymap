import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

extension RenderedRoutePickingTests {
    @Test func detailUpdatesInPlaceAndHandlesDeletion() async throws {
        var activity = try StoredModelMapper.activity(Fixtures.activity([
            "sport_type": "Ride", "name": "Morning ride", "description": "Along the river", "distance": 31200,
            "elapsed_time": 7200, "average_heartrate": 124, "max_heartrate": NSNull(),
            "average_watts": NSNull(), "max_watts": 0,
        ]))
        let store = ActivityStore(activities: [activity])
        let host = try DetailHarness(root: ActivityDetailView(store: store, activityID: activity.id), size: CGSize(width: 390, height: 844))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        let before = host.snapshot()
        activity.name = "Updated ride after sync"
        activity.distance = 48200
        store.activities = [activity]
        try await Task.sleep(for: .milliseconds(200))
        let updated = host.snapshot()
        #expect(before.pngData() != updated.pngData(), "An open detail must redraw committed changes to the same activity ID")
        try host.save(updated, name: "detail-updated")
        store.activities = []
        try await Task.sleep(for: .milliseconds(200))
        let removed = host.snapshot()
        #expect(updated.pngData() != removed.pngData(), "Deleted activity must not leave its old metrics/actions visible")
        try host.save(removed, name: "detail-deleted")
    }

    @Test(arguments: ["phone", "accessibility", "tablet", "landscape", "no-gps"])
    func detailAdaptivePresentation(scenario: String) async throws {
        let tablet = scenario == "tablet"
        let landscape = scenario == "landscape"
        let accessibility = scenario == "accessibility"
        let size = tablet ? CGSize(width: 768, height: 1024) : landscape ? CGSize(width: 844, height: 390) : CGSize(width: 390, height: 844)
        var activity = try StoredModelMapper.activity(Fixtures.activity([
            "sport_type": "Ride", "name": "A long ride through the hills and home along the river",
            "description": String(repeating: "Quiet roads, a steep climb, and a stop by the lake.\n", count: 20),
            "distance": 31200, "elapsed_time": 4476, "total_elevation_gain": 820,
            "moving_time": 4000, "average_speed": 7.8, "max_speed": 16,
            "elev_high": NSNull(), "elev_low": -12, "average_heartrate": 124, "max_heartrate": NSNull(),
            "average_watts": NSNull(), "max_watts": 0, "weighted_average_watts": 180,
        ]))
        if scenario == "no-gps" { activity.coordinates = []; activity.distance = nil; activity.totalElevationGain = 0 }
        let store = ActivityStore(activities: [activity])
        store.selectedTab = .list
        store.inspect(activity.id)
        let root = Group {
            if tablet {
                NavigationStack { ListScreen(store: store).navigationTitle("Activities") }
                    .environment(\.horizontalSizeClass, .regular)
            } else {
                ActivityDetailView(store: store, activityID: activity.id)
            }
        }
        .environment(\.dynamicTypeSize, accessibility ? .accessibility3 : .large)
        .preferredColorScheme(scenario == "no-gps" ? .dark : .light)
        let host = try DetailHarness(root: root, size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(250))
        #expect(store.selectedActivityIDs.isEmpty && store.activeActivityID == nil, "Opening list detail must not change map selection")
        try host.save(host.snapshot(), name: "detail-\(scenario)")
        let scrolls = host.descendants(of: UIScrollView.self)
        let detailScroll = try #require(scrolls.first { $0.contentSize.height > $0.bounds.height + 100 })
        detailScroll.setContentOffset(CGPoint(x: 0, y: detailScroll.contentSize.height - detailScroll.bounds.height), animated: false)
        try await Task.sleep(for: .milliseconds(100))
        try host.save(host.snapshot(), name: "detail-\(scenario)-scrolled")
    }
}

@MainActor
private final class DetailHarness<Content: View> {
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
        return UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
    }
    func save(_ image: UIImage, name: String) throws {
        let directory = URL(fileURLWithPath: "/tmp/activitymap-detail-preview")
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

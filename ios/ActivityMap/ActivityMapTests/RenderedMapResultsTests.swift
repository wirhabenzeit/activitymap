import MapboxMaps
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

extension RenderedRoutePickingTests {
    @Test(arguments: ["single", "multiple", "compact", "wide", "landscape", "large-text", "hidden", "hidden-request", "no-gps"])
    func renderedMapResults(scenario: String) async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        var activities = (1...4).map { ActivityStoreSelectionTests.activity($0, route: $0 != 4) }
        let names = ["Morning ride along the river", "Through the forest", "Evening loop", "Indoor training"]
        for i in activities.indices {
            activities[i].name = names[i]
            activities[i].distance = 31200
            activities[i].elapsedTime = 4476
            activities[i].totalElevationGain = 820
        }
        activities[1].sportType = .ride
        let store = ActivityStore(activities: activities)
        let picker = RoutePicker()
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        let size = scenario == "wide" ? CGSize(width: 768, height: 1024) : scenario == "landscape" ? CGSize(width: 844, height: 390) : CGSize(width: 390, height: 844)
        window.frame = CGRect(origin: .zero, size: size)
        let root = MapScreen(store: store, topOcclusion: 62, picker: picker)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style))
            .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility2 : .large)
        let host = UIHostingController(rootView: root)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
        host.view.frame = window.bounds
        try await resultsWait { self.mapView(in: host.view) != nil }
        let map = try #require(mapView(in: host.view))
        try await resultsWait { map.mapboxMap.isStyleLoaded }
        try await Task.sleep(for: .milliseconds(100))
        map.mapboxMap.setCamera(to: CameraOptions(center: CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005), zoom: 13))
        let single = scenario == "single" || scenario == "compact" || scenario == "large-text" || scenario == "hidden"
        store.replaceSelection(with: single ? [1] : [1, 2, 3, 4])
        picker.reviewSelection(store: store)
        if scenario == "no-gps" { picker.showDetail(4, store: store) }
        if scenario == "compact" { picker.detent = .compact }
        if scenario == "large-text" { picker.detent = .expanded }
        if scenario == "hidden" { store.activeSportTypes = [] }
        if scenario == "hidden-request" {
            store.showOnMap(1)
            store.activeSportTypes = [.ride]
        }
        try await Task.sleep(for: .milliseconds(200))
        if scenario == "hidden-request" {
            try await resultsWait { store.mapContext.pendingRequest == nil }
            #expect(store.activeActivityID == nil && store.mapContext.hiddenTargetID == 1,
                    "A now-hidden queued target must not activate another remaining result")
        }
        let savedCamera = store.mapContext.camera
        let savedDetent = picker.detent
        let savedDetail = picker.detailID
        try saveResults(host.view, name: scenario)
        let scroll = resultsScroll(in: host.view)
        if let scroll { scroll.setContentOffset(CGPoint(x: 0, y: min(60, max(0, scroll.contentSize.height - scroll.bounds.height))), animated: false) }
        let scrollOffset = scroll?.contentOffset.y
        // The actual MapScreen tab-change handlers must leave presentation intact.
        store.selectedTab = .list
        try await Task.sleep(for: .milliseconds(100))
        store.selectedTab = .map
        try await Task.sleep(for: .milliseconds(100))
        #expect(picker.isPresented && picker.detent == savedDetent && picker.detailID == savedDetail)
        #expect(mapView(in: host.view) === map)
        if let scroll {
            #expect(resultsScroll(in: host.view) === scroll)
            #expect(scroll.contentOffset.y == scrollOffset)
        }
        #expect(abs(store.mapContext.camera.zoom - savedCamera.zoom) < 0.01)
        picker.detent = .compact
        try await Task.sleep(for: .milliseconds(100))
        #expect(store.mapContext.pendingRequest == nil && abs(store.mapContext.camera.zoom - savedCamera.zoom) < 0.01)
        if scenario == "single" || scenario == "wide" {
            picker.detent = .expanded
            store.mapContext.request(.fitSelection)
            try await resultsWait { store.mapContext.pendingRequest == nil }
            try await Task.sleep(for: .milliseconds(650))
            #expect(picker.detent == .medium, "Explicit fits keep the results/profile open")
            let points = map.mapboxMap.points(for: activities[0].coordinates)
            let layout = MapResultsLayout(size: host.view.bounds.size, topInset: 62, bottomInset: host.view.safeAreaInsets.bottom, detent: .medium)
            if layout.isSidePanel {
                #expect(points.allSatisfy { $0.x < layout.frame.minX }, "Fit must leave routes to the left of the right-hand panel")
            } else {
                #expect(points.allSatisfy { $0.y < layout.frame.minY - 16 }, "Fit must leave routes above the panel")
            }
        }
        store.clearSelection()
        try await resultsWait { !picker.isPresented }
    }

    private func resultsScroll(in view: UIView) -> UIScrollView? {
        if let scroll = view as? UIScrollView { return scroll }
        return view.subviews.compactMap { resultsScroll(in: $0) }.first
    }

    private func mapView(in view: UIView) -> MapView? {
        if let map = view as? MapView { return map }
        return view.subviews.compactMap { mapView(in: $0) }.first
    }

    private func resultsWait(sourceLocation: SourceLocation = #_sourceLocation, _ condition: () -> Bool) async throws {
        let end = Date().addingTimeInterval(10)
        while !condition(), Date() < end { try await Task.sleep(for: .milliseconds(30)) }
        try #require(condition(), "Map results state timed out", sourceLocation: sourceLocation)
    }

    private func saveResults(_ view: UIView, name: String) throws {
        let directory = URL(fileURLWithPath: "/tmp/activitymap-results-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: view.bounds).image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        try image.pngData()?.write(to: directory.appendingPathComponent("results-\(name).png"))
    }
}

import CoreLocation
import Foundation
import MapLibre
import Testing
import UIKit
@testable import ActivityMap

/// Exercise the real renderer/query adapter with a bundled, network-free style.
/// This is intentionally separate from native touch/VoiceOver device acceptance.
@MainActor @Suite(.serialized)
struct RenderedRoutePickingTests {
    @Test func renderedOverlapsFiltersAndSelectionReuseOneSource() async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }

        let center = CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005)
        let harness = try await CameraHarness(size: CGSize(width: 390, height: 700))
        defer { harness.close() }
        let map = harness.map
        map.renderer.setCamera(to: MapCamera(center: center, zoom: 13))

        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(10),
                                               ActivityStoreSelectionTests.activity(9, sport: .ride)])
        let picker = RoutePicker()
        store.routeGeometry.update(activities: store.activities, revision: store.activitiesRevision)
        // A style without the route layer must not be mistaken for an empty tap.
        store.replaceSelection(with: [9])
        picker.pick(at: .zero, map: map.renderer, store: store)
        #expect(picker.errorMessage != nil && store.selectedActivityIDs == [9])
        picker.errorMessage = nil
        func render() async throws {
            let style = try #require(map.style)
            RouteLayers(data: store.routeGeometry.data, visibleIDs: store.visibleActivityIDs,
                        selectedIDs: store.selectedActivityIDs, activeID: store.activeActivityID).sync(style: style)
            try await Task.sleep(for: .milliseconds(250))

        }
        try await render()
        let point = map.renderer.point(for: center)
        // A near miss on a 3pt stroke still picks both identical routes.
        picker.pick(at: CGPoint(x: point.x + 10, y: point.y), map: map.renderer, store: store)
        try await waitUntil { picker.isPresented || picker.errorMessage != nil }
        #expect(picker.errorMessage == nil)
        #expect(picker.candidateIDs == [10, 9])
        #expect(store.selectedActivityIDs == [9, 10])
        picker.showDetail(10, store: store)
        try await render()
        #expect(store.routeGeometry.buildCount == 1)

        // A filter is applied both to the rendered layer and eligible hit set.
        store.activeSportTypes.remove(.ride)
        picker.reconcile(with: store)
        try await render()
        picker.isPresented = false
        picker.pick(at: point, map: map.renderer, store: store)
        try await waitUntil { picker.isPresented || picker.errorMessage != nil }
        #expect(picker.candidateIDs == [10] && picker.detailID == 10)
        #expect(store.selectedActivityIDs == [10])

        // A late query from the previous mode cannot replace the group.
        picker.pick(at: point, map: map.renderer, store: store)
        store.setCombine(true)
        try await Task.sleep(for: .milliseconds(150))
        #expect(store.selectedActivityIDs == [10] && store.isCombining)
        store.resetFilters()
        try await render()
        store.setOnlySelected(true)
        try await render()
        #expect(store.ordinaryVisibleActivityIDs == [9, 10] && store.visibleActivityIDs == [10])
        // A Combine miss preserves the group, active route and result detail.
        picker.pick(at: CGPoint(x: 5, y: 5), map: map.renderer, store: store)
        try await Task.sleep(for: .milliseconds(150))
        #expect(store.selectedActivityIDs == [10] && picker.detailID == 10)
        store.setCombine(false)
        // Rendered-map miss clears selection instead of selecting raster/POIs.
        picker.pick(at: CGPoint(x: 5, y: 5), map: map.renderer, store: store)
        try await waitUntil { !picker.isPresented || picker.errorMessage != nil }
        #expect(picker.errorMessage == nil && store.selectedActivityIDs.isEmpty)
        #expect(store.routeGeometry.buildCount == 1)
    }

    private func waitUntil(_ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(15)
        while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(50)) }
        try #require(condition(), "Map render/query timed out")
    }
}

import CoreLocation
import Foundation
import MapboxMaps
import Testing
import UIKit
@testable import ActivityMap

/// Exercise the real renderer/query adapter with a bundled, network-free style.
/// This is intentionally separate from native touch/VoiceOver device acceptance.
@MainActor @Suite(.serialized)
struct RenderedRoutePickingTests {
    @Test func renderedOverlapsFiltersAndSelectionReuseOneSource() async throws {
        let oldToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = oldToken }
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let oldWindow = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.isHidden = true; oldWindow?.makeKeyAndVisible() }

        let center = CLLocationCoordinate2D(latitude: 46.005, longitude: 8.005)
        let map = MapView(frame: CGRect(x: 0, y: 0, width: 390, height: 700), mapInitOptions: MapInitOptions(
            cameraOptions: CameraOptions(center: center, zoom: 13), styleURI: nil,
            styleJSON: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##
        ))
        controller.view.addSubview(map)
        var styleLoaded = map.mapboxMap.isStyleLoaded
        let styleEvent = map.mapboxMap.onStyleLoaded.observe { _ in styleLoaded = true }
        defer { styleEvent.cancel() }
        try await waitUntil { styleLoaded }

        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(10),
                                               ActivityStoreSelectionTests.activity(9, sport: .ride)])
        let picker = RoutePicker()
        store.routeGeometry.update(activities: store.activities, revision: store.activitiesRevision)
        // A style without the route layer must not be mistaken for an empty tap.
        store.replaceSelection(with: [9])
        picker.pick(at: .zero, map: map.mapboxMap, store: store)
        #expect(picker.errorMessage != nil && store.selectedActivityIDs == [9])
        picker.errorMessage = nil
        func render() async throws {
            var idle = false
            let event = map.mapboxMap.onMapIdle.observe { _ in idle = true }
            defer { event.cancel() }
            map.mapboxMap.setMapStyleContent {
                RouteLayers(data: store.routeGeometry.data, visibleIDs: store.selection.visibleIDs,
                            selectedIDs: store.selectedActivityIDs, activeID: store.activeActivityID)
            }
            try await waitUntil { idle }
        }
        try await render()
        let point = map.mapboxMap.point(for: center)
        // A near miss on a 3pt stroke still picks both identical routes.
        picker.pick(at: CGPoint(x: point.x + 10, y: point.y), map: map.mapboxMap, store: store)
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
        picker.pick(at: point, map: map.mapboxMap, store: store)
        try await waitUntil { picker.isPresented || picker.errorMessage != nil }
        #expect(picker.candidateIDs == [10] && picker.detailID == 10)
        #expect(store.selectedActivityIDs == [10])

        // Rendered-map miss clears selection instead of selecting raster/POIs.
        picker.pick(at: CGPoint(x: 5, y: 5), map: map.mapboxMap, store: store)
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

import CoreLocation
import Foundation
import MapboxMaps
import Testing
@testable import ActivityMap

@MainActor
struct MapContextTests {
    @Test func shortAndDatelineExtents() throws {
        let dateline = try #require(RouteExtent(coordinates: [
            CLLocationCoordinate2D(latitude: -17, longitude: 179.8),
            CLLocationCoordinate2D(latitude: -16.8, longitude: -179.7),
        ]))
        #expect(abs(dateline.east - dateline.west - 0.5) < 1e-8)
        #expect(abs(dateline.center.longitude - 180.05) < 1e-8)
        let point = try #require(RouteExtent(coordinates: [CLLocationCoordinate2D(latitude: 0, longitude: 0)]))
        #expect(point.corners.count == 4 && point.corners[0].latitude.isFinite)
        #expect(RouteExtent(coordinates: []) == nil)
        #expect(RouteExtent(coordinates: [CLLocationCoordinate2D(latitude: .nan, longitude: 0)]) == nil)
        let polar = try #require(RouteExtent(coordinates: [CLLocationCoordinate2D(latitude: 90, longitude: 0)]))
        #expect(polar.south == 85 && polar.north == 85)
    }

    @Test func repeatedRequestsHaveDistinctIdentityAndOldCompletionCannotConsumeNewRequest() throws {
        let context = MapContext()
        context.request(.activity(1))
        let first = try #require(context.pendingRequest)
        context.request(.activity(1))
        let second = try #require(context.pendingRequest)
        #expect(first.id != second.id)
        context.consume(first)
        #expect(context.pendingRequest == second)
        context.consume(second)
        #expect(context.pendingRequest == nil)
    }

    @Test func showOnMapQueuesFramingWithoutChangingIndependentInspection() throws {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2)])
        store.inspect(2)
        store.selectedTab = .list
        store.addToSelection([2])
        #expect(store.showOnMap(1) == .shown)
        #expect(store.selectedTab == .map && store.activeActivityID == 1 && store.selectedActivityIDs == [1, 2])
        #expect(store.inspectedActivityID == 2 && store.mapContext.pendingRequest?.action == .activity(1))
        let request = try #require(store.mapContext.pendingRequest)
        store.selectedTab = .list
        store.selectedTab = .map
        #expect(store.mapContext.pendingRequest == request)
    }

    @Test func noGPSDoesNotNavigateAndHiddenTargetRequiresExplicitFilterReset() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, sport: .ride),
                                               ActivityStoreSelectionTests.activity(2, route: false)])
        store.selectedTab = .list
        #expect(store.showOnMap(2) == .noGeometry)
        #expect(store.mapContext.pendingRequest == nil && store.selectedTab == .list)
        store.activeSportTypes = [.run]
        #expect(store.showOnMap(1) == .hiddenByFilters)
        #expect(store.activeSportTypes == [.run] && store.selectedActivityIDs.isEmpty)
        #expect(store.mapContext.hiddenTargetID == 1 && store.mapContext.pendingRequest == nil)
        store.clearFiltersAndShowOnMap(1)
        #expect(store.activeSportTypes == Set(SportType.allCases) && store.activeActivityID == 1)
        #expect(store.mapContext.hiddenTargetID == nil && store.mapContext.pendingRequest?.action == .activity(1))
    }

    @Test func scopeResetCancelsNavigationButKeepsDisplayPreferences() throws {
        let store = ActivityStore()
        let style = try #require(BaseStyle.all.last)
        let overlays = Set(SharedMapCatalog.rasterOverlays.prefix(2))
        store.mapContext.baseStyle = style
        store.mapContext.activeOverlays = overlays
        store.mapContext.request(.activity(10))
        store.mapContext.hiddenTargetID = 10
        store.clearScope()
        #expect(store.mapContext.pendingRequest == nil && store.mapContext.hiddenTargetID == nil)
        #expect(store.mapContext.scopeRevision == 1)
        #expect(store.mapContext.baseStyle == style && store.mapContext.activeOverlays == overlays)
        #expect(store.mapContext.camera.zoom == MapCamera.initial.zoom)
    }
}

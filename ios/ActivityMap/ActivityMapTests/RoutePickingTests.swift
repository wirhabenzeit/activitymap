import CoreGraphics
import CoreLocation
import Foundation
import MapboxMaps
import Testing
@testable import ActivityMap

struct RouteHitTestingTests {
    private func route(_ id: Int, y: Double, x: Double = -10) -> Feature {
        var feature = Feature(geometry: .lineString(LineString([
            CLLocationCoordinate2D(latitude: y, longitude: x),
            CLLocationCoordinate2D(latitude: y, longitude: x + 20),
        ])))
        feature.properties = ["id": .string(String(id))]
        return feature
    }

    private func hits(_ features: [Feature], eligible: Set<Int>) -> [Int] {
        RouteHitTesting.orderedIDs(features: features, at: .zero, eligibleIDs: eligible) {
            $0.map { CGPoint(x: $0.longitude, y: $0.latitude) }
        }
    }

    @Test func overlappingRoutesDeduplicateAndSortByDistanceThenNumericID() {
        #expect(hits([route(9, y: 5), route(10, y: -5), route(1, y: 0),
                      route(10, y: 6), route(99, y: 10)], eligible: [1, 9, 10, 99]) == [1, 10, 9, 99])
    }

    @Test func touchToleranceIncludesBoundaryButNotSquareCornersOrHiddenRoutes() {
        #expect(hits([route(1, y: 22), route(2, y: 22.1), route(3, y: 20, x: 20),
                      route(4, y: 0)], eligible: [1, 2, 3]) == [1])
    }

    @Test func fragmentsKeepTheClosestSegmentAndMultilinesDoNotBridgeGaps() {
        var multi = route(1, y: 0)
        multi.geometry = .multiLineString(MultiLineString([
            [CLLocationCoordinate2D(latitude: 0, longitude: -50), CLLocationCoordinate2D(latitude: 0, longitude: -40)],
            [CLLocationCoordinate2D(latitude: 0, longitude: 40), CLLocationCoordinate2D(latitude: 0, longitude: 50)],
        ]))
        #expect(hits([multi, route(2, y: 10), route(2, y: 1), route(3, y: 5)], eligible: [1, 2, 3]) == [2, 3])
    }

    @Test func degenerateAndNonFiniteSegmentsAreSafe() {
        #expect(RouteHitTesting.distance(to: [.zero, .zero], from: CGPoint(x: 3, y: 4)) == 5)
        #expect(RouteHitTesting.distance(to: [], from: .zero).isInfinite)
        #expect(RouteHitTesting.distance(to: [CGPoint(x: CGFloat.nan, y: 0), .zero], from: .zero).isInfinite)
    }

    @Test func unknownNonRouteAndMalformedIDsAreRejected() {
        var malformed = route(1, y: 0)
        malformed.properties = ["id": .string("01")]
        var point = route(2, y: 0)
        point.geometry = .point(Point(CLLocationCoordinate2D(latitude: 0, longitude: 0)))
        #expect(hits([malformed, point, route(99, y: 0)], eligible: [1, 2]).isEmpty)
    }

    @Test func largeIDRemainsExact() {
        let id = 9_007_199_254_740_993
        #expect(hits([route(id, y: 0)], eligible: [id]) == [id])
    }
}

@MainActor
struct RoutePickerTests {
    private func store() -> ActivityStore {
        ActivityStore(activities: [ActivityStoreSelectionTests.activity(1),
                                   ActivityStoreSelectionTests.activity(2),
                                   ActivityStoreSelectionTests.activity(3, sport: .ride),
                                   ActivityStoreSelectionTests.activity(4, route: false)])
    }

    @Test func singleHitReplacesAndOpensMapDetailWithoutChangingInspection() {
        let store = store(), picker = RoutePicker()
        store.inspect(3)
        store.addToSelection([2])
        picker.apply(ids: [1], adding: false, request: picker.invalidateQuery(), store: store)
        #expect(store.selectedActivityIDs == [1] && store.activeActivityID == 1)
        #expect(picker.detailID == 1 && picker.isPresented)
        #expect(store.inspectedActivityID == 3)
    }

    @Test func overlapSelectsEveryEligibleHitAndOpensChooser() {
        let store = store(), picker = RoutePicker()
        store.activeSportTypes.remove(.ride)
        picker.apply(ids: [2, 1, 2, 3, 4, 99], adding: false, request: picker.invalidateQuery(), store: store)
        #expect(picker.candidateIDs == [2, 1])
        #expect(store.selectedActivityIDs == [1, 2] && store.activeActivityID == nil)
        #expect(picker.detailID == nil && picker.isPresented)
        picker.showDetail(2, store: store)
        #expect(store.activeActivityID == 2 && picker.detailID == 2)
        store.removeFromSelection([2])
        picker.reconcile(with: store)
        #expect(store.activeActivityID == 1 && picker.detailID == nil)
    }

    @Test func addingPreservesActiveAndHiddenSelectionsAndNeverAutoActivates() {
        let store = store(), picker = RoutePicker()
        store.replaceSelection(with: [1, 3])
        store.activate(1)
        store.activeSportTypes.remove(.ride)
        picker.apply(ids: [2], adding: true, request: picker.invalidateQuery(), store: store)
        #expect(store.selectedActivityIDs == [1, 2, 3] && store.activeActivityID == 1)
        #expect(picker.detailID == nil)
        store.clearSelection()
        picker.apply(ids: [2], adding: true, request: picker.invalidateQuery(), store: store)
        #expect(store.activeActivityID == nil && picker.detailID == nil)
    }

    @Test(arguments: [true, false]) func emptyTapClearsEvenHiddenSelection(adding: Bool) {
        let store = store(), picker = RoutePicker()
        store.replaceSelection(with: [1, 3])
        store.inspect(2)
        picker.apply(ids: [], adding: adding, request: picker.invalidateQuery(), store: store)
        #expect(store.selectedActivityIDs.isEmpty && store.activeActivityID == nil)
        #expect(store.inspectedActivityID == 2 && !picker.isPresented)
    }

    @Test func staleTapCannotOverwriteNewTapOrGesture() {
        let store = store(), picker = RoutePicker()
        let old = picker.invalidateQuery()
        let current = picker.invalidateQuery()
        picker.apply(ids: [2], adding: false, request: current, store: store)
        picker.apply(ids: [], adding: false, request: old, store: store)
        #expect(store.selectedActivityIDs == [2])
        picker.invalidateQuery() // pan, style change or leaving the map
        picker.apply(ids: [1], adding: false, request: current, store: store)
        #expect(store.selectedActivityIDs == [2])
    }

    @Test func filteringAndScopeChangesDismissIneligibleChoices() {
        let store = store(), picker = RoutePicker()
        picker.apply(ids: [3], adding: false, request: picker.invalidateQuery(), store: store)
        store.activeSportTypes.remove(.ride)
        picker.reconcile(with: store)
        #expect(!picker.isPresented && picker.detailID == nil && picker.candidateIDs.isEmpty)
        #expect(store.selectedActivityIDs == [3])
        store.resetFilters()
        picker.apply(ids: [1], adding: false, request: picker.invalidateQuery(), store: store)
        store.clearScope()
        picker.reconcile(with: store)
        #expect(!picker.isPresented && picker.detailID == nil)
    }

    @Test func selectionAndFiltersNeverRebuildLibraryGeometry() {
        let store = ActivityStore(activities: (1...2_000).map { ActivityStoreSelectionTests.activity($0) })
        let cache = store.routeGeometry
        cache.update(activities: store.activities, revision: store.activitiesRevision)
        let initial = cache.data
        for id in 1...20 {
            store.toggleSelection(id)
            store.activeSportTypes = id.isMultiple(of: 2) ? [.run] : []
            cache.update(activities: store.activities, revision: store.activitiesRevision)
        }
        #expect(cache.buildCount == 1 && cache.data == initial)
        store.activities.removeLast()
        cache.update(activities: store.activities, revision: store.activitiesRevision)
        #expect(cache.buildCount == 2)
        store.clearScope()
        #expect(cache.data == .featureCollection(FeatureCollection(features: [])))
    }

    @Test func sourceUsesExactStringIDs() throws {
        let id = 9_007_199_254_740_993
        guard case let .featureCollection(collection) = RouteSource.data(for: [ActivityStoreSelectionTests.activity(id)]) else {
            Issue.record("Expected feature collection"); return
        }
        let feature = try #require(collection.features.first)
        #expect(feature.identifier == .string(String(id)))
        #expect(feature.properties?["id"] == .string(String(id)))
    }
}

import CoreLocation
import Foundation
import Testing
@testable import ActivityMap

@MainActor struct BrowsingReconciliationTests {
    @Test func completedCacheEmptyResultsDoNotDependOnNetworkStatus() {
        let statuses: [SyncController.Status] = [.ready, .offline, .syncing, .paused, .failed("fixture"),
                                                .rateLimited(Date()), .retryAfter(Date())]
        for status in statuses {
            for count in [0, 2] {
                let stats = StatsPresentation(activityCount: count, matchingCount: 0, status: status,
                                              hasCompletedCache: true, canRetry: true)
                let list = BrowsingPresentation(tab: .list, activityCount: count, filteredCount: 0, routeCount: 0,
                                                status: status, hasCompletedCache: true, canRetry: false)
                #expect(stats.empty == list.empty)
                #expect(stats.empty?.kind == (count == 0 ? .emptyLibrary : .noMatches))
                #expect(stats.empty?.recovery == (count == 0 ? nil : .clearFilters))
                #expect(!stats.hasContent && stats.historyComplete)
            }
        }
    }

    @Test func unfinishedOrUnavailableHistoryDoesNotCertifyEmptyResults() {
        for status: SyncController.Status in [.offline, .syncing, .failed("fixture"), .paused] {
            let state = StatsPresentation(activityCount: 0, matchingCount: 0, status: status,
                                          hasCompletedCache: false, canRetry: true)
            #expect(state.empty == nil && !state.historyComplete)
        }
        for status: SyncController.Status in [.signedOut, .expired, .disconnected] {
            let state = StatsPresentation(activityCount: 2, matchingCount: 0, status: status,
                                          hasCompletedCache: true, canRetry: false)
            #expect(state.empty == nil && !state.hasContent && state.state == .unavailable)
        }
        let cached = StatsPresentation(activityCount: 2, matchingCount: 1, status: .offline,
                                       hasCompletedCache: true, canRetry: false)
        #expect(cached.empty == nil && cached.hasContent && cached.state == .cached)
    }

    @Test func showOnMapUsesDrawableRouteCapabilityAndLeavesInvalidTargetsUntouched() {
        let valid = ActivityStoreSelectionTests.activity(1)
        var point = ActivityStoreSelectionTests.activity(2)
        point.coordinates = [CLLocationCoordinate2D(latitude: 47, longitude: 8)]
        var invalid = ActivityStoreSelectionTests.activity(3)
        invalid.coordinates = [.init(latitude: .nan, longitude: 8), .init(latitude: 91, longitude: 8)]
        let store = ActivityStore(activities: [valid, point, invalid], listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .list
        store.replaceSelection(with: [1]); store.inspect(1)
        for id in [2, 3] {
            #expect(!store.canShowOnMap(id))
            #expect(store.showOnMap(id) == .noGeometry)
            #expect(store.selectedTab == .list && store.activeActivityID == 1 && store.inspectedActivityID == 1)
            #expect(store.selectedActivityIDs == [1] && store.mapContext.pendingRequest == nil)
            store.searchText = "missing"
            store.clearFiltersAndShowOnMap(id)
            #expect(store.searchText == "missing", "An undrawable target cannot clear filters")
            store.resetFilters()
            store.replaceSelection(with: [1]); store.inspect(1)
        }
        #expect(store.canShowOnMap(1))
        #expect(store.showOnMap(99) == .notFound)
        #expect(store.showOnMap(1) == .shown && store.mapContext.pendingRequest != nil)
    }

    @Test func inspectionStateRetainsPushAndWaitsOnlyForListFilterCollapse() {
        var state = ActivityInspectionState()
        state.reconcile(hasSelection: true, adjacent: false, active: true, waitsForWidth: true)
        #expect(state.awaitingWidth && !state.presentsPage(adjacent: false, active: true))
        state.reconcile(hasSelection: true, adjacent: true, active: true, waitsForWidth: false)
        #expect(!state.awaitingWidth && !state.pushed)
        state.reconcile(hasSelection: true, adjacent: false, active: false, waitsForWidth: false)
        #expect(!state.pushed, "A hidden pane narrowing cannot push")
        state.reconcile(hasSelection: true, adjacent: false, active: true, waitsForWidth: false)
        #expect(state.pushed)
        state.reconcile(hasSelection: true, adjacent: true, active: true, waitsForWidth: false)
        #expect(state.presentsPage(adjacent: true, active: true), "Rotation preserves an existing native page")
        state.reconcile(hasSelection: false, adjacent: true, active: true, waitsForWidth: false)
        #expect(state == ActivityInspectionState())
        #expect(!BrowsePaneLayout.supportsDetail(width: 1000, regular: true, accessibilityText: true))
    }
}

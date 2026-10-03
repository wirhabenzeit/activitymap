import Foundation
import Testing
@testable import ActivityMap

@MainActor struct ShellFoundationTests {
    @Test func statsDestinationRequiresRealContent() {
        #expect(AppTab.available(stats: false) == [.map, .list])
        #expect(AppTab.available(stats: true) == [.map, .list, .stats])
    }

    @Test func filterScopeCountsAndResetPreserveSavedBrowsingDates() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        let range = ActivityDayRange(start: "2020-01-01", end: "2020-12-31")
        store.dateDayRange = range
        store.searchText = "Activity"
        store.distanceFilter = NumericFilter(value: 100)
        #expect(store.activeFilterCount == 3 && store.activeStatsFilterCount == 2)
        let camera = store.mapContext.camera
        let list = store.listPresentation.settings
        FilterScope.stats.reset(store)
        #expect(store.dateDayRange == range)
        #expect(store.activeFilterCount == 1 && store.activeStatsFilterCount == 0)
        #expect(store.mapContext.camera.zoom == camera.zoom && store.mapContext.camera.padding == camera.padding)
        #expect(store.listPresentation.settings == list)
        FilterScope.browsing.reset(store)
        #expect(store.dateDayRange == nil && store.activeFilterCount == 0)
    }
}

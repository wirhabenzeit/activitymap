import Foundation
import Observation
import Synchronization
import Testing
@testable import ActivityMap

@MainActor
struct ActivityFilterBatchingTests {
    @Test(arguments: [false, true])
    func largeLibraryResetBuildsAndReconcilesOnce(statsOnly: Bool) throws {
        let rows = (1...20_000).map { id in
            var activity = ActivityStoreSelectionTests.activity(id, sport: id.isMultiple(of: 2) ? .ride : .run, route: false)
            if id > 10_000 { activity.startDateLocal = Date(timeIntervalSince1970: 1_704_153_600) }
            activity.isPrivate = false
            activity.flagged = false
            return activity
        }
        let presentation = ActivityListPresentation(defaults: nil)
        let store = ActivityStore(activities: rows, listPresentation: presentation)
        let savedDates = try #require(ActivityDayRange(start: "2023-01-01", end: "2023-12-31"))
        store.updateFilters {
            $0.searchText = "Activity"
            $0.activeSportTypes = [.run]
            $0.dateDayRange = savedDates
            $0.distanceFilter = NumericFilter(value: 0)
            $0.elevationFilter = NumericFilter(value: 0)
            $0.durationFilter = NumericFilter(value: 0)
            $0.commuteOnly = false
            $0.privateFilter = false
            $0.flaggedFilter = false
        }
        store.replaceSelection(with: [1, 2])
        store.setCombine(true)
        store.setOnlySelected(true)
        store.inspect(1)
        #expect(store.activeFilterCount == 10 && store.browsingActivities.map(\.id) == [1])
        _ = store.listedActivities
        let builds = store.filterBuildCount, reconciliations = store.selectionReconciliationCount
        let sorts = store.sortBuildCount, identities = store.activityLookupBuildCount
        let revision = store.activitiesRevision, reset = store.filterResetRevision
        let selection = store.selectedActivityIDs, list = presentation.settings
        let camera = store.mapContext.camera

        if statsOnly { store.resetStatsActivityFilters() }
        else { store.resetFilters() }

        let expected = Set(1...(statsOnly ? 10_000 : 20_000))
        #expect(Set(store.filteredActivities.map(\.id)) == expected)
        #expect(store.ordinaryVisibleActivityIDs == expected)
        #expect(Set(store.browsingActivities.map(\.id)) == (statsOnly ? [1, 2] : expected))
        #expect(store.dateDayRange == (statsOnly ? savedDates : nil))
        #expect(store.onlySelected == statsOnly && store.isCombining)
        #expect(store.selectedActivityIDs == selection && store.activeActivityID == 1 && store.inspectedActivityID == 1)
        #expect(store.activeFilterCount == (statsOnly ? 2 : 0) && store.activeStatsFilterCount == 0)
        #expect(store.statsActivities.count == 20_000, "Stats ignores saved dates and selected-only scope")
        #expect(store.filterBuildCount == builds + 1)
        #expect(store.selectionReconciliationCount == reconciliations + 1)
        #expect(store.activityLookupBuildCount == identities && store.activitiesRevision == revision)
        #expect(store.filterResetRevision == reset + 1 && presentation.settings == list)
        #expect(store.mapContext.camera.zoom == camera.zoom && store.mapContext.camera.center.latitude == camera.center.latitude)
        _ = store.listedActivities
        #expect(store.sortBuildCount == sorts + 1)
        for _ in 0..<30 { _ = store.filteredActivities; _ = store.listedActivities }
        #expect(store.filterBuildCount == builds + 1 && store.sortBuildCount == sorts + 1)
    }

    @Test func batchNeverReconcilesAnIntermediateFilterThatWouldCloseInspection() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2, sport: .ride)])
        store.replaceSelection(with: [1, 2])
        store.activate(1)
        store.inspect(1)
        let builds = store.filterBuildCount, reconciliations = store.selectionReconciliationCount
        store.updateFilters {
            $0.activeSportTypes = [] // This intermediate value must never reach the reducer.
            #expect(store.visibleActivityIDs == [1, 2] && store.inspectedActivityID == 1)
            $0.searchText = "Activity"
            $0.activeSportTypes = [.run]
        }
        #expect(store.visibleActivityIDs == [1] && store.hiddenSelectedCount == 1)
        #expect(store.selectedActivityIDs == [1, 2] && store.activeActivityID == 1 && store.inspectedActivityID == 1)
        #expect(store.filterBuildCount == builds + 1 && store.selectionReconciliationCount == reconciliations + 1)
        store.updateFilters { $0.searchText = "Missing"; $0.activeSportTypes = [.ride] }
        #expect(store.visibleActivityIDs.isEmpty && store.activeActivityID == nil && store.inspectedActivityID == nil)
        store.resetFilters()
        #expect(store.selectedActivityIDs == [1, 2] && store.activeActivityID == nil && store.inspectedActivityID == nil,
                "A later reset must not reopen filter-hidden focus or inspection")
    }

    @Test func unchangedAssignmentsAndCancelledEditsKeepObservationAndCachesQuiet() throws {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)], listPresentation: ActivityListPresentation(defaults: nil))
        store.updateFilters {
            $0.searchText = "Activity"
            $0.activeSportTypes = [.run]
            $0.dateDayRange = ActivityDayRange(start: "2023-01-01", end: "2023-12-31")
            $0.distanceFilter = NumericFilter(value: 0)
            $0.elevationFilter = NumericFilter(value: 0)
            $0.durationFilter = NumericFilter(value: 0)
            $0.commuteOnly = false
            $0.privateFilter = false
            $0.flaggedFilter = false
        }
        _ = store.listedActivities
        let builds = store.filterBuildCount, sorts = store.sortBuildCount, reconciliations = store.selectionReconciliationCount
        let changes = Mutex(0)
        withObservationTracking {
            _ = store.filteredActivities; _ = store.searchText; _ = store.activeSportTypes
            _ = store.dateDayRange; _ = store.distanceFilter; _ = store.elevationFilter; _ = store.durationFilter
            _ = store.commuteOnly; _ = store.privateFilter; _ = store.flaggedFilter
            _ = store.ordinaryVisibleActivityIDs; _ = store.inspectedActivityID
        } onChange: { changes.withLock { $0 += 1 } }
        store.searchText = "Activity"
        store.activeSportTypes.insert(.run)
        store.activeSportTypes.remove(.ride)
        store.dateDayRange = ActivityDayRange(start: "2023-01-01", end: "2023-12-31")
        store.distanceFilter?.value = 0
        store.elevationFilter = NumericFilter(value: 0)
        store.durationFilter = NumericFilter(value: 0)
        store.commuteOnly = false
        store.privateFilter = false
        store.flaggedFilter = false
        store.updateFilters { $0.searchText = "Temporary"; $0.searchText = "Activity" }
        enum Cancelled: Error { case edit }
        #expect(throws: Cancelled.self) {
            try store.updateFilters { $0.searchText = "Uncommitted"; throw Cancelled.edit }
        }
        _ = store.filteredActivities; _ = store.listedActivities
        #expect(changes.withLock { $0 } == 0)
        #expect(store.filterBuildCount == builds && store.sortBuildCount == sorts && store.selectionReconciliationCount == reconciliations)
        store.searchText = "Changed"
        #expect(changes.withLock { $0 } == 1, "A real binding edit must still publish")
    }

    @Test func noOpResetStillDiscardsDraftsWithoutRecomputingFilters() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)], listPresentation: ActivityListPresentation(defaults: nil))
        store.replaceSelection(with: [1]); store.inspect(1); store.setCombine(true)
        _ = store.listedActivities
        let builds = store.filterBuildCount, sorts = store.sortBuildCount
        let reconciliations = store.selectionReconciliationCount, reset = store.filterResetRevision
        let changes = Mutex(0)
        withObservationTracking {
            _ = store.filteredActivities; _ = store.listedActivities; _ = store.selection
        } onChange: { changes.withLock { $0 += 1 } }
        store.resetFilters()
        store.resetStatsActivityFilters()
        #expect(store.filterResetRevision == reset + 2, "Reset intent still closes/discards unapplied filter drafts")
        #expect(changes.withLock { $0 } == 0)
        #expect(store.filterBuildCount == builds && store.sortBuildCount == sorts && store.selectionReconciliationCount == reconciliations)
        #expect(store.inspectedActivityID == 1 && store.activeActivityID == 1 && store.isCombining)
        store.setOnlySelected(true)
        let restrictedBuilds = store.filterBuildCount
        store.resetFilters()
        #expect(!store.onlySelected && store.isCombining && store.inspectedActivityID == 1)
        #expect(store.filterBuildCount == restrictedBuilds && store.selectionReconciliationCount == reconciliations,
                "Clearing selected-only scope does not change ordinary filter membership")
    }

    @Test func membershipAndIdentityLookupShareOneIndexPerDataRevision() {
        let store = ActivityStore(activities: (1...20_000).map { ActivityStoreSelectionTests.activity($0, route: false) })
        for id in 1...50 {
            store.addToSelection([id, 99_999])
            store.toggleSelection(id)
            store.setCombine(true)
            store.toggleMember(id)
            #expect(store.activity(id: id)?.id == id)
            #expect(store.activity(id: 99_999) == nil)
        }
        #expect(store.activityLookupBuildCount == 1)
        let count = store.activityLookupBuildCount
        store.activities[0].name = "Fresh identity payload"
        #expect(store.activity(id: 1)?.name == "Fresh identity payload")
        #expect(store.activityLookupBuildCount == count + 1)
        store.replaceSelection(with: [1, 2])
        store.activities.removeFirst()
        #expect(store.selectedActivityIDs == [2] && store.activity(id: 1) == nil)
        store.addToSelection([1, 20_000, 99_999])
        #expect(store.selectedActivityIDs == [2, 20_000])
        #expect(store.activityLookupBuildCount == count + 2)
        store.clearScope()
        #expect(store.activity(id: 2) == nil && store.selectedActivityIDs.isEmpty)
        #expect(store.activityLookupBuildCount == count + 3)
    }
}

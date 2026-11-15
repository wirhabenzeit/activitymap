import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct BrowsingPreferencesTests {
    private func isolated() -> UserDefaults { UserDefaults(suiteName: "browsing-tests-\(UUID())")! }

    @Test func relaunchRestoresFiltersAndCameraWithoutSelectionOrInspection() throws {
        let defaults = isolated()
        let activity = try StoredModelMapper.activity(Fixtures.activity(["id": "1", "name": "Trail hike", "private": false]))
        let first = ActivityStore(activities: [activity], browsingDefaults: defaults)
        first.restoreBrowsingScope(Fixtures.scope)
        first.searchText = "Trail"
        first.activeSportTypes = [.hike, .trailRun]
        first.dateDayRange = ActivityDayRange(start: "2026-01-01", end: "2026-10-31")
        first.distanceFilter = NumericFilter(value: 1000, upperLimit: 20000)
        first.privateFilter = false
        first.setCombine(true)
        first.replaceSelection(with: [1])
        first.setOnlySelected(true)
        first.inspect(1)
        #expect(first.selectedActivityIDs == [1] && first.inspectedActivityID == 1 && first.onlySelected)
        first.mapContext.restoreCamera(MapCamera(center: .init(latitude: 47, longitude: 8), zoom: 11, bearing: 30, pitch: 50))
        first.mapContext.saveCamera?()
        let second = ActivityStore(browsingDefaults: defaults)
        second.restoreBrowsingScope(Fixtures.scope)
        #expect(second.searchText == "Trail" && second.activeSportTypes == [.hike, .trailRun])
        #expect(second.dateDayRange == first.dateDayRange && second.distanceFilter == first.distanceFilter)
        #expect(second.privateFilter == false)
        #expect(second.mapContext.camera.center.latitude == 47 && second.mapContext.camera.zoom == 11)
        #expect(second.mapContext.camera.padding == .zero && second.mapContext.isPitched)
        #expect(second.selectedActivityIDs.isEmpty && second.inspectedActivityID == nil && !second.isCombining && !second.onlySelected)
    }

    @Test func accountAndDeploymentScopesAreSeparateAndClearFiltersPersists() {
        let defaults = isolated()
        let store = ActivityStore(browsingDefaults: defaults)
        let alice = Fixtures.scope
        let bob = StoreScope(deployment: alice.deployment, userID: "bob")
        let other = StoreScope(deployment: URL(string: "https://other.test")!, userID: alice.userID)
        store.restoreBrowsingScope(alice)
        store.searchText = "Alice"
        store.clearScope()
        store.restoreBrowsingScope(bob)
        #expect(store.searchText.isEmpty && store.mapContext.camera.zoom == MapCamera.initial.zoom)
        store.searchText = "Bob"
        store.clearScope()
        store.restoreBrowsingScope(other)
        #expect(store.searchText.isEmpty)
        store.clearScope()
        store.restoreBrowsingScope(alice)
        #expect(store.searchText == "Alice")
        store.resetFilters()
        store.clearScope()
        store.restoreBrowsingScope(alice)
        #expect(store.searchText.isEmpty)
    }

    @Test func deviceAppearanceSurvivesAccountClearingButActionsDoNot() {
        let defaults = isolated()
        let store = ActivityStore(browsingDefaults: defaults)
        store.restoreBrowsingScope(Fixtures.scope)
        store.mapContext.baseStyle = BaseStyle.all.last!
        store.mapContext.activeOverlays = []
        store.mapContext.showPlaces = true
        store.mapContext.showPhotos = true
        store.mapContext.highlightedPlaceID = "place"
        store.mapContext.request(.fitFiltered)
        store.clearScope()
        let restored = ActivityStore(browsingDefaults: defaults)
        #expect(restored.mapContext.baseStyle == store.mapContext.baseStyle)
        #expect(restored.mapContext.activeOverlays.isEmpty && restored.mapContext.showPlaces && restored.mapContext.showPhotos)
        #expect(store.mapContext.pendingRequest == nil && store.mapContext.highlightedPlaceID == nil)
    }

    @Test func placeScopeInvalidRangesAndCorruptPreferencesRecover() {
        let defaults = isolated()
        let prefs = BrowsingPreferences(defaults: defaults)
        prefs.activate(Fixtures.scope)
        var filters = ActivityFilterState()
        filters.place = PlaceFilter(id: "p", name: "Pass", userID: "someone-else")
        filters.distanceFilter = NumericFilter(value: 100, upperLimit: 10)
        prefs.save(filters: filters)
        #expect(prefs.filters().place == nil && prefs.filters().distanceFilter == nil)
        prefs.save(camera: MapCamera(center: .init(latitude: 120, longitude: 8), zoom: 30, bearing: 0, pitch: 0))
        #expect(prefs.camera() == nil)
        defaults.set(Data("broken".utf8), forKey: "browsing.v1." + StoreScope.key([Fixtures.scope.key, "filters"]))
        #expect(prefs.filters() == ActivityFilterState())
        prefs.remove(scope: Fixtures.scope)
        #expect(prefs.camera() == nil)
    }

    @Test func selectedPlaceRestoresBeforeFirstSyncedSnapshot() throws {
        let defaults = isolated()
        let store = ActivityStore(browsingDefaults: defaults)
        store.restoreBrowsingScope(Fixtures.scope)
        store.selectedPlace = PlaceFilter(id: "saved", name: "Saved place", userID: Fixtures.scope.userID)
        store.clearScope()
        store.restoreBrowsingScope(Fixtures.scope)
        try store.replaceSyncedActivities(StoreSnapshot(activities: [], photos: [], checkpoint: nil), scope: Fixtures.scope)
        #expect(store.selectedPlace?.id == "saved")
    }
}

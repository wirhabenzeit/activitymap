import Foundation
import Testing
@testable import ActivityMap

@MainActor struct PlaceLibraryTests {
    static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "shared/place-library-fixtures.v1.json")

    private func fixture() throws -> (root: [String: Any], snapshot: StoreSnapshot) {
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: Self.fixtureURL)) as? [String: Any])
        let rows = try #require(root["activities"] as? [[String: Any]])
        var checkpoint = Fixtures.checkpoint
        checkpoint.freshness = .init(lastSummaryReconciledAt: nil, placeMatchingVersion: root["matchingVersion"] as? String)
        return (root, StoreSnapshot(activities: try rows.map(Fixtures.activity), photos: [], checkpoint: checkpoint))
    }

    @Test func sharedIndexCountsFreshnessAndCompleteness() throws {
        let (root, snapshot) = try fixture()
        let store = ActivityStore()
        try store.replaceSyncedActivities(snapshot, scope: Fixtures.scope)
        let expected = try #require(root["expected"] as? [String: Any])
        let counts = try #require(expected["counts"] as? [String: Int])
        #expect(Dictionary(uniqueKeysWithValues: store.placeLibrary.places.map { ($0.id, $0.activityCount) }) == counts)
        #expect(store.placeLibrary.statusCounts == expected["statusCounts"] as? [String: Int])
        #expect(!store.placeLibrary.complete)
        let search = store.placeLibrary.search("PILATUS", limit: 1)
        #expect(search.total == 2 && search.places.count == 1)
        #expect(search.places[0].activityCount == 2)
        #expect(search.places[0].id != store.placeLibrary.search("pilatus", offset: 1, limit: 1).places[0].id)
        #expect(search.places[0].place.visits.count == 2, "Repeated profile encounters remain intact")
        #expect(Formatters.dayKey(search.places[0].firstVisit, timeZone: .gmt) == "2025-05-01")
        #expect(store.placeLibrary.byID["00000000-0000-4000-8000-000000000003"]?.place.elevationM == 0)
    }

    @Test func filterIntersectionStatsHistoryAndResets() throws {
        let (root, snapshot) = try fixture()
        let store = ActivityStore()
        try store.replaceSyncedActivities(snapshot, scope: Fixtures.scope)
        let expected = try #require(root["expected"] as? [String: Any])
        let id = try #require(expected["placeFilter"] as? String)
        let place = try #require(store.placeLibrary.byID[id])
        store.selectPlace(place)
        store.dateDayRange = ActivityDayRange(start: "2026-01-01", end: "2026-12-31")
        #expect(store.filteredActivities.map(\.id) == expected["browsingIds"] as? [Int])
        #expect(store.statsActivities.map(\.id) == expected["statsIds"] as? [Int])
        let key = StatsFilterScope(store)
        store.selectedPlace = nil
        #expect(StatsFilterScope(store) != key)
        store.selectPlace(place)
        store.searchText = "Morning"
        #expect(store.filteredActivities.isEmpty)
        #expect(store.statsActivities.map(\.id) == [1])
        store.resetStatsActivityFilters()
        #expect(store.selectedPlace == nil)
        #expect(store.dateDayRange != nil)
        store.selectPlace(place)
        store.clearScope()
        #expect(store.placeLibrary.places.isEmpty && store.selectedPlace == nil)
    }

    @Test func replacementAndVersionChangesRemoveOldMemberships() throws {
        let (_, snapshot) = try fixture()
        let store = ActivityStore()
        try store.replaceSyncedActivities(snapshot, scope: Fixtures.scope)
        #expect(!store.placeLibrary.places.isEmpty)
        var changed = try #require(snapshot.checkpoint)
        changed.freshness = .init(lastSummaryReconciledAt: nil, placeMatchingVersion: String(repeating: "b", count: 64))
        try store.replaceSyncedActivities(StoreSnapshot(activities: Array(snapshot.activities.prefix(4)), photos: [], checkpoint: changed), scope: Fixtures.scope)
        #expect(store.placeLibrary.places.isEmpty)
        #expect(store.placeLibrary.statusCounts["unknown"] == 4)
        try store.replaceSyncedActivities(StoreSnapshot(activities: [], photos: [], checkpoint: snapshot.checkpoint), scope: Fixtures.scope)
        #expect(store.placeLibrary.places.isEmpty && store.placeLibrary.complete)
        try store.replaceSyncedActivities(StoreSnapshot(activities: Array(snapshot.activities.prefix(4)), photos: [], checkpoint: snapshot.checkpoint), scope: StoreScope(deployment: Fixtures.scope.deployment, userID: "other"))
        #expect(store.placeLibrary.places.isEmpty)
    }
}

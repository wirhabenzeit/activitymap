import Foundation
import Testing
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct MapPlaceTests {
    @Test func consumesSharedPlacePolicyAndLayout() throws {
        let url = ActivityFilterTests.fixtureURL.deletingLastPathComponent().appending(path: "map-places.v1.json")
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let policy = try #require(root["policy"] as? [String: CGFloat])
        #expect(policy["labelZoom"] == MapPlaceLayout.labelZoom)
        #expect(policy["pinSpacing"] == MapPlaceLayout.pinSpacing)
        #expect(policy["viewportMargin"] == MapPlaceLayout.viewportMargin)
        #expect(policy["maxMarkers"] == CGFloat(MapPlaceLayout.maxMarkers))
        for item in try #require(root["symbols"] as? [[String: Any]]) {
            let kinds = try #require(item["kinds"] as? [[String]])
            let entries = kinds.enumerated().map { index, names in
                DisplayMatchedPlace(place: .init(id: String(index), name: "Place", kinds: names.compactMap(ActivityMapAPI.PlaceKind.init(rawValue:)),
                    longitude: 8, latitude: 47, elevationM: nil, visits: [.init(distanceM: nil)]), activityIDs: ["1"])
            }
            #expect((DisplayMatchedPlace.clusterKind(entries)?.rawValue ?? "mixed") == item["expected"] as? String)
        }
        for item in try #require(root["cases"] as? [[String: Any]]) {
            let points = try #require(item["points"] as? [[String: Any]]).map { point in
                MapPlaceLayout.Point(id: try #require(point["id"] as? String), x: try #require(point["x"] as? CGFloat), y: try #require(point["y"] as? CGFloat))
            }
            let size = CGSize(width: try #require(item["width"] as? CGFloat), height: try #require(item["height"] as? CGFloat))
            let expected = try #require(item["expected"] as? [[String]])
            #expect(MapPlaceLayout.groups(points, size: size, focusedID: item["focusedId"] as? String).map(\.pointIDs) == expected)
            #expect(MapPlaceLayout.groups(points.reversed(), size: size, focusedID: item["focusedId"] as? String).map(\.pointIDs) == expected)
        }
    }
    @Test func denseOverviewPreservesEveryPlaceAndFocusedSymbolWithinBudget() {
        let points = (0..<10000).map { MapPlaceLayout.Point(id: String(format: "%05d", $0), x: CGFloat($0 % 100) * 30, y: CGFloat($0 / 100) * 30) }
        let groups = MapPlaceLayout.groups(points, size: CGSize(width: 3000, height: 3000), focusedID: "00001")
        #expect(groups.count <= MapPlaceLayout.maxMarkers)
        #expect(groups.flatMap(\.pointIDs).count == points.count)
        #expect(Set(groups.flatMap(\.pointIDs)) == Set(points.map(\.id)))
        #expect(groups.first(where: { $0.id == "00001" })?.pointIDs == ["00001"])
        #expect(MapPlaceLayout.groups(points.reversed(), size: CGSize(width: 3000, height: 3000), focusedID: "00001") == groups)
    }
    @Test func placesRespectFiltersOnlySelectedAndAccountReset() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2, sport: .ride)])
        store.mapContext.showPlaces = true
        #expect(store.mapPlacesActivityIDs == [1, 2])
        store.replaceSelection(with: [1])
        store.setOnlySelected(true)
        #expect(store.mapPlacesActivityIDs == [1])
        store.setOnlySelected(false)
        store.activeSportTypes.remove(.ride)
        #expect(store.mapPlacesActivityIDs == [1])
        store.mapContext.clearScope()
        #expect(!store.mapContext.showPlaces)
    }
    @Test func placePickingPreservesVisitedActivityDetailAndUsesChooserElsewhere() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2)])
        let picker = RoutePicker()
        let place = ActivityMapAPI.MatchedPlace(id: "summit", name: "Summit", kinds: [.peak], longitude: 8, latitude: 47,
            elevationM: 1000, visits: [.init(distanceM: 100)])
        picker.apply(ids: [1], adding: false, request: picker.invalidateQuery(), store: store)
        picker.pickPlace(.init(place: place, activityIDs: ["1", "2"]), store: store)
        #expect(store.selectedActivityIDs == [1])
        #expect(picker.detailID == 1)
        picker.pickPlace(.init(place: place, activityIDs: ["2"]), store: store)
        #expect(store.selectedActivityIDs == [2])
        #expect(picker.detailID == 2)
        picker.showResults()
        picker.pickPlace(.init(place: place, activityIDs: ["1", "2"]), store: store)
        #expect(store.selectedActivityIDs == [1, 2])
        #expect(picker.detailID == nil)
        store.activityPlaces = ActivityPlacesLoader()
        store.activityPlaces?.focus = .init(activityID: "1", placeID: "summit")
        picker.apply(ids: [], adding: false, request: picker.invalidateQuery(), store: store)
        #expect(store.selectedActivityIDs.isEmpty)
        #expect(!picker.isPresented)
        #expect(store.activityPlaces?.focus == nil)
        store.replaceSelection(with: [1]); store.setCombine(true)
        store.activityPlaces?.focus = .init(activityID: "1", placeID: "summit")
        picker.apply(ids: [], adding: true, request: picker.invalidateQuery(), store: store)
        #expect(store.activityPlaces?.focus?.placeID == "summit")
        store.clearSelection()
        #expect(store.activityPlaces?.focus == nil)
    }
}

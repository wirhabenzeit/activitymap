import CoreLocation
import Foundation
import Testing
@testable import ActivityMap

@MainActor @Suite(.serialized)
struct MapPhotoTests {
    @Test func consumesSharedLayoutAndPolicy() throws {
        let url = ActivityFilterTests.fixtureURL.deletingLastPathComponent().appending(path: "map-photos.v1.json")
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let policy = try #require(root["policy"] as? [String: CGFloat])
        #expect(policy["thumbnailZoom"] == MapPhotoLayout.thumbnailZoom)
        #expect(policy["pinSpacing"] == MapPhotoLayout.pinSpacing)
        #expect(policy["thumbnailSpacing"] == MapPhotoLayout.thumbnailSpacing)
        #expect(policy["viewportMargin"] == MapPhotoLayout.viewportMargin)
        #expect(policy["maxMarkers"] == CGFloat(MapPhotoLayout.maxMarkers))
        for item in try #require(root["cases"] as? [[String: Any]]) {
            let points = try #require(item["points"] as? [[String: Any]]).map { point in
                MapPhotoLayout.Point(id: try #require(point["id"] as? String), x: try #require(point["x"] as? CGFloat), y: try #require(point["y"] as? CGFloat))
            }
            let size = CGSize(width: try #require(item["width"] as? CGFloat), height: try #require(item["height"] as? CGFloat))
            let zoom = try #require(item["zoom"] as? CGFloat)
            let expected = try #require(item["expected"] as? [[String]])
            #expect(MapPhotoLayout.groups(points, size: size, zoom: zoom).map(\.photoIDs) == expected)
            #expect(MapPhotoLayout.groups(points.reversed(), size: size, zoom: zoom).map(\.photoIDs) == expected)
        }
    }
    @Test func denseViewportKeepsEveryPhotoWithinBudget() {
        let points = (0..<10000).map { MapPhotoLayout.Point(id: String(format: "%05d", $0), x: CGFloat($0 % 100) * 30, y: CGFloat($0 / 100) * 30) }
        let groups = MapPhotoLayout.groups(points, size: CGSize(width: 3000, height: 3000), zoom: 15)
        #expect(groups.count <= 80 && groups.count > 1)
        #expect(groups.flatMap(\.photoIDs).count == points.count)
        #expect(Set(groups.flatMap(\.photoIDs)) == Set(points.map(\.id)))
        #expect(MapPhotoLayout.groups(points.reversed(), size: CGSize(width: 3000, height: 3000), zoom: 15) == groups)
    }
    @Test func zeroCoordinatesAreValidAndInvalidLocationsAreOmitted() {
        #expect(MapPhotoLayout.validLocation(CLLocationCoordinate2D(latitude: 0, longitude: 0)))
        #expect(!MapPhotoLayout.validLocation(nil))
        #expect(!MapPhotoLayout.validLocation(CLLocationCoordinate2D(latitude: 91, longitude: 0)))
        #expect(!MapPhotoLayout.validLocation(CLLocationCoordinate2D(latitude: 0, longitude: .infinity)))
        #expect(MapPhotoLayout.groups([.init(id: "a", x: .nan, y: 0)], size: CGSize(width: 400, height: 700), zoom: 15).isEmpty)
    }
    @MainActor @Test func scopeResetClearsPhotoVisibilityWithoutCameraOrSelectionNavigation() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        store.replaceSelection(with: [1])
        let selected = store.selectedActivityIDs
        let camera = store.mapContext.camera
        store.mapContext.showPhotos = true
        #expect(store.selectedActivityIDs == selected)
        #expect(store.mapContext.pendingRequest == nil)
        #expect(store.mapContext.camera.zoom == camera.zoom)
        store.mapContext.clearScope()
        #expect(!store.mapContext.showPhotos)
    }
}

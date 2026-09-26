import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct StoredModelMapperTests {
    @Test func mapsIDsDatesMetricsAndDetailedGeometry() throws {
        let dto = try Fixtures.activity()
        let model = try StoredModelMapper.activity(dto)
        #expect(model.id == 9_007_199_254_740_993) // no conversion through Double
        #expect(model.startDate == dto.startDate)
        #expect(model.startDate != dto.startDateLocal)
        #expect(model.startDateLocal == dto.startDateLocal && model.timezone == dto.timezone)
        #expect(model.localDayKey == "2026-09-20")
        #expect(model.distance == 1234.5 && model.movingTime == 900 && model.elapsedTime == 1000)
        #expect(model.totalElevationGain == 123.4 && model.averageSpeed == 1.25)
        #expect(model.maxWatts == 456 && model.weightedAverageWatts == 123)
        #expect(model.coordinates.count == 3)
        #expect(model.geometryState == .detailed && model.geometrySource == .detailed)
        #expect(!model.hasInvalidGeometry)
        #expect(model.coordinates[0].latitude == 38.5 && model.coordinates[0].longitude == -120.2)
        #expect(model.coordinates[2].latitude == 43.252 && model.coordinates[2].longitude == -126.453)
    }

    @Test(arguments: ["summary", "refresh_required"])
    func staleDetailedGeometryUsesSummary(state: String) throws {
        let model = try StoredModelMapper.activity(Fixtures.activity(["geometry_state": state]))
        #expect(model.coordinates.count == 1)
        #expect(model.geometryState.rawValue == state && model.geometrySource == .summary)
        #expect(model.coordinates[0].latitude == 0 && model.coordinates[0].longitude == 0)
    }

    @Test func nullMetricsAndMissingGeometryAreSupported() throws {
        let dto = try Fixtures.activity([
            "distance": NSNull(), "moving_time": NSNull(), "elapsed_time": NSNull(),
            "total_elevation_gain": NSNull(), "average_speed": NSNull(),
            "map_polyline": NSNull(), "map_summary_polyline": NSNull(),
        ])
        let model = try StoredModelMapper.activity(dto)
        #expect(model.distance == nil && model.elapsedTime == nil && model.movingTime == nil)
        #expect(model.totalElevationGain == nil && model.averageSpeed == nil)
        #expect(model.coordinates.isEmpty)
        #expect(model.averageHeartrate == nil && model.commute == nil)
        #expect(model.isPrivate == nil && model.flagged == nil)
        #expect(model.geometrySource == .none && !model.hasInvalidGeometry)
    }

    @Test func measuredZerosAndFalseFlagsAreNotMissing() throws {
        let model = try StoredModelMapper.activity(Fixtures.activity([
            "distance": 0, "moving_time": 0, "elapsed_time": 0, "total_elevation_gain": 0,
            "average_speed": 0, "average_watts": 0, "commute": false, "private": false, "flagged": false,
        ]))
        #expect(model.distance == 0 && model.elapsedTime == 0 && model.movingTime == 0)
        #expect(model.totalElevationGain == 0 && model.averageSpeed == 0 && model.averageWatts == 0)
        #expect(model.commute == false && model.isPrivate == false && model.flagged == false)
    }

    @Test func metadataSurvivesWithoutFetchingStreams() throws {
        let dto = try Fixtures.activity([
            "map_bbox": [170, -20, -170, 20], "start_latlng": [0, 0], "end_latlng": [91, 2],
            "private": true, "flagged": false, "trainer": true, "manual": false,
            "max_speed": 8.5, "calories": 400, "kilojoules": 900, "has_heartrate": true,
            "device_watts": false, "kudos_count": 0, "achievement_count": 3, "comment_count": 2,
            "photo_count": 0, "total_photo_count": 4, "photos_state": "refresh_required",
            "last_updated": "2026-09-21T10:00:00Z",
            "streams": ["generation": "generation-a", "revision": "12", "state": "current",
                        "fetch_status": "succeeded", "available_types": ["altitude", "distance"],
                        "fetched_at": "2026-09-21T10:00:00Z", "expires_at": NSNull()],
        ])
        let model = try StoredModelMapper.activity(dto)
        #expect(model.mapBounds == ActivityBounds([170, -20, -170, 20]))
        #expect(model.startCoordinate?.latitude == 0 && model.startCoordinate?.longitude == 0)
        #expect(model.endCoordinate == nil)
        #expect(model.isPrivate == true && model.flagged == false && model.trainer == true && model.manual == false)
        #expect(model.maxSpeed == 8.5 && model.calories == 400 && model.kilojoules == 900)
        #expect(model.hasHeartrate == true && model.deviceWatts == false)
        #expect(model.kudosCount == 0 && model.achievementCount == 3 && model.commentCount == 2)
        #expect(model.photoCount == 0 && model.totalPhotoCount == 4 && model.photosState == .refreshRequired)
        #expect(model.streams == dto.streams && model.lastUpdated == dto.lastUpdated)
        #expect(model.lastSummarySeenAt == dto.lastSummarySeenAt && model.lastDetailedFetchedAt == dto.lastDetailedFetchedAt)
    }

    @Test func malformedDetailedRouteFallsBackWithoutLosingActivity() throws {
        let model = try StoredModelMapper.activity(Fixtures.activity(["map_polyline": "_"]))
        #expect(model.name == "Morning hike" && model.distance == 1234.5)
        #expect(model.coordinates.count == 1 && model.geometrySource == .summary)
        #expect(model.hasInvalidGeometry && model.geometryState == .detailed)
    }

    @Test func unreadableRoutesRemainInspectableWithoutInventedBounds() throws {
        let model = try StoredModelMapper.activity(Fixtures.activity([
            "map_polyline": "_", "map_summary_polyline": "?", "map_bbox": [0, 0, 0, 0],
        ]))
        #expect(model.coordinates.isEmpty && model.geometrySource == .none && model.hasInvalidGeometry)
        #expect(model.mapBounds == nil)
        let store = ActivityStore(activities: [model])
        store.inspect(model.id)
        #expect(store.inspectedActivity?.name == model.name)
        #expect(store.showOnMap(model.id) == .noGeometry)
    }

    @Test func invalidBoundsAreRejectedButZeroAndCrossingBoundsAreValid() {
        #expect(ActivityBounds([0, 0, 0, 0]) != nil)
        #expect(ActivityBounds([170, -10, -170, 10]) != nil)
        #expect(ActivityBounds([0, 0, 0]) == nil)
        #expect(ActivityBounds([0, 20, 1, 10]) == nil)
        #expect(ActivityBounds([-181, 0, 1, 10]) == nil)
        #expect(ActivityBounds([0, 0, .infinity, 10]) == nil)
    }

    @Test func oversizedUIIdentifierFailsExplicitly() throws {
        let dto = try Fixtures.activity(["id": "99999999999999999999999999"])
        #expect(throws: StoredModelMapper.MappingError.self) { try StoredModelMapper.activity(dto) }
    }

    @Test func everyContractSportMapsToAUIType() throws {
        for sport in SportType.allCases {
            let model = try StoredModelMapper.activity(Fixtures.activity(["sport_type": sport.rawValue]))
            #expect(model.sportType == sport)
        }
    }

    @Test(arguments: ["_", "?", "~~~~~~~", "é", "\u{0000}"])
    func malformedPolylinesFailWithoutHanging(encoded: String) {
        #expect(throws: Polyline.DecodeError.self) { try Polyline.decode(encoded) }
    }

    @Test func photoMappingKeepsStringIDsURLsAndCoordinates() throws {
        let dto = try Fixtures.photo()
        let model = StoredModelMapper.photo(dto)
        #expect(model.id == dto.uniqueID && model.activityID == dto.activityID)
        #expect(model.urls["600"] == "https://example.test/photo.jpg")
        #expect(model.location?.latitude == 46.5 && model.location?.longitude == 8.5)
        #expect(model.createdAt == dto.createdAt)
        #expect(StoredModelMapper.photo(try Fixtures.photo(["location": [999, 8]])).location == nil)
    }
}

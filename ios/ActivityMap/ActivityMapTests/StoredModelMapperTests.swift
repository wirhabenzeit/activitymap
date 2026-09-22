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
        #expect(model.distance == 1234.5 && model.movingTime == 900 && model.elapsedTime == 1000)
        #expect(model.totalElevationGain == 123.4 && model.averageSpeed == 1.25)
        #expect(model.maxWatts == 456 && model.weightedAverageWatts == 123)
        #expect(model.coordinates.count == 3)
        #expect(model.coordinates[0].latitude == 38.5 && model.coordinates[0].longitude == -120.2)
        #expect(model.coordinates[2].latitude == 43.252 && model.coordinates[2].longitude == -126.453)
    }

    @Test(arguments: ["summary", "refresh_required"])
    func staleDetailedGeometryUsesSummary(state: String) throws {
        let model = try StoredModelMapper.activity(Fixtures.activity(["geometry_state": state]))
        #expect(model.coordinates.count == 1)
        #expect(model.coordinates[0].latitude == 0 && model.coordinates[0].longitude == 0)
    }

    @Test func nullMetricsAndMissingGeometryAreSupported() throws {
        let dto = try Fixtures.activity([
            "distance": NSNull(), "moving_time": NSNull(), "elapsed_time": NSNull(),
            "total_elevation_gain": NSNull(), "average_speed": NSNull(),
            "map_polyline": NSNull(), "map_summary_polyline": NSNull(),
        ])
        let model = try StoredModelMapper.activity(dto)
        #expect(model.distance == 0 && model.elapsedTime == 0 && model.movingTime == 0)
        #expect(model.coordinates.isEmpty)
        #expect(model.averageHeartrate == nil && model.commute == false)
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

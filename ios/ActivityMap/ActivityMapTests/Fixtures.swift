import Foundation
@testable import ActivityMap

enum Fixtures {
    static let scope = StoreScope(deployment: URL(string: "https://example.test")!, userID: "alice")
    static let checkpoint = SyncCheckpoint(
        bootstrapCursor: "snapshot", bootstrapComplete: true, changesCursor: "cursor-1",
        lastSyncAt: Date(timeIntervalSince1970: 1_700_000_000),
        retention: .init(retentionDays: 30, cursorValidUntil: Date(timeIntervalSince1970: 1_800_000_000)),
        freshness: .init(lastSummaryReconciledAt: Date(timeIntervalSince1970: 1_700_000_000)))

    static func activity(_ overrides: [String: Any] = [:]) throws -> ActivityMapAPI.Activity {
        var fields: [String: Any] = [
            "id": "9007199254740993", "athlete": "42", "name": "Morning hike",
            "sport_type": "Hike", "start_date": "2026-09-20T09:12:34.123Z",
            "start_date_local": "2026-09-20T11:12:34.123Z", "timezone": "Europe/Zurich",
            "distance": 1234.5, "moving_time": 900, "elapsed_time": 1000,
            "total_elevation_gain": 123.4, "average_speed": 1.25,
            "map_polyline": "_p~iF~ps|U_ulLnnqC_mqNvxq`@", "map_summary_polyline": "??",
            "geometry_state": "detailed", "photos_state": "current",
            "last_summary_seen_at": "2026-09-20T12:00:00.456Z",
            "last_detailed_fetched_at": "2026-09-20T10:00:00.789Z",
            "max_watts": 456, "weighted_average_watts": 123,
        ]
        fields.merge(overrides) { _, value in value }
        return try ActivityMapAPI.makeDecoder().decode(
            ActivityMapAPI.Activity.self, from: JSONSerialization.data(withJSONObject: fields))
    }

    static func photo(_ overrides: [String: Any] = [:]) throws -> ActivityMapAPI.Photo {
        var fields: [String: Any] = [
            "unique_id": "photo:1", "activity_id": "9007199254740993", "athlete_id": "42",
            "type": 1, "caption": "Summit", "urls": ["600": "https://example.test/photo.jpg"],
            "sizes": ["600": [600, 400]], "location": [46.5, 8.5],
            "created_at": "2026-09-20T11:00:00.123Z",
        ]
        fields.merge(overrides) { _, value in value }
        return try ActivityMapAPI.makeDecoder().decode(
            ActivityMapAPI.Photo.self, from: JSONSerialization.data(withJSONObject: fields))
    }
}

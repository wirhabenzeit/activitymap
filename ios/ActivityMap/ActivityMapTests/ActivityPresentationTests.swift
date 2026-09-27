import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct ActivityPresentationTests {
    @Test func formattersKeepUnknownDistinctFromZeroAndUseCanonicalUnits() {
        let english = Locale(identifier: "en_US")
        #expect(Formatters.distance(nil) == Formatters.unknown)
        #expect(Formatters.duration(nil) == Formatters.unknown)
        #expect(Formatters.elevation(nil) == Formatters.unknown)
        #expect(Formatters.speed(nil) == Formatters.unknown)
        #expect(Formatters.distance(0, locale: english) == "0.0 km")
        #expect(Formatters.duration(0) != Formatters.unknown)
        #expect(Formatters.distance(1234.5, locale: english) == "1.2 km")
        #expect(Formatters.speed(1.25, locale: english) == "4.5 km/h")
        #expect(Formatters.elevation(-12.4, locale: english) == "-12 m")
        #expect(Formatters.watts(123.6, locale: english) == "124 W")
        #expect(Formatters.heartrate(120.4, locale: english) == "120 bpm")
        #expect(Formatters.distance(1234.5, locale: Locale(identifier: "de_DE")) == "1,2 km")
        #expect(Formatters.distance(.infinity) == Formatters.unknown)
    }

    @Test func detailDoesNotHidePartialMetricsOrMeasuredZeros() throws {
        let model = try StoredModelMapper.activity(Fixtures.activity([
            "distance": NSNull(), "moving_time": NSNull(), "elapsed_time": 0,
            "total_elevation_gain": 0, "elev_high": NSNull(), "elev_low": -12,
            "average_heartrate": 120, "max_heartrate": NSNull(),
            "average_watts": NSNull(), "max_watts": 0, "weighted_average_watts": NSNull(),
        ]))
        let rows = ActivityMetricRow.rows(for: model)
        let ids = Set(rows.map(\.id))
        #expect(ids.isSuperset(of: ["elapsedTime", "elevationGain", "elevLow", "averageHeartrate", "maxWatts"]))
        #expect(ids.isDisjoint(with: ["distance", "movingTime", "elevHigh", "maxHeartrate", "averageWatts", "weightedAverageWatts"]))
        #expect(rows.allSatisfy { $0.value != Formatters.unknown })
    }

    @Test func activeNumericAndBooleanFiltersExcludeUnknownButIncludeZero() throws {
        let unknown = try StoredModelMapper.activity(Fixtures.activity([
            "id": "1", "distance": NSNull(), "elapsed_time": NSNull(), "total_elevation_gain": NSNull(),
        ]))
        let zero = try StoredModelMapper.activity(Fixtures.activity([
            "id": "2", "distance": 0, "elapsed_time": 0, "total_elevation_gain": 0, "commute": false,
        ]))
        let store = ActivityStore(activities: [unknown, zero])
        #expect(store.filteredActivities.map(\.id) == [1, 2])
        store.distanceFilter = NumericFilter(operatorType: .lte, value: 0)
        #expect(store.filteredActivities.map(\.id) == [2])
        store.distanceFilter = nil
        store.durationFilter = NumericFilter(operatorType: .gte, value: 0)
        #expect(store.filteredActivities.map(\.id) == [2])
        store.durationFilter = nil
        store.elevationFilter = NumericFilter(operatorType: .lte, value: 0)
        #expect(store.filteredActivities.map(\.id) == [2])
        store.elevationFilter = nil
        store.commuteOnly = false
        #expect(store.filteredActivities.map(\.id) == [2])
        store.resetFilters()
        #expect(store.filteredActivities.count == 2)
    }

    @Test(arguments: ["UTC", "America/Los_Angeles", "Pacific/Auckland"])
    func sharedLocalDatesAndNullableProjectionsSurviveMapping(deviceTimezone: String) throws {
        // Synchronous MainActor execution prevents other UI tests observing
        // a temporary process timezone between an await and its restoration.
        let previous = NSTimeZone.default
        NSTimeZone.default = try #require(TimeZone(identifier: deviceTimezone))
        defer { NSTimeZone.default = previous }
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "shared/parity/activity-fixtures.v1.json")
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let projections = try #require(root["activities"] as? [[String: Any]])
        #expect(projections.count >= 8)
        var models: [Activity] = []
        for projection in projections {
            var fields: [String: Any] = [:]
            for key in ["distance", "elapsed_time", "moving_time", "total_elevation_gain", "average_speed",
                        "average_heartrate", "max_heartrate", "average_watts", "max_watts", "weighted_average_watts",
                        "elev_high", "elev_low", "commute", "private", "flagged"] {
                fields[key] = projection[key] ?? NSNull()
            }
            fields.merge(projection) { _, value in value }
            let model = try StoredModelMapper.activity(Fixtures.activity(fields))
            models.append(model)
            let localDate = try #require(projection["start_date_local"] as? String)
            #expect(model.localDayKey == String(localDate.prefix(10)))
            #expect(model.distance == projection["distance"] as? Double)
            #expect(model.movingTime == projection["moving_time"] as? Int)
            #expect(model.commute == projection["commute"] as? Bool)
            #expect(model.isPrivate == projection["private"] as? Bool)
            #expect(model.flagged == projection["flagged"] as? Bool)
        }

        let firstDST = try #require(models.first { $0.id == 105 })
        let secondDST = try #require(models.first { $0.id == 106 })
        #expect(firstDST.startDate != secondDST.startDate)
        #expect(firstDST.startDateLocal == secondDST.startDateLocal)
        let german = Locale(identifier: "de_DE")
        #expect(Formatters.shortDateTime(firstDST.startDateLocal, timeZone: .gmt, locale: german).contains("02:30"))

        let early = try #require(models.first { $0.id == 101 })
        let late = try #require(models.first { $0.id == 102 })
        let nextDay = try #require(models.first { $0.id == 104 })
        let store = ActivityStore(activities: [early, late, nextDay])
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let chosenDay = try #require(calendar.date(from: DateComponents(year: 2026, month: 3, day: 29)))
        store.dateRange = chosenDay...chosenDay
        #expect(store.filteredActivities.map(\.id) == [101, 102], "include both boundaries of the activity-local day")
    }
}

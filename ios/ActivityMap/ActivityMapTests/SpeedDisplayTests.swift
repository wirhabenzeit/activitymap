import Foundation
import Testing
@testable import ActivityMap

@MainActor struct SpeedDisplayTests {
    @Test func sharedSportUnitsRoundingAndScopeFixtures() throws {
        struct Fixture: Decodable {
            struct Format: Decodable { let sport: String; let speed: Double?; let metric: String; let imperial: String }
            struct Scope: Decodable { let sports: [String]; let display: String }
            let formatCases: [Format]; let scopeCases: [Scope]
        }
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "shared/parity/speed-display.v1.json")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        for row in fixture.formatCases {
            let sport = try #require(SportType(rawValue: row.sport))
            for units in UnitSystem.allCases {
                #expect(SpeedDisplay.forSport(sport).format(row.speed, units: units, locale: Locale(identifier: "en_US")) == (units == .metric ? row.metric : row.imperial))
            }
        }
        for row in fixture.scopeCases {
            let activities = try row.sports.enumerated().map { index, sport in
                try StoredModelMapper.activity(Fixtures.activity(["id": String(index + 1), "sport_type": sport]))
            }
            let expected: SpeedDisplay = row.display == "run" ? .run : row.display == "swim" ? .swim : .speed
            #expect(SpeedDisplay.forActivities(activities) == expected)
        }
        for value in [Double.nan, .infinity, -.infinity, .leastNonzeroMagnitude] {
            #expect(SpeedDisplay.run.format(value) == "—")
            #expect(SpeedDisplay.swim.format(value) == "—")
        }
    }

    @Test func tableSortAndDetailSemantics() throws {
        let activities = try [10.0 / 3, 2.5, 0].enumerated().map { index, speed in
            try StoredModelMapper.activity(Fixtures.activity(["id": String(index + 1), "sport_type": "Run", "average_speed": speed]))
        }
        let presentation = ActivityListPresentation(defaults: nil)
        presentation.settings.sort = ActivityListSort(field: .averageSpeed, direction: .ascending)
        let store = ActivityStore(activities: activities, listPresentation: presentation)
        #expect(store.listedActivities.map(\.id) == [1, 2, 3])
        presentation.settings.sort.direction = .descending
        #expect(store.listedActivities.map(\.id) == [2, 1, 3])
        #expect(ActivityTableLayout.title(.averageSpeed, speedDisplay: .run) == "Avg min/km")
        #expect(ActivityTableLayout.value(.averageSpeed, activity: activities[0], speedDisplay: .run) == "5:00")
        #expect(ActivityListMetric.averageSpeed.value(for: activities[0]) == "12.0 km/h")
        #expect(ActivityListMetric.averageSpeed.title(speedDisplay: .run) == "Average pace")
        let groups = ActivityMetricGroup.groups(for: activities[0])
        #expect(groups.first?.title == "Time & pace")
        #expect(groups.flatMap(\.rows).contains { $0.id == "averageSpeed" && $0.value == "12.0 km/h" })
        #expect(ActivityTableLayout.title(.averageSpeed, units: .imperial) == "Avg mph")
        #expect(ActivityTableLayout.value(.averageSpeed, activity: activities[0], speedDisplay: .run, units: .imperial, locale: Locale(identifier: "en_US")) == "8:03")
    }
}

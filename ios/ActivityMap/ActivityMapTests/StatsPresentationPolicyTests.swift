import Foundation
import Testing
@testable import ActivityMap

@MainActor struct StatsPresentationPolicyTests {
    @Test func bothClientsUseSharedComparisonAxisAndKeyboardExamples() throws {
        let fixture = try StatsFixtureTests.json("stats-presentation-fixtures.v1.json")
        for row in fixture["percentages"] as! [[String: Any]] {
            let facts = StatsComparisonPresentation(current: row["current"] as! Double, previous: row["previous"] as! Double)
            #expect(facts.direction.rawValue == row["direction"] as! String)
            #expect(facts.magnitude == row["magnitude"] as? Double)
            #expect(facts.lessThanOne == row["lessThanOne"] as! Bool)
            #expect(facts.percentage(locale: Locale(identifier: "en_US")) == row["text"] as? String)
        }
        for row in fixture["axes"] as! [[String: Any]] {
            #expect(StatsDisplay.compactAxis(row["value"] as! Double, step: row["step"] as! Double, locale: Locale(identifier: "en_US")) == row["text"] as! String)
        }
        for row in fixture["navigation"] as! [[String: Any]] {
            let target = StatsDayGrid.target(day: row["day"] as! Int, key: row["key"] as! String,
                first: row["first"] as! Int, last: row["last"] as! Int,
                layout: StatsDayGrid.Layout(rawValue: row["layout"] as! String)!, rtl: row["rtl"] as! Bool)
            #expect(target == row["expected"] as? Int)
        }
    }
    @Test func comparisonModelsCarryActualClampedWindows() throws {
        let fixture = try StatsFixtureTests.json("stats-presentation-fixtures.v1.json")
        let engine = StatsEngine(activities: [])
        for row in fixture["periods"] as! [[String: Any]] {
            let today = StatsDates.day(row["today"] as! String)
            let values = row["kind"] as! String == "month" ? engine.monthComparison(today: today, metric: .distance) : engine.yearToDate(today: today, metric: .distance)
            let periods = try #require(values.periods)
            #expect(periods.current.first == StatsDates.day(row["first"] as! String))
            #expect(periods.current.last == today && !periods.current.complete)
            #expect(periods.previous.first == StatsDates.day(row["previousFirst"] as! String))
            #expect(periods.previous.last == StatsDates.day(row["previousLast"] as! String))
            #expect(periods.previous.complete == row["previousComplete"] as! Bool)
        }
    }
    @Test func chartIdentityAndRoleIgnoreTranslationAndOrdering() {
        let first = StatsChartPoint(x: 2, value: 1, series: "This month", partial: false, role: .current)
        let translated = StatsChartPoint(x: 2, value: 1, series: "Dieser Monat", partial: false, role: .current)
        let reference = StatsChartPoint(x: 2, value: 1, series: "This month", partial: false, role: .comparison)
        #expect(first.id == translated.id && first.id != reference.id)
        #expect(reference.role == .comparison)
    }
    @Test func monthInitialSelectionPreservesExplicitEmptyDaysAndFencesFutureDays() {
        #expect(StatsDayGrid.selectedMonthDay(candidate: nil, activeDays: [2, 8, 12], first: 1, last: 10) == 8)
        #expect(StatsDayGrid.selectedMonthDay(candidate: 4, activeDays: [2, 8], first: 1, last: 10) == 4)
        #expect(StatsDayGrid.selectedMonthDay(candidate: 20, activeDays: [2, 8], first: 1, last: 10) == 8)
        #expect(StatsDayGrid.selectedMonthDay(candidate: nil, activeDays: [], first: 1, last: 10) == nil)
    }
}

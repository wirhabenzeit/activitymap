import Foundation
import Testing
@testable import ActivityMap

/// The explorers choose among precomputed periods, so their inputs must agree
/// with the dashboard's own totals and with the web's explorer definitions.
struct StatsExplorerTests {
    private let today = StatsDates.day("2026-10-10")
    private func activity(_ id: Int, _ day: String, _ sport: ActivityCategory = .ride, distance: Double? = 20_000,
                          elevation: Double? = 200) -> StatsActivity {
        .init(id: id, name: "Activity \(id)", sport: sport, start: StatsDates.date(StatsDates.day(day)),
              distance: distance, movingTime: 3600, elevation: elevation)
    }
    private var engine: StatsEngine {
        StatsEngine(activities: [
            activity(1, "2026-10-02"), activity(2, "2026-10-09", .run, distance: 10_000),
            activity(3, "2026-09-05"), activity(4, "2025-10-03"), activity(5, "2024-10-04"),
            activity(6, "2025-08-01", .run, distance: 8_000, elevation: nil),
        ])
    }

    @Test func monthExplorerCarriesACumulativeLinePerComparisonMonth() {
        let explorer = engine.monthExplorer(today: today, metric: .distance, band: nil)
        #expect(explorer.rows.count == 12)
        #expect(explorer.rows[0].start == StatsDates.day("2026-10-01"))
        // Day 0 anchors every line; the current month stops at today.
        #expect(explorer.lines[explorer.rows[0].start]?.first?.y == 0)
        #expect(explorer.lines[explorer.rows[0].start]?.count == 11)
        #expect(explorer.lines[explorer.rows[0].start]?.last?.y == 30)
        // A finished month runs to its own last day.
        #expect(explorer.lines[StatsDates.day("2026-09-01")]?.last?.x == 30)
        #expect(explorer.lines[StatsDates.day("2026-09-01")]?.last?.y == 20)
        #expect(explorer.rhythm.days.count == 31)
    }

    @Test func yearExplorerPairsEveryEarlierYearWithTheSameCalendarDate() {
        let explorer = engine.yearExplorer(today: today, metric: .distance, band: nil)
        #expect(explorer.rows.map { StatsDates.parts($0.start).year! } == [2026, 2025, 2024])
        let october = StatsDates.day("2026-10-01")
        for year in [2025, 2024] {
            let month = explorer.months[year]?.first { $0.start == october }
            #expect(month?.current.values.reduce(0, +) == 30)
        }
        // 3 Oct 2025 is inside "through 10 Oct"; 4 Oct 2024 likewise.
        #expect(explorer.months[2025]?.last?.previous[.ride] == 20)
        #expect(explorer.months[2024]?.last?.previous[.ride] == 20)
        // Comparing with a year before the first recorded one still yields bars.
        #expect(explorer.months[2025]?.count == 10)
    }

    @Test func comparedYearDefaultsToThePreviousYear() {
        let defaulted = engine.yearMonthlyRhythm(today: today, metric: .distance)
        let explicit = engine.yearMonthlyRhythm(today: today, metric: .distance, comparedYear: 2025)
        #expect(defaulted.map { $0.previous.values.reduce(0, +) } == explicit.map { $0.previous.values.reduce(0, +) })
    }

    @Test func hillinessExplorerKeepsOnlyMeasuredActivitiesPerSport() {
        let explorer = engine.hillinessExplorer(today: today)
        #expect(Set(explorer.sports.map(\.sport)) == [.ride, .run])
        #expect(explorer.dominant == .ride)
        let ride = explorer.sports.first { $0.sport == .ride }!
        #expect(ride.months.count == 12)
        #expect(ride.climbing.current == 1000)  // 200 m / 20 km → 10 m/km, stored ×100
        #expect(ride.hasPreviousYear)
        // The run with no recorded ascent never reaches the explorer.
        #expect(explorer.sports.first { $0.sport == .run }?.activities.map(\.id) == [2])
    }

    @Test func hillinessExplorerIsEmptyWithoutRecentMeasuredActivities() {
        let old = StatsEngine(activities: [activity(1, "2020-01-01")])
        #expect(old.hillinessExplorer(today: today).sports.isEmpty)
        #expect(old.hillinessExplorer(today: today).dominant == nil)
    }
}

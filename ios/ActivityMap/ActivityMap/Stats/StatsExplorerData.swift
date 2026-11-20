import Foundation

/// Everything an expanded Stats explorer needs, calculated once on the stats
/// executor so selecting a period, a comparison or a sport only picks from it.
/// Mirrors the web explorers' inputs (`period-explorer`, `month-explorer`,
/// `hilliness-explorer`); presentation adapts to the platform.

nonisolated struct StatsMonthExplorer: Sendable {
    /// Twelve calendar months, the current one first.
    let rows: [StatsPeriodHistoryComparison]
    /// Cumulative totals by day of the month for each row, keyed by its start.
    let lines: [Int: [StatsPoint]]
    let rhythm: StatsMonthRhythm
    let band: StatsComparisonBand?
}

nonisolated struct StatsYearExplorer: Sendable {
    /// Every recorded year, the current one first.
    let rows: [StatsPeriodHistoryComparison]
    /// Cumulative totals by day of a leap reference year, keyed by row start.
    let lines: [Int: [StatsPoint]]
    /// Monthly sport totals paired with each earlier year, keyed by that year.
    let months: [Int: [StatsYearMonthRhythm]]
    let band: StatsComparisonBand?
    let activities: [StatsActivity]
}

nonisolated enum StatsComparisonExplorer: Sendable {
    case month(StatsMonthExplorer)
    case year(StatsYearExplorer)
}

/// One sport's monthly climbing. Hilliness only compares routes within a sport.
nonisolated struct StatsHillinessSport: Sendable {
    let sport: ActivityCategory
    let climbing: StatsClimbing
    /// The twelve calendar months by distance; `incomplete` flags the current one.
    let months: [StatsHistoryBucket]
    /// Activities with both distance and ascent recorded.
    let activities: [StatsActivity]
    let hasPreviousYear: Bool
}

nonisolated struct StatsHillinessExplorer: Sendable {
    let sports: [StatsHillinessSport]
    /// The sport with the most distance in the last twelve months.
    let dominant: ActivityCategory?
}

nonisolated extension StatsEngine {
    func monthExplorer(today: Int, metric: StatsMetric, band: StatsComparisonBand?) -> StatsMonthExplorer {
        let rows = periodComparisons(today: today, metric: metric, range: .months)
        let rhythm = monthActivityRhythm(today: today, metric: metric)
        var lines: [Int: [StatsPoint]] = [:]
        for row in rows {
            let last = min(row.end, row.start + rhythm.days.count - 1)
            lines[row.start] = [.init(x: 0, y: 0)] + cumulativeByDay(metric: metric, first: row.start, last: last)
                .enumerated().map { .init(x: $0.offset + 1, y: $0.element) }
        }
        return .init(rows: rows, lines: lines, rhythm: rhythm, band: band)
    }

    func yearExplorer(today: Int, metric: StatsMetric, band: StatsComparisonBand?) -> StatsYearExplorer {
        let rows = periodComparisons(today: today, metric: metric, range: .years)
        var lines: [Int: [StatsPoint]] = [:]
        var months: [Int: [StatsYearMonthRhythm]] = [:]
        let year = StatsDates.parts(today).year!
        for row in rows {
            let value = StatsDates.parts(row.start).year!
            lines[row.start] = cumulativeYearPoints(metric: metric, year: value, last: row.end)
            if value < year { months[value] = yearMonthlyRhythm(today: today, metric: metric, comparedYear: value) }
        }
        // Without an earlier recorded year the bars still need this year's months.
        if months[year - 1] == nil { months[year - 1] = yearMonthlyRhythm(today: today, metric: metric, comparedYear: year - 1) }
        return .init(rows: rows, lines: lines, months: months, band: band, activities: activities)
    }

    func hillinessExplorer(today: Int) -> StatsHillinessExplorer {
        let first = StatsDates.previousYear(today)
        let measured = activities.filter { ($0.distance ?? 0) > 0 && $0.elevation != nil && $0.day <= today }
        let sports: [StatsHillinessSport] = ActivityCategory.allCases.compactMap { sport in
            let rows = measured.filter { $0.sport == sport }
            guard rows.contains(where: { $0.day >= first }) else { return nil }
            let sub = StatsEngine(activities: rows)
            return .init(sport: sport, climbing: sub.climbing(today: today),
                         months: sub.volumeHistory(today: today, metric: .distance, range: .months),
                         activities: rows,
                         hasPreviousYear: rows.contains { $0.day >= StatsDates.previousYear(first) && $0.day < first })
        }
        // Stable on ties: the earlier sport in catalogue order wins.
        let dominant = sports.enumerated().max { a, b in
            let da = a.element.activities.filter { $0.day >= first }.reduce(0) { $0 + ($1.distance ?? 0) }
            let db = b.element.activities.filter { $0.day >= first }.reduce(0) { $0 + ($1.distance ?? 0) }
            return da == db ? a.offset > b.offset : da < db
        }?.element.sport
        return .init(sports: sports, dominant: dominant)
    }
}

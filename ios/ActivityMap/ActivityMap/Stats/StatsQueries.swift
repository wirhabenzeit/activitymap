import Foundation

/// Exact arguments are cacheable; presentation never substitutes a selected
/// map/list ID set or shared date range for the engine's authorized history.
nonisolated enum StatsQuery: Hashable, Sendable {
    case dashboard(StatsTileID, StatsToggleOption?)
    case thisWeek(StatsMetric), weeklyVolume(StatsMetric, weeks: Int), fourWeekVolume(StatsMetric)
    case monthComparison(StatsMetric, offset: Int), yearComparison(StatsMetric, offset: Int)
    case yearPace(StatsMetric), totals, records(StatsWindow), best30Days(StatsMetric)
    case calendar(first: Int, last: Int), calendarMonths(first: Int?)
    case consistency(weeks: Int), sportMix(StatsWindow), typicalWeek, restDays, hilliness
    case cumulative(StatsMetric, first: Int, last: Int), yearCurve(StatsMetric, year: Int, last: Int)
    case volumeHistory(StatsMetric, StatsHistoryRange, page: Int)
}
nonisolated enum StatsResult: Sendable {
    case dashboard(StatsDashboardResult)
    case thisWeek(StatsThisWeek), volume(starts: [Int], values: [Double]), comparison(StatsPeriodComparison)
    case pace(StatsPace), totals(StatsTotals), records(StatsRecords), bestDays(StatsBestDays)
    case calendar([Int: StatsCalendarDay]), months([StatsCalendarMonth])
    case consistency(StatsConsistency, weeks: [StatsWeek]), sportMix([StatsShare], breakdown: [ActivityCategory: StatsTotals])
    case typicalWeek(StatsTypicalWeek), restDays(last30: Int, last90: Int)
    case hilliness(StatsClimbing, points: [StatsHillPoint], hilliest: [StatsHillPoint])
    case cumulative([Double]), yearCurve([StatsPoint]), history([StatsHistoryBucket])
}
nonisolated extension StatsEngine {
    func evaluate(_ query: StatsQuery, today: Int) -> StatsResult {
        switch query {
        case .dashboard(let tile, let option): .dashboard(dashboard(tile, option: option, today: today))
        case .thisWeek(let metric): .thisWeek(thisWeek(today: today, metric: metric))
        case .weeklyVolume(let metric, let weeks): { let v = weeklyVolume(today: today, metric: metric, weeks: weeks); return .volume(starts: v.weekStarts, values: v.values) }()
        case .fourWeekVolume(let metric): .comparison(fourWeekVolume(today: today, metric: metric))
        case .monthComparison(let metric, let offset): .comparison(monthComparison(today: today, metric: metric, offset: offset))
        case .yearComparison(let metric, let offset): .comparison(yearComparison(today: today, metric: metric, offset: offset))
        case .yearPace(let metric): .pace(yearPace(today: today, metric: metric))
        case .totals: .totals(totals(today: today))
        case .records(let range): .records(records(today: today, range: range))
        case .best30Days(let metric): .bestDays(best30Days(today: today, metric: metric))
        case .calendar(let first, let last): .calendar(calendarDays(first: first, last: last))
        case .calendarMonths(let first): .months(calendarMonths(today: today, first: first))
        case .consistency(let weeks): .consistency(consistency(today: today, weeks: weeks), weeks: weeklyActiveDays(today: today, weeks: weeks))
        case .sportMix(let range): .sportMix(sportMix(today: today, range: range), breakdown: sportBreakdown(first: range == .allTime ? activities.map(\.day).min() ?? today : StatsDates.start(year: StatsDates.parts(today).year!), last: today))
        case .typicalWeek: .typicalWeek(typicalWeek(today: today))
        case .restDays: { let v = restDays(today: today); return .restDays(last30: v.last30, last90: v.last90) }()
        case .hilliness: .hilliness(climbing(today: today), points: hillPoints(first: StatsDates.previousYear(today), last: today), hilliest: hilliestActivities(today: today))
        case .cumulative(let metric, let first, let last): .cumulative(cumulativeByDay(metric: metric, first: first, last: last))
        case .yearCurve(let metric, let year, let last): .yearCurve(cumulativeYearPoints(metric: metric, year: year, last: last))
        case .volumeHistory(let metric, let range, let page): .history(volumeHistory(today: today, metric: metric, range: range, page: page))
        }
    }
}

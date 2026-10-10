import Foundation

nonisolated struct StatsMonthRhythmDay: Sendable {
    let day: Int
    let activities: [StatsActivity]
    let bySport: [ActivityCategory: Double]
}
nonisolated struct StatsMonthRhythm: Sendable {
    let days: [StatsMonthRhythmDay]
    let activityCount: Int
    let activeDays: Int
    let measuredCount: Int
    let average: Double?
}
nonisolated struct StatsYearMonthRhythm: Sendable {
    let start: Int
    let current: [ActivityCategory: Double]
    let previous: [ActivityCategory: Double]
    let inProgress: Bool
}
nonisolated enum StatsComparisonRhythm: Sendable {
    case month(StatsMonthRhythm)
    case year([StatsYearMonthRhythm])
}
nonisolated struct StatsPeriodHistoryComparison: Sendable {
    let start: Int
    let end: Int
    let total: Double
    let bySport: [ActivityCategory: Double]
    let incomplete: Bool
    let cutoff: Int
    let elapsed: Double
    /// The current period has not finished, so its final total is unavailable.
    let fullTotal: Double?
}

nonisolated extension StatsEngine {
    func monthActivityRhythm(today: Int, metric: StatsMetric) -> StatsMonthRhythm {
        let date = StatsDates.parts(today)
        let first = StatsDates.start(year: date.year!, month: date.month!)
        let next = StatsDates.start(year: date.year!, month: date.month! + 1)
        let calendar = calendarDays(first: first, last: today)
        let days: [StatsMonthRhythmDay] = (first..<next).map { day in
            let rows = calendar[day]?.activities ?? []
            let values = Dictionary(uniqueKeysWithValues: ActivityCategory.allCases.map { sport in
                (sport, rows.filter { $0.sport == sport }.reduce(0) { $0 + $1.value(metric) })
            })
            return .init(day: day, activities: rows, bySport: values)
        }
        let rows = days.flatMap(\.activities)
        let activeDays = days.filter { !$0.activities.isEmpty }.count
        let measured = rows.filter { activity in
            switch metric {
            case .count: true
            case .distance: activity.distance != nil
            case .time: activity.movingTime != nil
            case .elevation: activity.elevation != nil
            }
        }.count
        let denominator = metric == .count ? activeDays : measured
        return .init(days: days, activityCount: rows.count, activeDays: activeDays, measuredCount: measured,
                     average: denominator > 0 ? rows.reduce(0) { $0 + $1.value(metric) } / Double(denominator) : nil)
    }

    func yearMonthlyRhythm(today: Int, metric: StatsMetric) -> [StatsYearMonthRhythm] {
        let date = StatsDates.parts(today), year = date.year!, month = date.month!
        let previousThrough = StatsDates.previousYear(today)
        func values(first: Int, last: Int) -> [ActivityCategory: Double] {
            let split = sportBreakdown(first: first, last: last)
            return Dictionary(uniqueKeysWithValues: ActivityCategory.allCases.map { ($0, split[$0]?[metric] ?? 0) })
        }
        return (1...month).map { index in
            let start = StatsDates.start(year: year, month: index)
            let previous = StatsDates.start(year: year - 1, month: index)
            return .init(start: start,
                         current: values(first: start, last: min(today, StatsDates.start(year: year, month: index + 1) - 1)),
                         previous: values(first: previous, last: min(previousThrough, StatsDates.start(year: year - 1, month: index + 1) - 1)),
                         inProgress: index == month)
        }
    }

    func periodComparisons(today: Int, metric: StatsMetric, range: StatsHistoryRange) -> [StatsPeriodHistoryComparison] {
        precondition(range == .months || range == .years)
        let date = StatsDates.parts(today)
        return volumeHistory(today: today, metric: metric, range: range).map { bucket in
            let start = StatsDates.parts(bucket.start)
            let month = range == .months ? start.month! : date.month!
            let nextMonth = StatsDates.start(year: start.year!, month: month + 1)
            let monthStart = StatsDates.start(year: start.year!, month: month)
            let cutoff = monthStart + min(date.day!, nextMonth - monthStart) - 1
            return StatsPeriodHistoryComparison(start: bucket.start, end: bucket.end, total: bucket.total,
                bySport: bucket.bySport, incomplete: bucket.incomplete, cutoff: cutoff,
                elapsed: sum(metric, first: bucket.start, last: min(cutoff, bucket.end)),
                fullTotal: bucket.end == today ? nil : bucket.total)
        }.reversed()
    }
}

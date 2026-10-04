import Foundation

/// A date-only wall-clock coordinate. Activity dates use UTC fields; only
/// `localToday` consults the viewer timezone. Arithmetic cannot cross DST.
nonisolated enum StatsDates {
    static let secondsPerDay = 86_400.0
    static var calendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = .gmt; return c }
    static func day(_ date: Date) -> Int { Int(floor(date.timeIntervalSince1970 / secondsPerDay)) }
    static func day(_ key: String) -> Int {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        precondition(parts.count == 3)
        return start(year: parts[0], month: parts[1], date: parts[2])
    }
    static func date(_ day: Int) -> Date { Date(timeIntervalSince1970: Double(day) * secondsPerDay) }
    static func key(_ day: Int) -> String {
        let c = parts(day)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
    static func parts(_ day: Int) -> DateComponents { calendar.dateComponents([.year, .month, .day], from: date(day)) }
    static func start(year: Int, month: Int = 1, date: Int = 1) -> Int {
        day(calendar.date(from: DateComponents(year: year, month: month, day: date))!)
    }
    static func monday(_ day: Int) -> Int { day - ((day + 3) % 7 + 7) % 7 }
    static func previousYear(_ day: Int) -> Int {
        let c = parts(day), year = c.year! - 1, month = c.month!
        let length = start(year: year, month: month + 1) - start(year: year, month: month)
        return start(year: year, month: month, date: min(c.day!, length))
    }
    static func localToday(now: Date = Date(), timeZone: TimeZone = .current) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return start(year: c.year!, month: c.month!, date: c.day!)
    }
}

/// Only metadata crosses to aggregation work. No coordinates, stream/photo
/// metadata, loaders, API clients or managed persistence objects are retained.
nonisolated struct StatsActivity: Sendable {
    let id: Int?
    let name: String
    let sport: ActivityCategory
    let start: Date
    let distance: Double?
    let movingTime: Double?
    let elevation: Double?
    var day: Int { StatsDates.day(start) }
    func value(_ metric: StatsMetric) -> Double {
        switch metric {
        case .count: 1
        case .distance: (distance ?? 0) / 1000
        case .time: (movingTime ?? 0) / 3600
        case .elevation: elevation ?? 0
        }
    }
}

nonisolated struct StatsTotals: Equatable, Sendable {
    var count = 0.0, distance = 0.0, elevation = 0.0, time = 0.0
    subscript(_ metric: StatsMetric) -> Double {
        get { switch metric { case .count: count; case .distance: distance; case .elevation: elevation; case .time: time } }
        set { switch metric { case .count: count = newValue; case .distance: distance = newValue; case .elevation: elevation = newValue; case .time: time = newValue } }
    }
    mutating func add(_ activity: StatsActivity) {
        for metric in StatsMetric.allCases { self[metric] += activity.value(metric) }
    }
}
nonisolated struct StatsPeriodComparison: Equatable, Sendable {
    let current: Double
    let previous: Double
    /// A zero baseline has no percentage comparison. Preserve raw totals.
    var percentageChange: Double? {
        guard previous != 0 else { return nil }
        let change = (current - previous) / previous * 100
        return change.isFinite ? change : nil
    }
}
nonisolated struct StatsWeek: Equatable, Sendable { let start: Int; let activeDays: Int; let partial: Bool }
nonisolated struct StatsThisWeek: Sendable { let days: [Double?]; let current: Double; let typical: Double }
nonisolated struct StatsPace: Sendable { let current: Double; let perDay: Double; let projected: Double; let lastYear: Double }
nonisolated struct StatsConsistency: Sendable { let activeDaysPerWeek: Double; let currentStreak: Int; let solidWeeks: Int }
nonisolated struct StatsTypicalWeek: Sendable { let totals: StatsTotals; let activeDays: Double }
nonisolated struct StatsShare: Sendable { let sport: ActivityCategory; let share: Double }
nonisolated struct StatsRecord: Sendable { let value: Double; let day: Int; let activityID: Int?; let name: String; let sport: ActivityCategory }
nonisolated struct StatsWeekRecord: Sendable { let value: Double; let weekStart: Int }
nonisolated struct StatsRecords: Sendable { let activities: [StatsMetric: StatsRecord]; let biggestWeek: StatsWeekRecord? }
nonisolated struct StatsBestDays: Sendable { let total: Double; let start: Int; let end: Int; let current: Double; var hasCompleteWindow: Bool { end - start == 29 } }
/// `incomplete`: the current period, or the one in which the history begins partway through.
nonisolated struct StatsHistoryBucket: Sendable { let start: Int; let end: Int; let total: Double; let bySport: [ActivityCategory: Double]; var incomplete = false }
nonisolated struct StatsCalendarMonth: Sendable { let start: Int; let length: Int; let first: Int; let last: Int }
nonisolated struct StatsCalendarDay: Sendable {
    let activities: [StatsActivity]; let dominantSport: ActivityCategory; let mixed: Bool; let totals: StatsTotals
    /// The runner-up sport of a mixed day by moving time, with the dominant sport's tie-break.
    var secondSport: ActivityCategory? {
        let times = activities.reduce(into: [ActivityCategory: Double]()) { $0[$1.sport, default: 0] += $1.value(.time) }
        return times.filter { $0.key != dominantSport }.min { a, b in
            a.value != b.value ? a.value > b.value : ActivityCategory.allCases.firstIndex(of: a.key)! < ActivityCategory.allCases.firstIndex(of: b.key)!
        }?.key
    }
}
nonisolated struct StatsPoint: Sendable { let x: Int; let y: Double }
nonisolated struct StatsHillPoint: Sendable { let activity: StatsActivity; let distance: Double; let elevation: Double; var metersPerKm: Double { elevation / distance } }
nonisolated struct StatsClimbing: Sendable { let current: Double; let previous: Double; let months: [(monthStart: Int, rate: Double)] }
nonisolated enum StatsHistoryRange: String, CaseIterable, Hashable, Sendable { case weeks, months, years }

/// One immutable index per authorized metadata/filter revision. Day and sport
/// aggregates are reused by all metrics/windows. Empty buckets are generated
/// from calendar coordinates, never inferred from the presence of activities.
nonisolated struct StatsEngine: Sendable {
    let activities: [StatsActivity]
    private let orderedActivities: [StatsActivity]
    private let days: [Int: StatsCalendarDay]
    private let orderedDays: [Int]
    private let prefix: [StatsTotals]
    private let sportDays: [Int: [ActivityCategory: StatsTotals]]
    var indexedActivityCount: Int { activities.count }

    init(activities: [StatsActivity]) {
        // Anonymous synthetic rows retain supplied order at identical starts.
        if !activities.isEmpty, Task.isCancelled { self = StatsEngine(activities: []); return }
        let orderedActivities = activities.enumerated().sorted { a, b in
            if a.element.start != b.element.start { return a.element.start < b.element.start }
            if let x = a.element.id, let y = b.element.id { return x < y }
            if a.element.id != nil { return true }
            if b.element.id != nil { return false }
            return a.offset < b.offset
        }.map(\.element)
        var grouped: [Int: [StatsActivity]] = [:]
        for (index, activity) in orderedActivities.enumerated() {
            if index % 1024 == 0, Task.isCancelled {
                self = StatsEngine(activities: [])
                return
            }
            grouped[activity.day, default: []].append(activity)
        }
        var days: [Int: StatsCalendarDay] = [:], sportDays: [Int: [ActivityCategory: StatsTotals]] = [:]
        for (day, rows) in grouped {
            if Task.isCancelled { self = StatsEngine(activities: []); return }
            var totals = StatsTotals(), bySport: [ActivityCategory: StatsTotals] = [:]
            for row in rows { totals.add(row); bySport[row.sport, default: StatsTotals()].add(row) }
            let dominant = ActivityCategory.allCases.filter { bySport[$0] != nil }.max {
                bySport[$0]!.time < bySport[$1]!.time
            }!
            // `max`'s equal behavior is not the sport-order contract.
            let highest = bySport[dominant]!.time
            let first = ActivityCategory.allCases.first { bySport[$0]?.time == highest }!
            days[day] = StatsCalendarDay(activities: rows, dominantSport: first, mixed: bySport.count > 1, totals: totals)
            sportDays[day] = bySport
        }
        self.activities = activities; self.orderedActivities = orderedActivities
        self.days = days; self.sportDays = sportDays
        orderedDays = days.keys.sorted()
        var prefix = [StatsTotals()], total = StatsTotals()
        for day in orderedDays {
            for metric in StatsMetric.allCases { total[metric] += days[day]!.totals[metric] }
            prefix.append(total)
        }
        self.prefix = prefix
    }

    private func lowerBound(_ day: Int) -> Int {
        var low = 0, high = orderedDays.count
        while low < high { let middle = (low + high) / 2; if orderedDays[middle] < day { low = middle + 1 } else { high = middle } }
        return low
    }
    func sum(_ metric: StatsMetric, first: Int, last: Int) -> Double {
        guard first <= last else { return 0 }
        return prefix[lowerBound(last + 1)][metric] - prefix[lowerBound(first)][metric]
    }
    func totals(first: Int, last: Int) -> StatsTotals {
        var totals = StatsTotals()
        for metric in StatsMetric.allCases { totals[metric] = sum(metric, first: first, last: last) }
        return totals
    }
    func totals(today: Int) -> StatsTotals { totals(first: StatsDates.start(year: StatsDates.parts(today).year!), last: today) }
    func yearToDate(today: Int, metric: StatsMetric) -> StatsPeriodComparison {
        let year = StatsDates.parts(today).year!
        return .init(current: sum(metric, first: StatsDates.start(year: year), last: today),
                     previous: sum(metric, first: StatsDates.start(year: year - 1), last: StatsDates.previousYear(today)))
    }
    func monthComparison(today: Int, metric: StatsMetric, offset: Int = 0) -> StatsPeriodComparison {
        let offset = max(0, offset)
        let c = StatsDates.parts(today), first = StatsDates.start(year: c.year!, month: c.month! - max(0, offset))
        let next = StatsDates.start(year: c.year!, month: c.month! - max(0, offset) + 1)
        let previous = StatsDates.start(year: c.year!, month: c.month! - max(0, offset) - 1)
        let last = offset == 0 ? today : next - 1
        let previousLast = offset == 0 ? min(previous + c.day! - 1, first - 1) : first - 1
        return .init(current: sum(metric, first: first, last: last), previous: sum(metric, first: previous, last: previousLast))
    }
    func yearComparison(today: Int, metric: StatsMetric, offset: Int = 0) -> StatsPeriodComparison {
        let offset = max(0, offset)
        if offset == 0 { return yearToDate(today: today, metric: metric) }
        let year = StatsDates.parts(today).year! - max(0, offset), first = StatsDates.start(year: year)
        return .init(current: sum(metric, first: first, last: StatsDates.start(year: year + 1) - 1),
                     previous: sum(metric, first: StatsDates.start(year: year - 1), last: first - 1))
    }
    func fourWeekVolume(today: Int, metric: StatsMetric) -> StatsPeriodComparison {
        .init(current: sum(metric, first: today - 27, last: today), previous: sum(metric, first: today - 55, last: today - 28))
    }
    func thisWeek(today: Int, metric: StatsMetric) -> StatsThisWeek {
        let monday = StatsDates.monday(today), weekday = today - monday
        let values: [Double?] = (0..<7).map { $0 <= weekday ? (days[monday + $0]?.totals[metric] ?? 0) : nil }
        let typical = (1...11).reduce(0.0) { $0 + sum(metric, first: monday - $1 * 7, last: monday - $1 * 7 + weekday) } / 11
        return .init(days: values, current: values.compactMap { $0 }.reduce(0, +), typical: typical)
    }
    func weeklyVolume(today: Int, metric: StatsMetric, weeks: Int = 12) -> (weekStarts: [Int], values: [Double]) {
        let starts = (0..<max(1, weeks)).map { StatsDates.monday(today) + ($0 - max(1, weeks) + 1) * 7 }
        return (starts, starts.map { sum(metric, first: $0, last: min($0 + 6, today)) })
    }
    func weeklyActiveDays(today: Int, weeks: Int = 12) -> [StatsWeek] {
        let monday = StatsDates.monday(today)
        return (0..<max(2, weeks)).map { index in
            let start = monday + (index - max(2, weeks) + 1) * 7
            return .init(start: start, activeDays: (start...min(start + 6, today)).filter { days[$0] != nil }.count, partial: start == monday)
        }
    }
    func consistency(today: Int, weeks: Int = 12) -> StatsConsistency {
        let full = weeklyActiveDays(today: today, weeks: weeks).dropLast()
        var day = days[today] == nil ? today - 1 : today, streak = 0
        while days[day] != nil { streak += 1; day -= 1 }
        return .init(activeDaysPerWeek: Double(full.reduce(0) { $0 + $1.activeDays }) / Double(full.count), currentStreak: streak,
                     solidWeeks: full.filter { $0.activeDays >= 5 }.count)
    }
    func typicalWeek(today: Int) -> StatsTypicalWeek {
        let monday = StatsDates.monday(today), first = monday - 77
        var totals = totals(first: first, last: monday - 1)
        for metric in StatsMetric.allCases { totals[metric] /= 11 }
        return .init(totals: totals, activeDays: Double(lowerBound(monday) - lowerBound(first)) / 11)
    }
    func yearPace(today: Int, metric: StatsMetric) -> StatsPace {
        let year = StatsDates.parts(today).year!, first = StatsDates.start(year: year)
        let current = sum(metric, first: first, last: today), perDay = current / Double(today - first + 1)
        return .init(current: current, perDay: perDay, projected: perDay * Double(StatsDates.start(year: year + 1) - first),
                     lastYear: sum(metric, first: StatsDates.start(year: year - 1), last: first - 1))
    }
    func sportBreakdown(first: Int, last: Int) -> [ActivityCategory: StatsTotals] {
        var result: [ActivityCategory: StatsTotals] = [:]
        guard first <= last else { return result }
        for day in orderedDays[lowerBound(first)..<lowerBound(last + 1)] {
            for (sport, totals) in sportDays[day]! {
                for metric in StatsMetric.allCases { result[sport, default: StatsTotals()][metric] += totals[metric] }
            }
        }
        return result
    }
    func sportMix(today: Int, range: StatsWindow = .currentYear) -> [StatsShare] {
        let first = range == .allTime ? (orderedDays.first ?? today) : StatsDates.start(year: StatsDates.parts(today).year!)
        let values = sportBreakdown(first: first, last: today), total = values.values.reduce(0) { $0 + $1.time }
        guard total > 0 else { return [] }
        return ActivityCategory.allCases.compactMap { sport in
            let time = values[sport]?.time ?? 0
            return time > 0 ? StatsShare(sport: sport, share: time / total) : nil
        }.enumerated().sorted { a, b in a.element.share == b.element.share ? a.offset < b.offset : a.element.share > b.element.share }.map(\.element)
    }
    func records(today: Int, range: StatsWindow = .currentYear) -> StatsRecords {
        let first = range == .allTime ? (orderedDays.first ?? today) : StatsDates.start(year: StatsDates.parts(today).year!)
        var records: [StatsMetric: StatsRecord] = [:], weeks: [Int: Double] = [:]
        for activity in orderedActivities where activity.day >= first && activity.day <= today {
            for metric in [StatsMetric.distance, .time, .elevation] {
                let value = activity.value(metric)
                if value > (records[metric]?.value ?? 0) {
                    records[metric] = .init(value: value, day: activity.day, activityID: activity.id, name: activity.name, sport: activity.sport)
                }
            }
            weeks[StatsDates.monday(activity.day), default: 0] += activity.value(.distance)
        }
        var biggest: StatsWeekRecord?
        for start in weeks.keys.sorted() where weeks[start]! > (biggest?.value ?? 0) { biggest = .init(value: weeks[start]!, weekStart: start) }
        return .init(activities: records, biggestWeek: biggest)
    }
    func best30Days(today: Int, metric: StatsMetric) -> StatsBestDays {
        let first = StatsDates.start(year: StatsDates.parts(today).year!)
        var start = first, end = min(first + 29, today), best = sum(metric, first: first, last: min(first + 29, today))
        if first + 30 <= today {
            for candidate in (first + 1)...(today - 29) {
                let value = sum(metric, first: candidate, last: candidate + 29)
                if value > best { start = candidate; end = candidate + 29; best = value }
            }
        }
        return .init(total: best, start: start, end: end, current: sum(metric, first: today - 29, last: today))
    }
    func activeDayFlags(today: Int, count: Int) -> [Bool] { (0..<max(0, count)).map { days[today - count + 1 + $0] != nil } }
    func restDays(today: Int) -> (last30: Int, last90: Int) {
        (activeDayFlags(today: today, count: 30).filter { !$0 }.count, activeDayFlags(today: today, count: 90).filter { !$0 }.count)
    }
    func calendarDays(first: Int, last: Int) -> [Int: StatsCalendarDay] { days.filter { first <= $0.key && $0.key <= last } }
    func activityCalendar(today: Int) -> [Int: StatsCalendarDay] { calendarDays(first: StatsDates.previousYear(today), last: today) }
    func calendarMonths(today: Int, first: Int? = nil) -> [StatsCalendarMonth] {
        let first = first ?? StatsDates.previousYear(today)
        guard first <= today else { return [] }
        let a = StatsDates.parts(first), b = StatsDates.parts(today), count = (b.year! - a.year!) * 12 + b.month! - a.month! + 1
        return (0..<count).map { index in
            let start = StatsDates.start(year: a.year!, month: a.month! + index), next = StatsDates.start(year: a.year!, month: a.month! + index + 1)
            return .init(start: start, length: next - start, first: max(first, start), last: min(today, next - 1))
        }
    }
    func cumulativeByDay(metric: StatsMetric, first: Int, last: Int) -> [Double] {
        guard first <= last else { return [] }
        var total = 0.0
        return (first...last).map { total += days[$0]?.totals[metric] ?? 0; return total }
    }
    func cumulativeYearPoints(metric: StatsMetric, year: Int, last: Int) -> [StatsPoint] {
        let first = StatsDates.start(year: year), reference = StatsDates.start(year: 2000)
        return cumulativeByDay(metric: metric, first: first, last: last).enumerated().map { index, value in
            let c = StatsDates.parts(first + index)
            return .init(x: StatsDates.start(year: 2000, month: c.month!, date: c.day!) - reference, y: value)
        }
    }
    func volumeHistory(today: Int, metric: StatsMetric, range: StatsHistoryRange, page: Int = 0, leadingPeriods: Int = 0) -> [StatsHistoryBucket] {
        let c = StatsDates.parts(today), firstYear = StatsDates.parts(min(orderedDays.first ?? today, today)).year!
        let leading = max(0, leadingPeriods)
        let count = (range == .years ? c.year! - firstYear + 1 : 12) + leading, offset = max(0, page) * 12
        let starts = (0...count).map { index in
            switch range {
            case .weeks: StatsDates.monday(today) + (index - 11 - offset - leading) * 7
            case .months: StatsDates.start(year: c.year!, month: c.month! + index - 11 - offset - leading)
            case .years: StatsDates.start(year: firstYear + index - leading)
            }
        }
        let firstDay = min(orderedDays.first ?? today, today)
        return (0..<count).map { index in
            let start = starts[index], next = starts[index + 1], end = min(today, next - 1), split = sportBreakdown(first: start, last: end)
            return .init(start: start, end: end, total: sum(metric, first: start, last: end),
                         bySport: Dictionary(uniqueKeysWithValues: ActivityCategory.allCases.map { ($0, split[$0]?[metric] ?? 0) }),
                         incomplete: today < next || (firstDay > start && firstDay < next))
        }
    }
    func volumeHistoryAverage(today: Int, metric: StatsMetric, range: StatsHistoryRange) -> [StatsPoint] {
        let history = volumeHistory(today: today, metric: metric, range: range, leadingPeriods: 4)
        guard let firstKnownDay = orderedDays.first, firstKnownDay <= today else { return [] }
        return (4..<history.count).compactMap { index in
            let end = index == history.count - 1 ? index - 1 : index
            let window = history[(end - 3)...end]
            guard window.first!.end >= firstKnownDay else { return nil }
            return .init(x: history[index].start, y: window.reduce(0) { $0 + $1.total } / 4)
        }
    }
    func hillPoints(first: Int, last: Int) -> [StatsHillPoint] {
        activities.compactMap { row in
            let distance = row.value(.distance)
            return row.day >= first && row.day <= last && distance > 0 ? .init(activity: row, distance: distance, elevation: row.value(.elevation)) : nil
        }
    }
    private func climbRate(first: Int, last: Int) -> Double {
        let points = hillPoints(first: first, last: last), distance = points.reduce(0) { $0 + $1.distance }
        return distance > 0 ? points.reduce(0) { $0 + $1.elevation } / distance * 100 : 0
    }
    func climbing(today: Int) -> StatsClimbing {
        let first = StatsDates.previousYear(today), c = StatsDates.parts(today)
        return .init(current: climbRate(first: first, last: today), previous: climbRate(first: StatsDates.previousYear(first), last: first - 1),
                     months: (0..<12).map { index in
            let start = StatsDates.start(year: c.year!, month: c.month! - 11 + index)
            return (start, climbRate(first: start, last: min(today, StatsDates.start(year: c.year!, month: c.month! - 10 + index) - 1)))
        })
    }
    func hilliestActivities(today: Int) -> [StatsHillPoint] {
        hillPoints(first: StatsDates.previousYear(today), last: today).filter { $0.distance >= 5 }
            .enumerated().sorted { a, b in a.element.metersPerKm == b.element.metersPerKm ? a.offset < b.offset : a.element.metersPerKm > b.element.metersPerKm }
            .prefix(5).map(\.element)
    }
}

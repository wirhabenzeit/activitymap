import Foundation
import Observation

/// The visible capability set differs from the generated declaration catalogue.
/// Compound tile queries occupy one bounded controller-cache entry per tile.
enum StatsDashboard {
    static let ids: [StatsTileID] = [.thisWeek, .monthVsLastMonth, .weeklyVolume,
        .yearToDate, .yearPace, .records, .activityCalendar,
        .sportMix, .distanceVsElevation, .typicalWeek]
    static let tiles = ids.compactMap { id in SharedStatsTiles.tiles.first { $0.id == id } }
    static func expandable(_ id: StatsTileID) -> Bool {
        ids.contains(id) && ![.thisWeek, .yearPace, .typicalWeek].contains(id)
    }
    static func defaultOption(_ id: StatsTileID) -> StatsToggleOption? {
        tiles.first { $0.id == id }?.toggle?.options.first
    }
}

nonisolated enum StatsDashboardResult: Sendable {
    case week(StatsThisWeek)
    case volume(StatsPeriodComparison, starts: [Int], values: [Double], averages: [StatsHistoryRange: [StatsPoint]], buckets: [StatsHistoryRange: [StatsHistoryBucket]])
    case comparison(StatsPeriodComparison, current: [StatsPoint], previous: [StatsPoint], band: StatsComparisonBand?, rhythm: StatsComparisonRhythm, history: [StatsPeriodHistoryComparison])
    case pace(StatsPace)
    case records(StatsRecords, allTime: StatsRecords, best30: [StatsMetric: StatsBestDays])
    case calendar(rolling: StatsCalendarSnapshot, years: [Int: StatsCalendarSnapshot])
    case mix([StatsShare], hours: Double, breakdown: [ActivityCategory: StatsTotals])
    case hilliness(StatsClimbing, activities: [StatsHillPoint])
    case typical(StatsTypicalWeek)
    case unsupported
}

nonisolated struct StatsCalendarSnapshot: Sendable {
    let days: [Int: StatsCalendarDay]
    let months: [StatsCalendarMonth]
}

nonisolated struct StatsComparisonBand: Sendable {
    struct Point: Identifiable, Sendable {
        let x: Int
        let low: Double
        let high: Double
        let count: Int
        var id: Int { x }
    }
    let monthly: Bool
    let count: Int
    let first: Int
    let last: Int
    let points: [Point]
    /// Plain wording on the face; inspection and accessibility give the exact definition.
    var label: String { monthly ? "Shaded: typical range of \(count) past months" : "Shaded: range of \(count) past years" }
}

nonisolated extension StatsEngine {
    func comparisonBand(today: Int, metric: StatsMetric, monthly: Bool) -> StatsComparisonBand? {
        guard let earliest = activities.map(\.day).min(), earliest < today else { return nil }
        func startOf(_ day: Int) -> Int {
            let c = StatsDates.parts(day)
            return StatsDates.start(year: c.year!, month: monthly ? c.month! : 1)
        }
        func next(_ day: Int) -> Int {
            let c = StatsDates.parts(day)
            return monthly ? StatsDates.start(year: c.year!, month: c.month! + 1) : StatsDates.start(year: c.year! + 1)
        }
        let first = earliest == startOf(earliest) ? earliest : next(startOf(earliest))
        let end = startOf(today)
        guard first < end else { return nil }
        var samples: [Int: [Double]] = [:], start = first, count = 0
        while start < end {
            count += 1
            let limit = next(start)
            let cumulative = cumulativeByDay(metric: metric, first: start, last: limit - 1)
            if monthly {
                samples[0, default: []].append(0)
                // Shorter months retain their final total through day 31.
                for x in 1...31 { samples[x, default: []].append(cumulative[min(x, cumulative.count) - 1]) }
            } else {
                let year = StatsDates.parts(start).year!
                for x in 0..<366 {
                    let c = StatsDates.parts(StatsDates.start(year: 2000) + x), month = c.month!
                    let length = StatsDates.start(year: year, month: month + 1) - StatsDates.start(year: year, month: month)
                    // Match Feb 29 to Feb 28 in non-leap years, as in same-date comparisons.
                    let day = StatsDates.start(year: year, month: month, date: min(c.day!, length))
                    samples[x, default: []].append(cumulative[day - start])
                }
            }
            start = limit
        }
        guard count >= 2 else { return nil }
        func quantile(_ sorted: [Double], _ p: Double) -> Double {
            let index = Double(sorted.count - 1) * p, lower = Int(floor(index)), upper = Int(ceil(index))
            return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - Double(lower))
        }
        let points: [StatsComparisonBand.Point] = samples.keys.sorted().compactMap { x in
            let values = samples[x]!.sorted()
            guard values.count >= 2 else { return nil }
            return .init(x: x, low: quantile(values, monthly ? 0.05 : 0), high: quantile(values, monthly ? 0.95 : 1), count: values.count)
        }
        return .init(monthly: monthly, count: count, first: first, last: end - 1, points: points)
    }

    func dashboard(_ tile: StatsTileID, option: StatsToggleOption?, today: Int) -> StatsDashboardResult {
        let metric = option.flatMap { StatsMetric(rawValue: $0.rawValue) } ?? .distance
        let date = StatsDates.parts(today), year = date.year!, month = date.month!
        switch tile {
        case .thisWeek: return .week(thisWeek(today: today, metric: metric))
        case .weeklyVolume:
            let series = weeklyVolume(today: today, metric: metric)
            let averages = Dictionary(uniqueKeysWithValues: StatsHistoryRange.allCases.map {
                ($0, volumeHistoryAverage(today: today, metric: metric, range: $0))
            })
            return .volume(fourWeekVolume(today: today, metric: metric), starts: series.weekStarts,
                           values: series.values, averages: averages,
                           buckets: Dictionary(uniqueKeysWithValues: StatsHistoryRange.allCases.map {
                               ($0, volumeHistory(today: today, metric: metric, range: $0))
                           }))
        case .monthVsLastMonth:
            let first = StatsDates.start(year: year, month: month)
            let previous = StatsDates.start(year: year, month: month - 1)
            func points(_ first: Int, _ last: Int) -> [StatsPoint] {
                [.init(x: 0, y: 0)] + cumulativeByDay(metric: metric, first: first, last: last)
                    .enumerated().map { .init(x: $0.offset + 1, y: $0.element) }
            }
            return .comparison(monthComparison(today: today, metric: metric),
                               current: points(first, today), previous: points(previous, first - 1), band: comparisonBand(today: today, metric: metric, monthly: true),
                               rhythm: .month(monthActivityRhythm(today: today, metric: metric)),
                               history: periodComparisons(today: today, metric: metric, range: .months))
        case .yearToDate:
            return .comparison(yearToDate(today: today, metric: metric),
                current: cumulativeYearPoints(metric: metric, year: year, last: today),
                previous: cumulativeYearPoints(metric: metric, year: year - 1, last: StatsDates.start(year: year) - 1), band: comparisonBand(today: today, metric: metric, monthly: false),
                rhythm: .year(yearMonthlyRhythm(today: today, metric: metric)),
                history: periodComparisons(today: today, metric: metric, range: .years))
        case .yearPace: return .pace(yearPace(today: today, metric: metric))
        case .records: return .records(records(today: today), allTime: records(today: today, range: .allTime),
            best30: Dictionary(uniqueKeysWithValues: [StatsMetric.distance, .time, .elevation].map { ($0, best30Days(today: today, metric: $0)) }))
        case .activityCalendar:
            let firstYear = StatsDates.parts(min(today, activities.map(\.day).min() ?? today)).year!
            let years = Dictionary(uniqueKeysWithValues: (firstYear...year).map { value in
                let first = StatsDates.start(year: value), last = min(today, StatsDates.start(year: value + 1) - 1)
                return (value, StatsCalendarSnapshot(days: calendarDays(first: first, last: last), months: calendarMonths(today: last, first: first)))
            })
            return .calendar(rolling: .init(days: activityCalendar(today: today), months: calendarMonths(today: today)), years: years)
        case .sportMix:
            let range: StatsWindow = option == .allTime ? .allTime : .currentYear
            let first = range == .allTime ? activities.map(\.day).min() ?? today : StatsDates.start(year: year)
            return .mix(sportMix(today: today, range: range), hours: sum(.time, first: first, last: today), breakdown: sportBreakdown(first: first, last: today))
        case .distanceVsElevation: return .hilliness(climbing(today: today), activities: hilliestActivities(today: today))
        case .typicalWeek: return .typical(typicalWeek(today: today))
        case .totals, .best30Days, .restDays, .consistency, .speedTrend: return .unsupported
        }
    }
}

/// Every published face is tagged with its scope and exact choice. Filtering,
/// sign-out or a day rollover cannot briefly display the previous scope's values.
struct StatsDashboardSource: Equatable {
    let scope: Int
    let revision: Int
    let filters: StatsFilterScope
    let today: Int
    init(_ store: ActivityStore) {
        scope = store.mapContext.scopeRevision; revision = store.activitiesRevision
        filters = StatsFilterScope(store); today = store.stats.reportingDay
    }
}
struct StatsDashboardRequest: Equatable {
    let source: StatsDashboardSource
    let choices: [StatsTileID: StatsToggleOption]
    let canLoad: Bool
}

/// Keep values and their units/period together while a new choice calculates.
struct StatsDashboardFace {
    let option: StatsToggleOption?
    let result: StatsDashboardResult
}

/// Inspection choices outlive a detail destination and are shared with its source tile.
@MainActor @Observable final class StatsTileInspection {
    var volumeRange = StatsHistoryRange.weeks
    var calendarYear: Int?
    var calendarDay: Int?
    var monthDay: Int?
    var recordsRange = StatsToggleOption.currentYear
}

@MainActor @Observable final class StatsDashboardState {
    private var inspections = Dictionary(uniqueKeysWithValues: StatsDashboard.ids.map { ($0, StatsTileInspection()) })
    func inspection(_ id: StatsTileID) -> StatsTileInspection? { inspections[id] }
    var inspectedActivityID: Int?
    func resetInspection() {
        inspectedActivityID = nil
        expandedTile = nil
        inspections = Dictionary(uniqueKeysWithValues: StatsDashboard.ids.map { ($0, StatsTileInspection()) })
    }
    var choices: [StatsTileID: StatsToggleOption] = [:]
    var expandedTile: StatsTileID?
    private(set) var completedTiles: Set<StatsTileID> = []
    private struct Entry {
        let source: StatsDashboardSource
        let option: StatsToggleOption?
        let result: StatsDashboardResult
    }
    private var entries: [StatsTileID: Entry] = [:]
    func option(_ id: StatsTileID) -> StatsToggleOption? { choices[id] ?? StatsDashboard.defaultOption(id) }
    func select(_ option: StatsToggleOption, for tile: StatsTileDefinition) {
        guard tile.toggle?.options.contains(option) == true else { return }
        choices[tile.id] = option
    }
    func toggleExpansion(_ id: StatsTileID) {
        guard StatsDashboard.expandable(id) else { return }
        expandedTile = expandedTile == id ? nil : id
    }
    func result(_ id: StatsTileID, source: StatsDashboardSource) -> StatsDashboardResult? {
        guard let entry = entries[id], entry.source == source, entry.option == option(id) else { return nil }
        return entry.result
    }
    func face(_ id: StatsTileID, source: StatsDashboardSource) -> StatsDashboardFace? {
        // Retain only within the exact source. Filters, revisions and account
        // changes must still hide obsolete values immediately.
        guard let entry = entries[id], entry.source == source else { return nil }
        return StatsDashboardFace(option: entry.option, result: entry.result)
    }
    func load(store: ActivityStore, request: StatsDashboardRequest) async {
        guard request.canLoad else { return }
        for id in StatsDashboard.ids {
            guard !Task.isCancelled, StatsDashboardSource(store) == request.source, choices == request.choices else { return }
            if result(id, source: request.source) != nil { continue }
            let option = option(id)
            guard case .dashboard(let result) = await store.stats.result(.dashboard(id, option), for: store),
                  !Task.isCancelled, StatsDashboardSource(store) == request.source, choices == request.choices else { return }
            entries[id] = Entry(source: request.source, option: option, result: result)
            completedTiles.insert(id)
        }
    }
}

/// Calendar coordinates are wall-clock dates; never format them in the viewer's timezone.
enum StatsDisplay {
    static func dailyRate(_ value: Double) -> String {
        if value != 0 && abs(value) < 1 {
            return value.formatted(.number.precision(.significantDigits(1...2)))
        }
        return number(value, decimals: 1)
    }
    /// Explicit ticks let labels use the actual interval after unit conversion.
    static func axisTicks(maximum: Double, count: Int = 3) -> [Double] {
        guard maximum.isFinite, maximum > 0, count > 0 else { return [0] }
        let raw = maximum / Double(count)
        let power = pow(10, floor(log10(raw)))
        let error = raw / power
        let factor = error >= sqrt(50) ? 10.0 : error >= sqrt(10) ? 5.0 : error >= sqrt(2) ? 2.0 : 1.0
        let step = factor * power
        return (0...Int(floor(maximum / step))).map { Double($0) * step }
    }
    static func compactAxis(_ value: Double, step: Double, locale: Locale = .current) -> String {
        let scale = abs(value) >= 1000 ? 1000.0 : 1.0
        let interval = abs(step) / scale
        let decimals = interval.isFinite && interval > 0 ? min(12, max(0, Int(ceil(-log10(interval))))) : 0
        let scaled = value / scale
        let rounded = (scaled * pow(10, Double(decimals))).rounded(.toNearestOrEven)
        let text = (rounded == 0 ? 0 : scaled).formatted(.number.precision(.fractionLength(0...decimals)).locale(locale))
        return text + (scale == 1000 ? "k" : "")
    }
    static func number(_ value: Double, decimals: Int = 0) -> String {
        value.formatted(.number.precision(.fractionLength(decimals)))
    }
    static func value(_ value: Double, metric: StatsMetric) -> String {
        number(metric.displayValue(value), decimals: metric == .time && abs(value) < 10 ? 1 : 0)
    }
    static func measurement(_ value: Double, metric: StatsMetric) -> String {
        "\(self.value(value, metric: metric)) \(metric == .count ? "activities" : metric.displayUnit)"
    }
    static func weekday(_ day: Int) -> String {
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day - StatsDates.monday(day)]
    }
    static func date(_ day: Int) -> String {
        Formatters.shortDate(StatsDates.date(day), timeZone: .gmt)
    }
    /// Day and month without the year, e.g. "28 Sep".
    static func shortDate(_ day: Int) -> String {
        StatsDates.date(day).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated).day())
    }
    /// A whole month, e.g. "Oct 2026", for monthly bars and readouts.
    static func month(_ day: Int) -> String {
        StatsDates.date(day).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated).year())
    }
    static func option(_ option: StatsToggleOption) -> String {
        switch option {
        case .distance: "Distance"
        case .time: "Moving time"
        case .elevation: "Elevation"
        case .count: "Activities"
        case .sport: "Sport"
        case .last12Weeks: "12 weeks"
        case .last52Weeks: "52 weeks"
        case .currentYear: "This year"
        case .allTime: "All time"
        default: option.rawValue
        }
    }
}

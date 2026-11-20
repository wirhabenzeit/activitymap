import SwiftUI

/// Expanded Stats pages. Each one connects a headline, a chart of selectable
/// periods, the activities in the selected period and an optional data table,
/// as the web's explorers do. Selections live in `StatsTileInspection`, so they
/// survive opening an activity and returning.

private let referenceYear = 2000

private func valueText(_ value: Double, metric: StatsMetric, units: UnitSystem, locale: Locale) -> String {
    StatsDisplay.measurement(value, metric: metric, units: units, locale: locale)
}

/// Chart axis labels use the display unit and the tick interval in that unit.
private func axisText(_ value: Double, step: Double, metric: StatsMetric, units: UnitSystem, locale: Locale) -> String {
    StatsDisplay.compactAxis(metric.displayValue(value, units: units), step: metric.displayValue(step, units: units), locale: locale)
}

private extension StatsMetric {
    /// The headline's number and unit, split so the unit can be set small.
    func headline(_ value: Double, units: UnitSystem, locale: Locale) -> (value: String, unit: String) {
        (StatsDisplay.value(value, metric: self, units: units, locale: locale),
         self == .count ? "activities" : displayUnit(units: units))
    }
}

// MARK: - Volume

struct StatsVolumeExplorer: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    @Environment(\.statsTileInspection) private var inspection
    let history: [StatsHistoryRange: [StatsHistoryBucket]]
    let averages: [StatsHistoryRange: [StatsPoint]]
    let activities: [StatsActivity]
    let metric: StatsMetric
    @Binding var range: StatsHistoryRange
    let openActivity: (Int) -> Void
    @State private var localPeriod: Int?

    private var saved: Int? {
        get { if let inspection { return inspection.volumePeriod } else { return localPeriod } }
        nonmutating set { if let inspection { inspection.volumePeriod = newValue } else { localPeriod = newValue } }
    }
    private var buckets: [StatsHistoryBucket] { history[range] ?? [] }
    private var selectedIndex: Int? {
        guard !buckets.isEmpty else { return nil }
        return buckets.firstIndex { $0.start == saved } ?? buckets.count - 1
    }
    private var sports: [ActivityCategory] {
        ActivityCategory.allCases.filter { sport in buckets.contains { ($0.bySport[sport] ?? 0) > 0 } }
    }
    private var averageLabel: String { "4-\(range.period) average" }

    private func label(_ bucket: StatsHistoryBucket) -> String {
        switch range {
        case .weeks: "Week of \(StatsDisplay.shortDate(bucket.start, locale: locale))"
        case .months: StatsDisplay.month(bucket.start, locale: locale)
        case .years: String(StatsDates.parts(bucket.start).year!)
        }
    }
    private func tick(_ bucket: StatsHistoryBucket) -> String {
        switch range {
        case .weeks: StatsDisplay.shortDate(bucket.start, locale: locale)
        case .months: StatsDates.date(bucket.start).formatted(Date.FormatStyle(locale: locale, calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated))
        case .years: String(StatsDates.parts(bucket.start).year!)
        }
    }
    private func total(_ bucket: StatsHistoryBucket) -> String { valueText(bucket.total, metric: metric, units: units, locale: locale) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let selectedIndex, let first = buckets.first, let last = buckets.last {
                let bucket = buckets[selectedIndex]
                let headline = metric.headline(buckets.reduce(0) { $0 + $1.total }, units: units, locale: locale)
                let format = preferences?.dateFormat ?? .system
                StatsExplorerHeadline(value: headline.value, unit: headline.unit,
                                      caption: "\(range == .years ? "over your recorded years" : "over 12 \(range.rawValue)") · \(StatsDisplay.date(first.start, locale: locale, dateFormat: format)) – \(StatsDisplay.date(last.end, locale: locale, dateFormat: format))")
                StatsRangePicker(title: "Volume grouping", ranges: StatsHistoryRange.allCases, selection: $range, label: \.label)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Volume by \(range.period)").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    chart(selectedIndex)
                    StatsSportLegend(categories: sports)
                    if !(averages[range] ?? []).isEmpty {
                        Text("Dashed: \(averageLabel)").font(.caption).foregroundStyle(.secondary)
                    }
                    Text("Faded bars show incomplete periods. The average uses completed periods.").font(.caption).foregroundStyle(.secondary)
                }
                StatsExplorerActivities(
                    heading: "\(label(bucket)) · \(total(bucket)) · \(inPeriod(bucket).count) \(inPeriod(bucket).count == 1 ? "activity" : "activities")",
                    activities: inPeriod(bucket), metric: metric, identifierPrefix: "stats-volume-activity-", openActivity: openActivity,
                    step: { offset in saved = buckets[min(max(0, selectedIndex + offset), buckets.count - 1)].start },
                    canStep: (selectedIndex > 0, selectedIndex < buckets.count - 1))
                StatsExplorerData { table }
            }
        }
        .onChange(of: range) { saved = nil }
    }

    private func inPeriod(_ bucket: StatsHistoryBucket) -> [StatsActivity] {
        activities.filter { $0.day >= bucket.start && $0.day <= bucket.end }
    }

    private func chart(_ selectedIndex: Int) -> some View {
        let count = buckets.count
        let stride = max(1, Int((Double(count) / 4).rounded(.up)))
        let ticks = buckets.indices.filter { $0 % stride == 0 }.map { StatsExplorerTick(x: Double($0) + 0.5, label: tick(buckets[$0])) }
        let trend = (averages[range] ?? []).compactMap { point in
            buckets.firstIndex { $0.start == point.x }.map { (x: Double($0) + 0.5, y: point.y) }
        }
        return StatsExplorerChart(
            columns: buckets.enumerated().map { index, bucket in
                .init(key: bucket.start, label: label(bucket), tickLabel: tick(bucket), x1: Double(index) + 0.1, x2: Double(index) + 0.9,
                      values: bucket.bySport, incomplete: bucket.incomplete)
            },
            domain: 0...Double(count), ticks: ticks, selected: buckets[selectedIndex].start,
            select: { saved = $0 }, trend: trend,
            formatValue: { valueText($0, metric: metric, units: units, locale: locale) },
            formatAxis: { axisText($0, step: $1, metric: metric, units: units, locale: locale) })
            .accessibilityIdentifier("stats-volume-chart")
    }

    private var table: some View {
        StatsExplorerTable(title: "Period totals", headers: [range.period.capitalized] + sports.map(\.name) + ["Total"],
                           rows: Array(buckets.reversed()), note: "Select a period to see its activities.") { bucket in
            Button { saved = bucket.start } label: {
                Text("\(range == .weeks ? StatsDisplay.date(bucket.start, locale: locale, dateFormat: preferences?.dateFormat ?? .system) : label(bucket))\(bucket.incomplete ? " · incomplete" : "")")
                    .frame(minHeight: 32, alignment: .leading)
            }
            .buttonStyle(.plain).foregroundStyle(bucket.start == buckets[selectedIndex ?? 0].start ? AppTheme.accent : .primary)
            .accessibilityAddTraits(bucket.start == buckets[selectedIndex ?? 0].start ? .isSelected : [])
            ForEach(sports) { sport in
                Text(valueText(bucket.bySport[sport] ?? 0, metric: metric, units: units, locale: locale))
                    .accessibilityLabel("\(sport.name), \(label(bucket))")
            }
            Text(total(bucket)).fontWeight(.semibold)
        }
    }
}

extension StatsHistoryBucket: Identifiable { var id: Int { start } }

// MARK: - Month

struct StatsMonthExplorerView: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    @Environment(\.statsTileInspection) private var inspection
    @AppStorage("stats.month-typical-range") private var showRange = true
    let explorer: StatsMonthExplorer
    let metric: StatsMetric
    let today: Int
    let openActivity: (Int) -> Void
    @State private var localDay: Int?
    @State private var localComparison: Int?

    private var savedDay: Int? {
        get { if let inspection { return inspection.monthDay } else { return localDay } }
        nonmutating set { if let inspection { inspection.monthDay = newValue } else { localDay = newValue } }
    }
    private var savedComparison: Int? {
        get { if let inspection { return inspection.monthComparison } else { return localComparison } }
        nonmutating set { if let inspection { inspection.monthComparison = newValue } else { localComparison = newValue } }
    }
    private var days: [StatsMonthRhythmDay] { explorer.rhythm.days }
    private var current: StatsPeriodHistoryComparison { explorer.rows[0] }
    private var comparison: StatsPeriodHistoryComparison {
        explorer.rows.dropFirst().first { $0.start == savedComparison } ?? explorer.rows[1]
    }
    private var selectedDay: StatsMonthRhythmDay {
        if let day = days.first(where: { $0.day == savedDay && $0.day <= today }) { return day }
        return days.last { !$0.activities.isEmpty && $0.day <= today } ?? days.first { $0.day == today } ?? days[0]
    }
    private var sports: [ActivityCategory] {
        ActivityCategory.allCases.filter { sport in days.contains { ($0.bySport[sport] ?? 0) > 0 } }
    }
    private func longMonth(_ day: Int) -> String {
        StatsDates.date(day).formatted(Date.FormatStyle(locale: locale, calendar: StatsDates.calendar, timeZone: .gmt).month(.wide).year())
    }
    private func monthName(_ day: Int) -> String {
        StatsDates.date(day).formatted(Date.FormatStyle(locale: locale, calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated))
    }
    private func measure(_ value: Double) -> String { valueText(value, metric: metric, units: units, locale: locale) }
    private var sentence: String {
        let name = StatsDates.date(comparison.start).formatted(Date.FormatStyle(locale: locale, calendar: StatsDates.calendar, timeZone: .gmt).month(.wide))
        let difference = current.elapsed - comparison.elapsed
        let formatted = measure(abs(difference))
        if difference == 0 { return "Level with \(name) at this point." }
        if StatsDisplay.value(abs(difference), metric: metric, units: units, locale: locale).allSatisfy({ "0.,\u{a0} ".contains($0) }) {
            return "About level with \(name) at this point."
        }
        return "\(formatted) \(difference > 0 ? "ahead of" : "behind") \(name) at this point."
    }
    private var rangeExplanation: String {
        guard let band = explorer.band else { return "Historical range needs at least two completed months of activity history." }
        let format = preferences?.dateFormat ?? .system
        return "The 5th–95th percentile of cumulative totals at each day of the month, based on \(band.count) completed months from \(StatsDisplay.date(band.first, locale: locale, dateFormat: format)) to \(StatsDisplay.date(band.last, locale: locale, dateFormat: format)). The band shows those past months through the end of the month, including days beyond \(StatsDisplay.shortDate(today, locale: locale)); it is historical context, not a forecast. The current month and partial opening month are excluded. Uses your activity filters."
    }

    var body: some View {
        let headline = metric.headline(current.elapsed, units: units, locale: locale)
        let day = selectedDay
        VStack(alignment: .leading, spacing: 16) {
            StatsExplorerHeadline(value: headline.value, unit: headline.unit,
                                  caption: "\(longMonth(current.start)) · through \(StatsDisplay.shortDate(today, locale: locale))", note: sentence)
            controls
            VStack(alignment: .leading, spacing: 8) {
                chart(day)
                StatsSportLegend(categories: sports)
            }
            StatsExplorerActivities(
                heading: "\(StatsDisplay.shortDate(day.day, locale: locale)) · \(measure(day.bySport.values.reduce(0, +))) · \(day.activities.count) \(day.activities.count == 1 ? "activity" : "activities")",
                activities: day.activities, metric: metric, identifierPrefix: "stats-month-activity-", openActivity: openActivity,
                emptyText: "No matching activities on this day.",
                step: { offset in
                    let reachable = days.filter { $0.day <= today }
                    if let index = reachable.firstIndex(where: { $0.day == day.day }) {
                        savedDay = reachable[min(max(0, index + offset), reachable.count - 1)].day
                    }
                },
                canStep: (day.day > (days.first?.day ?? day.day), day.day < min(today, days.last?.day ?? day.day)))
            StatsExplorerData { table }
        }
    }

    private var controls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { comparisonPicker; Spacer(minLength: 0); StatsHistoricalRangeControl(isOn: $showRange, explanation: rangeExplanation) }
            VStack(alignment: .leading, spacing: 0) { comparisonPicker; StatsHistoricalRangeControl(isOn: $showRange, explanation: rangeExplanation) }
        }
    }
    private var comparisonPicker: some View {
        StatsComparisonPicker(title: "Comparison month",
                              options: explorer.rows.dropFirst().map { ($0.start, longMonth($0.start)) },
                              selection: Binding(get: { comparison.start }, set: { savedComparison = $0 }),
                              identifier: "stats-month-comparison")
    }

    private func chart(_ day: StatsMonthRhythmDay) -> some View {
        let count = days.count
        let lines: [StatsExplorerLine] = [(current, true), (comparison, false)].map { row, isCurrent in
            .init(key: String(row.start), label: isCurrent ? monthName(row.start) : monthName(row.start), current: isCurrent,
                  points: (explorer.lines[row.start] ?? []).map { (x: Double($0.x), y: $0.y) })
        }
        let band = showRange ? (explorer.band?.points.filter { $0.x <= count }.map { StatsExplorerBandPoint(x: Double($0.x), low: $0.low, high: $0.high) } ?? []) : []
        let monthLabel = monthName(current.start)
        let ticks = [1, 8, 15, 22, 29].filter { $0 <= count }.map { StatsExplorerTick(x: Double($0), label: String($0)) }
        return StatsExplorerChart(
            lineTitle: "\(StatsDisplay.option(StatsToggleOption(rawValue: metric.rawValue) ?? .distance)) accumulated",
            barTitle: "Daily \(StatsDisplay.option(StatsToggleOption(rawValue: metric.rawValue) ?? .distance).lowercased())",
            lines: lines, band: band,
            columns: days.enumerated().map { index, item in
                .init(key: item.day, label: "\(monthLabel) \(index + 1)", tickLabel: String(index + 1), x1: Double(index) + 0.6, x2: Double(index) + 1.4,
                      values: item.bySport, disabled: item.day > today)
            },
            domain: 0...(Double(count) + 0.5), ticks: ticks, selected: day.day,
            select: { savedDay = $0 },
            boundary: (Double(StatsDates.parts(today).day!) + 0.5, "As of \(StatsDisplay.shortDate(today, locale: locale))"),
            formatValue: measure,
            formatAxis: { axisText($0, step: $1, metric: metric, units: units, locale: locale) })
            .accessibilityIdentifier("stats-month-chart")
    }

    private var table: some View {
        StatsExplorerTable(title: "Recent months", headers: ["Month", "Through day \(StatsDates.parts(today).day!)", "Full month"],
                           rows: explorer.rows, note: "Comparisons use the same day of each month. Shorter months use their last day.") { row in
            if row.start == current.start {
                Text("\(longMonth(row.start)) so far").fontWeight(.medium).frame(minHeight: 32, alignment: .leading)
            } else {
                Button { savedComparison = row.start } label: {
                    Text("\(longMonth(row.start))\(row.start == comparison.start ? " · comparing" : "")").frame(minHeight: 32, alignment: .leading)
                }
                .buttonStyle(.plain).foregroundStyle(row.start == comparison.start ? AppTheme.accent : .primary)
                .accessibilityLabel("Compare \(longMonth(row.start))")
                .accessibilityAddTraits(row.start == comparison.start ? .isSelected : [])
            }
            Text(measure(row.elapsed))
            Text(row.start == current.start ? "—" : measure(row.total)).foregroundStyle(.secondary)
        }
    }
}
extension StatsPeriodHistoryComparison: Identifiable { var id: Int { start } }

// MARK: - Year

struct StatsYearExplorerView: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    @Environment(\.statsTileInspection) private var inspection
    @AppStorage("stats.year-typical-range") private var showRange = true
    let explorer: StatsYearExplorer
    let metric: StatsMetric
    let today: Int
    let openActivity: (Int) -> Void
    @State private var localMonth: Int?
    @State private var localComparison: Int?

    private var savedMonth: Int? {
        get { if let inspection { return inspection.yearMonth } else { return localMonth } }
        nonmutating set { if let inspection { inspection.yearMonth = newValue } else { localMonth = newValue } }
    }
    private var savedComparison: Int? {
        get { if let inspection { return inspection.yearComparison } else { return localComparison } }
        nonmutating set { if let inspection { inspection.yearComparison = newValue } else { localComparison = newValue } }
    }
    private var year: Int { StatsDates.parts(today).year! }
    private var current: StatsPeriodHistoryComparison { explorer.rows[0] }
    private var comparison: StatsPeriodHistoryComparison? {
        explorer.rows.dropFirst().first { $0.start == savedComparison } ?? explorer.rows.dropFirst().first
    }
    private var comparedYear: Int { comparison.map { StatsDates.parts($0.start).year! } ?? year - 1 }
    private var months: [StatsYearMonthRhythm] { explorer.months[comparedYear] ?? explorer.months[year - 1] ?? [] }
    private var selectedMonth: StatsYearMonthRhythm? {
        months.first { $0.start == savedMonth } ?? months.last
    }
    private var sports: [ActivityCategory] {
        ActivityCategory.allCases.filter { sport in
            months.contains { ($0.current[sport] ?? 0) > 0 || (comparison != nil && ($0.previous[sport] ?? 0) > 0) }
        }
    }
    private func measure(_ value: Double) -> String { valueText(value, metric: metric, units: units, locale: locale) }
    private func monthName(_ day: Int) -> String {
        StatsDates.date(day).formatted(Date.FormatStyle(locale: locale, calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated))
    }
    private func yearText(_ row: StatsPeriodHistoryComparison) -> String { String(StatsDates.parts(row.start).year!) }
    private var sentence: String {
        guard let comparison else { return explorer.activities.isEmpty ? "No activities recorded yet." : "Your first recorded year." }
        let difference = current.elapsed - comparison.elapsed
        if difference == 0 { return "Level with \(comparedYear) at this point." }
        if StatsDisplay.value(abs(difference), metric: metric, units: units, locale: locale).allSatisfy({ "0.,\u{a0} ".contains($0) }) {
            return "About level with \(comparedYear) at this point."
        }
        return "\(measure(abs(difference))) \(difference > 0 ? "ahead of" : "behind") \(comparedYear) at this point."
    }
    private var rangeExplanation: String {
        guard let band = explorer.band else { return "Historical range needs at least two completed years of activity history." }
        return "The minimum–maximum cumulative totals at each calendar date, based on \(band.count) completed years (\(StatsDates.parts(band.first).year!)–\(StatsDates.parts(band.last).year!)). These are the 0th–100th percentiles. The current year and partial opening year are excluded. The band continues beyond \(StatsDisplay.shortDate(today, locale: locale)) through the end of past years; it is historical context, not a forecast. February 29 uses February 28 in non-leap years. Uses your activity filters."
    }

    var body: some View {
        let headline = metric.headline(current.elapsed, units: units, locale: locale)
        VStack(alignment: .leading, spacing: 16) {
            StatsExplorerHeadline(value: headline.value, unit: headline.unit,
                                  caption: "\(String(year)) so far · through \(StatsDisplay.shortDate(today, locale: locale))", note: sentence)
            if comparison != nil { controls }
            if let month = selectedMonth {
                VStack(alignment: .leading, spacing: 8) {
                    chart(month)
                    StatsSportLegend(categories: sports)
                    if comparison != nil { Text("Paired bars: \(String(year)) / \(String(comparedYear)) (faded)").font(.caption).foregroundStyle(.secondary) }
                    Text("Completed months compare in full; \(monthName(today)) compares through \(StatsDisplay.shortDate(today, locale: locale)) in both years.").font(.caption).foregroundStyle(.secondary)
                }
                let rows = activities(in: month)
                StatsExplorerActivities(
                    heading: "\(StatsDisplay.month(month.start, locale: locale)) · \(measure(rows.reduce(0) { $0 + $1.value(metric) })) · \(rows.count) \(rows.count == 1 ? "activity" : "activities")",
                    activities: rows, metric: metric, identifierPrefix: "stats-year-activity-", openActivity: openActivity,
                    emptyText: "No matching activities in this month.",
                    step: { offset in
                        if let index = months.firstIndex(where: { $0.start == month.start }) {
                            savedMonth = months[min(max(0, index + offset), months.count - 1)].start
                        }
                    },
                    canStep: (month.start != months.first?.start, month.start != months.last?.start))
            }
            StatsExplorerData { table }
        }
    }

    private func activities(in month: StatsYearMonthRhythm) -> [StatsActivity] {
        let end = min(today, StatsDates.start(year: StatsDates.parts(month.start).year!, month: StatsDates.parts(month.start).month! + 1) - 1)
        return explorer.activities.filter { $0.day >= month.start && $0.day <= end }
    }

    private var controls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { comparisonPicker; Spacer(minLength: 0); StatsHistoricalRangeControl(isOn: $showRange, explanation: rangeExplanation) }
            VStack(alignment: .leading, spacing: 0) { comparisonPicker; StatsHistoricalRangeControl(isOn: $showRange, explanation: rangeExplanation) }
        }
    }
    private var comparisonPicker: some View {
        StatsComparisonPicker(title: "Comparison year", options: explorer.rows.dropFirst().map { ($0.start, yearText($0)) },
                              selection: Binding(get: { comparison?.start ?? 0 }, set: { savedComparison = $0 }),
                              identifier: "stats-year-comparison")
    }

    private func chart(_ selected: StatsYearMonthRhythm) -> some View {
        let origin = StatsDates.start(year: referenceYear)
        func offset(_ month: Int) -> Double { Double(StatsDates.start(year: referenceYear, month: month) - origin) }
        let lines: [StatsExplorerLine] = ([(current, true)] + (comparison.map { [($0, false)] } ?? [])).map { row, isCurrent in
            .init(key: String(row.start), label: yearText(row), current: isCurrent,
                  points: (explorer.lines[row.start] ?? []).map { (x: Double($0.x), y: $0.y) })
        }
        let date = StatsDates.parts(today)
        let cutoff = offset(date.month!) + Double(date.day!) - 1
        let ticks = months.indices.map { StatsExplorerTick(x: (offset($0 + 1) + offset($0 + 2) - 1) / 2, label: monthName(months[$0].start)) }
        return StatsExplorerChart(
            lineTitle: "\(StatsDisplay.option(StatsToggleOption(rawValue: metric.rawValue) ?? .distance)) accumulated",
            barTitle: comparison == nil ? "Monthly \(StatsDisplay.option(StatsToggleOption(rawValue: metric.rawValue) ?? .distance).lowercased())"
                : "Monthly \(StatsDisplay.option(StatsToggleOption(rawValue: metric.rawValue) ?? .distance).lowercased()) · \(String(year)) / \(String(comparedYear))",
            lines: lines,
            band: showRange ? (explorer.band?.points.map { StatsExplorerBandPoint(x: Double($0.x), low: $0.low, high: $0.high) } ?? []) : [],
            columns: months.enumerated().map { index, item in
                .init(key: item.start, label: "\(StatsDisplay.month(item.start, locale: locale))", tickLabel: monthName(item.start),
                      x1: offset(index + 1), x2: offset(index + 2) - 1, values: item.current,
                      previous: comparison == nil ? nil : item.previous, incomplete: item.inProgress)
            },
            domain: 0...365, ticks: ticks, selected: selected.start, select: { savedMonth = $0 },
            boundary: (min(365, cutoff + 0.5), "As of \(StatsDisplay.shortDate(today, locale: locale))"),
            comparisonLabel: comparison == nil ? nil : String(comparedYear),
            formatValue: measure,
            formatAxis: { axisText($0, step: $1, metric: metric, units: units, locale: locale) })
            .accessibilityIdentifier("stats-year-chart")
    }

    private var table: some View {
        StatsExplorerTable(title: "Recorded years", headers: ["Year", "Through \(StatsDisplay.shortDate(today, locale: locale))", "Full year"],
                           rows: explorer.rows, note: "Comparisons use the same calendar date in each year.") { row in
            if row.start == current.start {
                Text("\(yearText(row)) so far").fontWeight(.medium).frame(minHeight: 32, alignment: .leading)
            } else {
                Button { savedComparison = row.start } label: {
                    Text("\(yearText(row))\(row.start == comparison?.start ? " · comparing" : "")\(row.incomplete ? " · partial history" : "")")
                        .frame(minHeight: 32, alignment: .leading)
                }
                .buttonStyle(.plain).foregroundStyle(row.start == comparison?.start ? AppTheme.accent : .primary)
                .accessibilityLabel("Compare \(yearText(row))")
                .accessibilityAddTraits(row.start == comparison?.start ? .isSelected : [])
            }
            Text(measure(row.elapsed))
            Text(row.start == current.start ? "—" : measure(row.total)).foregroundStyle(.secondary)
        }
    }
}

// MARK: - Hilliness

struct StatsHillinessExplorerView: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    @Environment(\.statsTileInspection) private var inspection
    @Environment(\.statsInspectedActivityID) private var inspectedActivityID
    let explorer: StatsHillinessExplorer
    let today: Int
    let openActivity: (Int) -> Void
    @State private var localSport: ActivityCategory?
    @State private var localMonth: Int?

    private var savedSport: ActivityCategory? {
        get { if let inspection { return inspection.hillinessSport } else { return localSport } }
        nonmutating set { if let inspection { inspection.hillinessSport = newValue } else { localSport = newValue } }
    }
    private var savedMonth: Int? {
        get { if let inspection { return inspection.hillinessMonth } else { return localMonth } }
        nonmutating set { if let inspection { inspection.hillinessMonth = newValue } else { localMonth = newValue } }
    }
    private var data: StatsHillinessSport? {
        explorer.sports.first { $0.sport == savedSport } ?? explorer.sports.first { $0.sport == explorer.dominant } ?? explorer.sports.first
    }
    private func number(_ value: Double) -> String { StatsDisplay.number(units.hilliness(value), decimals: 1, locale: locale) }
    private func monthName(_ day: Int) -> String {
        StatsDates.date(day).formatted(Date.FormatStyle(locale: locale, calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated))
    }

    var body: some View {
        if let data { content(data) } else {
            Text("No activities with recorded distance and ascent in the last 12 months.").font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 24)
        }
    }

    private func content(_ data: StatsHillinessSport) -> some View {
        let months = data.months
        let index = months.firstIndex { $0.start == savedMonth }
            ?? months.lastIndex { $0.total > 0 } ?? months.count - 1
        let month = months[index]
        let selected = data.activities.filter { $0.day >= month.start && $0.day <= month.end }
        let distance = selected.reduce(0) { $0 + ($1.distance ?? 0) / 1000 }
        let ascent = selected.reduce(0) { $0 + ($1.elevation ?? 0) }
        let ranked = selected.filter { ($0.distance ?? 0) >= 5000 }
            .enumerated().sorted { a, b in
                let ra = (a.element.elevation ?? 0) / (a.element.distance ?? 1), rb = (b.element.elevation ?? 0) / (b.element.distance ?? 1)
                return ra == rb ? a.offset < b.offset : ra > rb
            }.map(\.element)
        let label = StatsDisplay.month(month.start, locale: locale)
        let previousText = data.hasPreviousYear ? "\(number(data.climbing.previous / 100)) \(units.hillinessUnit)" : "no recorded ascent"
        return VStack(alignment: .leading, spacing: 16) {
            StatsExplorerHeadline(value: number(data.climbing.current / 100), unit: units.hillinessUnit,
                                  caption: "\(data.sport.name) · last 12 months", note: "Previous 12 months: \(previousText).")
            if explorer.sports.count > 1 {
                StatsRangePicker(title: "Hilliness sport", ranges: explorer.sports.map(\.sport), selection: Binding(get: { data.sport }, set: { savedSport = $0; savedMonth = nil }),
                                 label: \.name)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Monthly climbing per distance").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
                chart(data, months: months, selected: month.start)
                Text("Dashed: your distance-weighted average over the last 12 months. Faded bars: incomplete months.").font(.caption).foregroundStyle(.secondary)
                Text("Ascent divided by distance, using activities with both values recorded. Months without recorded distance have no bar.").font(.caption).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("\(label) · \(distance > 0 ? number(ascent / distance) : "—") \(units.hillinessUnit)").font(.subheadline.weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 4)
                    stepButton("chevron.left", "Previous month", enabled: index > 0) { savedMonth = months[index - 1].start }
                    stepButton("chevron.right", "Next month", enabled: index < months.count - 1) { savedMonth = months[index + 1].start }
                }
                StatsSummaryValues(items: [
                    .init(label: "Distance", value: StatsDisplay.measurement(distance, metric: .distance, units: units, locale: locale)),
                    .init(label: "Ascent", value: StatsDisplay.measurement(ascent, metric: .elevation, units: units, locale: locale)),
                    .init(label: "Measured activities", value: String(selected.count)),
                ])
                Text("Hilliest activities").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
                Text("\(Formatters.distance(5000, locale: locale, units: units)) or more · ranked within this month").font(.caption).foregroundStyle(.secondary)
                if ranked.isEmpty { Text("No qualifying activities in this month.").font(.caption).foregroundStyle(.secondary) }
                ForEach(Array(ranked.enumerated()), id: \.offset) { _, activity in
                    let distance = (activity.distance ?? 0) / 1000
                    StatsActivityRow(sport: activity.sport, name: activity.name,
                                     summary: "\(StatsDisplay.shortDate(activity.day, locale: locale)) · \(StatsDisplay.measurement(distance, metric: .distance, units: units, locale: locale)) · \(StatsDisplay.measurement(activity.elevation ?? 0, metric: .elevation, units: units, locale: locale)) climbed",
                                     detail: "\(number((activity.elevation ?? 0) / distance)) \(units.hillinessUnit)",
                                     open: activity.id.map { id in { openActivity(id) } })
                        .background(activity.id != nil && activity.id == inspectedActivityID ? Color.accentColor.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityIdentifier(activity.id.map { "stats-hilliness-activity-\($0)" } ?? "")
                    Divider()
                }
            }
            .padding(.top, 4)
        }
    }

    private func stepButton(_ symbol: String, _ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.body.weight(.semibold))
                .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget).contentShape(Rectangle())
        }
        .buttonStyle(.plain).foregroundStyle(enabled ? AppTheme.accent : Color.secondary.opacity(0.4)).disabled(!enabled)
        .accessibilityLabel(label)
    }

    private func chart(_ data: StatsHillinessSport, months: [StatsHistoryBucket], selected: Int) -> some View {
        let rates = data.climbing.months.map(\.rate)
        let stride = 2
        return StatsExplorerChart(
            columns: months.enumerated().map { index, bucket in
                .init(key: bucket.start, label: StatsDisplay.month(bucket.start, locale: locale), tickLabel: monthName(bucket.start),
                      x1: Double(index) + 0.1, x2: Double(index) + 0.9,
                      values: [data.sport: (rates.indices.contains(index) ? rates[index] : 0) / 100], incomplete: bucket.incomplete)
            },
            domain: 0...Double(months.count),
            ticks: months.indices.filter { $0 % stride == 0 }.map { StatsExplorerTick(x: Double($0) + 0.5, label: monthName(months[$0].start)) },
            selected: selected, select: { savedMonth = $0 },
            trend: months.indices.map { (x: Double($0) + 0.5, y: data.climbing.current / 100) },
            formatValue: { "\(number($0)) \(units.hillinessUnit)" },
            formatAxis: { value, step in StatsDisplay.compactAxis(units.hilliness(value), step: units.hilliness(step), locale: locale) })
            .accessibilityIdentifier("stats-hilliness-chart")
    }
}

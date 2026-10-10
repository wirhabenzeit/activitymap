import Charts
import SwiftUI

extension EnvironmentValues {
    /// Actual width after the app's sidebar has taken space.
    @Entry var statsAvailableWidth: CGFloat = 0
}

struct StatsPeriodDetail<Curve: View>: View {
    let rhythm: StatsComparisonRhythm
    let history: [StatsPeriodHistoryComparison]
    let metric: StatsMetric
    let today: Int
    let openActivity: (Int) -> Void
    @ViewBuilder let curve: () -> Curve
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.statsDetailHeightLimit) private var shortViewportLimit
    @State private var width: CGFloat = 0
    private var monthly: Bool { if case .month = rhythm { return true }; return false }
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            let layout = width >= 1000 && !typeSize.isAccessibilitySize ? AnyLayout(HStackLayout(alignment: .top, spacing: 24)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 24))
            layout {
                curve().environment(\.statsFocusChartHeight, width >= 760 ? 320 : 200)
                    .environment(\.statsDetailHeightLimit, width < 760 ? min(shortViewportLimit ?? 200, 200) : shortViewportLimit)
                    .frame(maxWidth: .infinity, alignment: .leading)
                rhythmView.frame(maxWidth: .infinity, alignment: .leading)
            }
            StatsPeriodHistoryTable(rows: history, metric: metric, monthly: monthly)
        }.onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
    @ViewBuilder private var rhythmView: some View {
        switch rhythm {
        case .month(let month): StatsMonthRhythmView(rhythm: month, metric: metric, today: today, openActivity: openActivity)
        case .year(let months): StatsYearRhythmView(months: months, metric: metric, today: today)
        }
    }
}

private struct StatsMonthRhythmView: View {
    let rhythm: StatsMonthRhythm
    let metric: StatsMetric
    let today: Int
    let openActivity: (Int) -> Void
    @State private var selectedDay: Int?
    @State private var width: CGFloat = 0
    @Environment(\.statsTileInspection) private var inspection
    @Environment(\.statsInspectedActivityID) private var inspectedActivityID
    @Environment(\.dynamicTypeSize) private var typeSize
    private var focusedDay: Int? {
        get { if let inspection { return inspection.monthDay }; return selectedDay }
        nonmutating set { if let inspection { inspection.monthDay = newValue } else { selectedDay = newValue } }
    }
    private var selected: StatsMonthRhythmDay? { rhythm.days.first { $0.day == focusedDay } }
    private var maximum: Double { max(1, rhythm.days.map { $0.bySport.values.reduce(0, +) }.max() ?? 0) }
    private var sports: [ActivityCategory] { ActivityCategory.allCases.filter { sport in rhythm.days.contains { day in day.activities.contains { $0.sport == sport } } } }
    private var offset: Int { rhythm.days.first.map { $0.day - StatsDates.monday($0.day) } ?? 0 }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Daily rhythm").font(.headline)
            StatsSummaryValues(items: [
                .init(label: "Activities", value: String(rhythm.activityCount)),
                .init(label: "Active days", value: String(rhythm.activeDays)),
                .init(label: metric == .count ? "Per active day" : "Average outing", value: average),
            ])
            if typeSize.isAccessibilitySize || width < 314 {
                ForEach(rhythm.days.filter { $0.day <= today }, id: \.day) { day in
                    Button { focusedDay = day.day } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(StatsDisplay.shortDate(day.day))
                                Text("\(day.activities.count) activities").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(StatsDisplay.measurement(day.bySport.values.reduce(0, +), metric: metric))
                        }.frame(minHeight: 44)
                    }.buttonStyle(.plain).accessibilityAddTraits(day.day == focusedDay ? .isSelected : [])
                }
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 1), count: 7), spacing: 6) {
                    ForEach(0..<7, id: \.self) { index in Text(StatsDisplay.weekday(StatsDates.monday(today) + index)).font(.caption2).foregroundStyle(.secondary).accessibilityHidden(true) }
                    ForEach((-offset)..<0, id: \.self) { _ in Color.clear.frame(height: 60).accessibilityHidden(true) }
                    ForEach(rhythm.days, id: \.day) { day in dayCell(day) }
                }
            }
            StatsRhythmLegend(sports: sports)
            if rhythm.days.contains(where: { !$0.activities.isEmpty && $0.bySport.values.reduce(0, +) == 0 }) {
                Text("Dots mark activities with zero or no recorded value.").font(.caption).foregroundStyle(.secondary)
            }
            if let selected {
                Divider()
                Text(StatsDisplay.date(selected.day)).font(.subheadline.weight(.semibold))
                if selected.activities.isEmpty { Text("No matching activities on this day.").font(.caption).foregroundStyle(.secondary) }
                ForEach(Array(selected.activities.enumerated()), id: \.offset) { _, activity in
                    StatsActivityRow(sport: activity.sport, name: activity.name,
                                     summary: "\(activity.sport.name) · \(StatsDisplay.measurement(activity.value(metric), metric: metric))",
                                     open: activity.id.map { id in { openActivity(id) } })
                        .background(activity.id != nil && activity.id == inspectedActivityID ? Color.accentColor.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityIdentifier(activity.id.map { "stats-month-activity-\($0)" } ?? "")
                }
            }
        }.onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onAppear { reconcileSelection() }
        .onChange(of: rhythm.days.map(\.day)) { reconcileSelection() }
        .onChange(of: rhythm.days.map { $0.activities.count }) { reconcileSelection() }
        .onChange(of: inspection.map(ObjectIdentifier.init)) { reconcileSelection() }
    }
    private var average: String {
        guard let average = rhythm.average else { return "—" }
        return metric == .count ? StatsDisplay.number(average, decimals: 1) : StatsDisplay.measurement(average, metric: metric)
    }
    private func reconcileSelection() {
        if let focusedDay, rhythm.days.contains(where: { $0.day == focusedDay && $0.day <= today }) { return }
        focusedDay = rhythm.days.last { $0.day <= today && !$0.activities.isEmpty }?.day
    }
    private func dayCell(_ day: StatsMonthRhythmDay) -> some View {
        let total = day.bySport.values.reduce(0, +)
        return Button { focusedDay = day.day } label: {
            VStack(spacing: 3) {
                Text(String(StatsDates.parts(day.day).day!)).font(.caption2).foregroundStyle(day.day > today ? Color.secondary.opacity(0.4) : Color.secondary)
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    ForEach(sports.reversed()) { sport in Rectangle().fill(sport.color).frame(height: 30 * (day.bySport[sport] ?? 0) / maximum) }
                    if total == 0 && !day.activities.isEmpty {
                        HStack(spacing: 2) {
                            ForEach(sports.filter { sport in day.activities.contains { $0.sport == sport } }) { sport in
                                Circle().fill(sport.color).frame(width: 5, height: 5)
                            }
                        }.padding(.bottom, 3)
                    }
                    Rectangle().fill(.quaternary).frame(height: 1)
                }.frame(height: 31)
            }.frame(maxWidth: .infinity, minHeight: 60)
            .background(day.day == focusedDay ? Color.accentColor.opacity(0.1) : Color.secondary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
            .overlay { if day.day == focusedDay { RoundedRectangle(cornerRadius: 6).stroke(Color.accentColor, lineWidth: 2) } }.contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(day.day > today)
        .accessibilityLabel(StatsDisplay.date(day.day))
        .accessibilityValue(day.day > today ? "Not yet elapsed" : "\(day.activities.count) activities, \(StatsDisplay.measurement(total, metric: metric))")
        .accessibilityAddTraits(day.day == focusedDay ? .isSelected : [])
        .accessibilityIdentifier("stats-month-day-\(day.day)")
    }
}

private struct StatsYearRhythmView: View {
    let months: [StatsYearMonthRhythm]
    let metric: StatsMetric
    let today: Int
    @ScaledMetric private var height = 230.0
    @State private var selectedMonth: Int?
    @Environment(\.statsTileInspection) private var inspection
    @Environment(\.dynamicTypeSize) private var typeSize
    private var ticks: [Int] { Array(stride(from: 0, to: months.count, by: typeSize.isAccessibilitySize ? max(1, (months.count + 1) / 2) : 1)) }
    private var maximum: Double { max(1, months.flatMap { [$0.current.values.reduce(0, +), $0.previous.values.reduce(0, +)] }.max() ?? 0) * 1.08 }
    private var axisTicks: [Double] { StatsDisplay.axisTicks(maximum: maximum) }
    private var axisStep: Double { axisTicks.count > 1 ? metric.displayValue(axisTicks[1] - axisTicks[0]) : 1 }
    private var year: Int { StatsDates.parts(today).year! }
    private var selectedIndex: Int {
        let start = inspection?.yearMonth ?? selectedMonth
        return months.firstIndex { $0.start == start } ?? max(0, months.count - 1)
    }
    private var monthSelection: Binding<Int> {
        Binding(get: { selectedIndex }, set: { index in
            guard months.indices.contains(index) else { return }
            if let inspection { inspection.yearMonth = months[index].start }
            else { selectedMonth = months[index].start }
        })
    }
    private var sports: [ActivityCategory] { ActivityCategory.allCases.filter { sport in months.contains { ($0.current[sport] ?? 0) > 0 || ($0.previous[sport] ?? 0) > 0 } } }
    private func lower(_ values: [ActivityCategory: Double], sport: ActivityCategory) -> Double { sports.prefix { $0 != sport }.reduce(0) { $0 + (values[$1] ?? 0) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Monthly rhythm").font(.headline)
            Text("\(String(year - 1)) left · \(String(year)) right. Current month compares through the same date.").font(.caption).foregroundStyle(.secondary)
            Chart {
                ForEach(Array(months.enumerated()), id: \.offset) { index, month in
                    ForEach([false, true], id: \.self) { current in
                        let values = current ? month.current : month.previous
                        ForEach(sports) { sport in
                            sportBar(index: index, month: month, current: current, sport: sport, values: values)
                        }
                    }
                }
                if !months.isEmpty {
                    RuleMark(x: .value("Selected month", Double(selectedIndex)))
                        .foregroundStyle(Color.secondary.opacity(0.4))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .accessibilityHidden(true)
                }
            }.chartXScale(domain: -0.5...(Double(max(1, months.count)) - 0.5))
            .chartYScale(domain: 0...maximum)
            .chartXAxis {
                AxisMarks(values: ticks) { tick in
                    AxisValueLabel { if let index = tick.as(Int.self), months.indices.contains(index) { Text(StatsDates.date(months[index].start).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated))).font(.caption2) } }
                }
            }.chartYAxis {
                AxisMarks(position: .leading, values: axisTicks) { tick in
                    AxisGridLine()
                    AxisValueLabel { if let value = tick.as(Double.self) { Text(StatsDisplay.compactAxis(metric.displayValue(value), step: axisStep)).font(.caption2) } }
                }
            }.chartXSelection(value: Binding<Double?>(
                get: { Double(selectedIndex) },
                set: { if let value = $0 { monthSelection.wrappedValue = min(max(0, Int(value.rounded())), max(0, months.count - 1)) } }
            ))
            .frame(height: min(height, 320))
            if months.indices.contains(selectedIndex) {
                let month = months[selectedIndex]
                Picker("Compare month", selection: monthSelection) {
                    ForEach(Array(months.enumerated()), id: \.offset) { index, month in
                        Text(StatsDisplay.month(month.start)).tag(index)
                    }
                }.pickerStyle(.menu)
                .accessibilityIdentifier("stats-year-rhythm-month")
                StatsSummaryValues(items: [
                    .init(label: String(year - 1), value: StatsDisplay.measurement(month.previous.values.reduce(0, +), metric: metric)),
                    .init(label: String(year), value: StatsDisplay.measurement(month.current.values.reduce(0, +), metric: metric)),
                ])
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(StatsDisplay.month(month.start)): \(String(year - 1)), \(StatsDisplay.measurement(month.previous.values.reduce(0, +), metric: metric)); \(String(year)), \(StatsDisplay.measurement(month.current.values.reduce(0, +), metric: metric))")
                .accessibilityIdentifier("stats-year-rhythm-totals")
                Text(month.inProgress ? "Current month totals through the same calendar date." : "Completed month totals.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            StatsRhythmLegend(sports: sports)
        }
    }
    private func sportBar(index: Int, month: StatsYearMonthRhythm, current: Bool, sport: ActivityCategory, values: [ActivityCategory: Double]) -> some ChartContent {
        let start = Double(index) + (current ? 0.04 : -0.34)
        let end = Double(index) + (current ? 0.34 : -0.04)
        let low = lower(values, sport: sport)
        let value = values[sport] ?? 0
        return RectangleMark(xStart: .value("Month start", start), xEnd: .value("Month end", end),
                       yStart: .value("Lower", low), yEnd: .value("Upper", low + value))
            .foregroundStyle(sport.color.opacity(current ? 1 : 0.4))
            .accessibilityLabel("\(StatsDisplay.month(month.start)), \(String(current ? year : year - 1)), \(sport.name)\(month.inProgress ? ", through the same date" : "")")
            .accessibilityValue(StatsDisplay.measurement(value, metric: metric))
    }

}

private struct StatsRhythmLegend: View {
    let sports: [ActivityCategory]
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        if typeSize.isAccessibilitySize { VStack(alignment: .leading, spacing: 6) { labels } }
        else { ViewThatFits(in: .horizontal) { HStack(spacing: 12) { labels }; VStack(alignment: .leading, spacing: 6) { labels } } }
    }
    private var labels: some View { ForEach(sports) { sport in HStack(spacing: 4) { Circle().fill(sport.color).frame(width: 7, height: 7); Text(sport.name).font(.caption) } } }
}

private struct StatsPeriodHistoryTable: View {
    let rows: [StatsPeriodHistoryComparison]
    let metric: StatsMetric
    let monthly: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(monthly ? "Month comparisons" : "Year comparisons").font(.headline)
            Text("Compare the same elapsed dates. Full totals are shown for completed periods; partial history may be missing earlier activities.").font(.caption).foregroundStyle(.secondary)
            ScrollView(.horizontal) {
                Grid(alignment: .trailing, horizontalSpacing: 24, verticalSpacing: 12) {
                    GridRow { Text(monthly ? "Month" : "Year").gridColumnAlignment(.leading); Text("Through same date"); Text("Full period") }.fontWeight(.semibold).accessibilityAddTraits(.isHeader)
                    ForEach(rows, id: \.start) { row in
                        GridRow {
                            Text("\(monthly ? StatsDisplay.month(row.start) : String(StatsDates.parts(row.start).year!))\(row.incomplete && row.fullTotal != nil ? " · partial history" : "")")
                            Text(StatsDisplay.measurement(row.elapsed, metric: metric))
                            Text(row.fullTotal.map { StatsDisplay.measurement($0, metric: metric) } ?? "In progress")
                        }.accessibilityElement(children: .combine)
                    }
                }.font(.caption).monospacedDigit().fixedSize(horizontal: true, vertical: false).padding(.vertical, 4)
            }
        }
    }
}

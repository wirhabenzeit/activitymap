import SwiftUI
import Charts

struct StatsChartPoint: Identifiable {
    let x: Int
    let value: Double?
    let series: String
    let partial: Bool
    var id: String { "\(series)-\(x)" }
}

struct StatsSeriesChart: View {
    enum Axis { case date, day, year, weekday }
    enum Style { case bars, lines, volume, consistency }
    let points: [StatsChartPoint]
    let metric: StatsMetric
    let expanded: Bool
    let axis: Axis
    let style: Style
    var compact = false
    var band: StatsComparisonBand? = nil
    @State private var selectedX: Int?
    @ScaledMetric private var height = 130.0
    @ScaledMetric(relativeTo: .caption2) private var endpointPadding = 34.0

    private var maximum: Double { style == .consistency ? 7 : max(1, points.compactMap(\.value).max() ?? 1, band?.points.map(\.high).max() ?? 0) * 1.08 }
    private var selected: [StatsChartPoint] {
        guard let selectedX, let closest = points.min(by: { abs($0.x - selectedX) < abs($1.x - selectedX) }) else { return [] }
        return points.filter { $0.x == closest.x }
    }
    private var series: [String] { points.reduce(into: []) { if !$0.contains($1.series) { $0.append($1.series) } } }
    private func label(_ x: Int) -> String {
        switch axis {
        case .date, .weekday: StatsDisplay.date(x)
        case .day: "Day \(x)"
        case .year: StatsDates.date(StatsDates.start(year: 2000) + x).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated).day())
        }
    }
    private func value(_ point: StatsChartPoint) -> String {
        guard let value = point.value else { return "Not yet elapsed" }
        if style == .consistency { return "\(StatsDisplay.number(value)) active days" }
        if point.series == "m / km" { return "\(StatsDisplay.number(value)) m / km" }
        return StatsDisplay.measurement(value, metric: metric)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Chart {
                historicalArea
                ForEach(points) { point in
                    if let value = point.value {
                        if axis == .weekday {
                            RectangleMark(xStart: .value("Start", Double(point.x) - 0.34),
                                          xEnd: .value("End", Double(point.x) + 0.34),
                                          yStart: .value("Baseline", 0.0), yEnd: .value("Value", value))
                                .foregroundStyle(point.partial ? Color.primary : Color.secondary.opacity(0.45))
                                .accessibilityLabel("\(label(point.x))\(point.partial ? ", incomplete" : "")")
                                .accessibilityValue(self.value(point))
                        } else if style == .bars || style == .consistency {
                            BarMark(x: .value("Period", point.x), y: .value("Value", value))
                                .foregroundStyle(point.partial ? AppTheme.accent : Color.primary.opacity(0.65))
                                .accessibilityLabel("\(label(point.x))\(point.partial ? ", incomplete" : "")")
                                .accessibilityValue(self.value(point))
                        } else {
                            if style == .volume, point.series == "Weekly total", !point.partial {
                                // The lighter tail overlaps this series at its first point.
                                // Both fills share a zero baseline; they must never stack.
                                AreaMark(x: .value("Period", point.x), y: .value("Value", value), stacking: .unstacked)
                                    .foregroundStyle(Color.primary.opacity(0.12))
                                    .accessibilityHidden(true)
                            }
                            if !compact || style != .volume || !point.partial {
                            LineMark(x: .value("Period", point.x), y: .value("Value", value), series: .value("Series", point.series))
                                .foregroundStyle(by: .value("Series", point.series))
                                .lineStyle(StrokeStyle(lineWidth: isReference(point) ? 1.5 : 2,
                                                       dash: isReference(point) || point.series == "4-week average" ? [4, 3] : []))
                                .accessibilityLabel("\(point.series), \(label(point.x))\(point.partial ? ", incomplete" : "")")
                                .accessibilityValue(self.value(point))
                            }
                        }
                    }
                }
                if compact && style == .volume {
                    ForEach(Array(points.filter { $0.series == "Weekly total" }.suffix(2))) { point in
                        AreaMark(x: .value("Period", point.x), y: .value("Total", point.value ?? 0), series: .value("Series", "Incomplete week"), stacking: .unstacked)
                            .foregroundStyle(Color.primary.opacity(0.04)).accessibilityHidden(true)
                        LineMark(x: .value("Period", point.x), y: .value("Total", point.value ?? 0), series: .value("Series", "Incomplete week"))
                            .foregroundStyle(Color.secondary).lineStyle(.init(lineWidth: 1.5, dash: [3, 3]))
                            .accessibilityLabel("Week of \(label(point.x))\(point.partial ? ", incomplete" : "")")
                            .accessibilityValue(self.value(point))
                    }
                }
                if style == .lines {
                    ForEach(endpoints) { point in
                        PointMark(x: .value("Period", point.x), y: .value("Value", point.value ?? 0))
                            .symbolSize(isReference(point) ? 0 : 16)
                            .foregroundStyle(isReference(point) ? Color.secondary : Color.primary)
                            .annotation(position: .trailing, spacing: 4) {
                                Text(point.series).font(.caption2)
                                    .foregroundStyle(isReference(point) ? Color.secondary : Color.primary)
                                    .offset(y: endpointLabelsOverlap ? (isReference(point) ? 7 : -7) : 0)
                            }
                            .accessibilityHidden(true)
                    }
                }
                if let point = selected.first {
                    RuleMark(x: .value("Selected period", point.x)).foregroundStyle(.secondary.opacity(0.4))
                }
            }
            .chartForegroundStyleScale(domain: series, range: [Color.primary, style == .lines ? Color.secondary : AppTheme.accent])
            .chartYScale(domain: 0...maximum)
            .chartXScale(domain: xDomain)
            .chartXAxis {
                if style == .lines {
                    AxisMarks(values: comparisonTicks) { value in
                        AxisValueLabel {
                            if let x = value.as(Int.self) {
                                Text(axis == .day ? "\(x)" : StatsDates.date(StatsDates.start(year: 2000) + x).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated))).font(.caption2)
                            }
                        }
                    }
                } else if axis == .weekday {
                    AxisMarks(values: points.map(\.x)) { value in
                        AxisValueLabel {
                            if let day = value.as(Int.self) { Text(StatsDisplay.weekday(day)).font(.caption2) }
                        }
                    }
                } else if compact && style == .volume {
                    AxisMarks(values: points.filter { $0.series == "Weekly total" }.enumerated().filter { $0.offset % 4 == 0 }.map { $0.element.x }) { value in
                        AxisValueLabel {
                            if let day = value.as(Int.self) { Text(shortAxisLabel(day)).font(.caption2) }
                        }
                    }
                } else {
                AxisMarks(values: .automatic(desiredCount: 3)) { value in
                    AxisTick()
                    AxisValueLabel {
                        if let x = value.as(Int.self) {
                            Text(axis == .weekday ? StatsDisplay.weekday(x) : axis == .day ? "\(x)" : shortAxisLabel(x)).font(.caption2)
                        }
                    }
                }
                }
            }
            .chartYAxis {
                if style == .consistency { AxisMarks(position: .leading, values: [0, 7]) }
                else { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) }
            }
            .chartLegend(position: .bottom, alignment: .leading)
            .chartLegend(series.count > 1 && !compact ? .visible : .hidden)
            .padding(.trailing, style == .lines ? endpointPadding : 0)
            .chartXSelection(value: $selectedX)
            .statsExpansionHeight(expanded: expanded, compact: compact ? height * 110 / 130 : height, detail: max(240, height))
            .accessibilityHint(style == .volume ? "Last week is incomplete. Dashed line: four-week average of full weeks." : "")
            .overlay(alignment: .topLeading) { selectionOverlay }
            if style == .lines {
                Text(band?.label ?? "Historical band needs 2 completed periods")
                    .font(.caption2).foregroundStyle(.secondary)
                    .accessibilityLabel(bandDescription)
            }
        }
    }
    private var bandDescription: String {
        guard let band else { return "Historical band needs 2 completed periods" }
        let kind = band.monthly ? "5th–95th percentile" : "Minimum–maximum"
        return "\(kind) of \(band.count) completed \(band.monthly ? "months" : "years"), \(StatsDisplay.date(band.first)) to \(StatsDisplay.date(band.last)). Current period excluded."
    }
    private func bandValue(_ point: StatsComparisonBand.Point) -> String {
        "\(StatsDisplay.measurement(point.low, metric: metric)) to \(StatsDisplay.measurement(point.high, metric: metric)), \(point.count) \(band?.monthly == true ? "months" : "years")"
    }
    @ChartContentBuilder private var historicalArea: some ChartContent {
        if let band {
            ForEach(band.points) { point in
                AreaMark(x: .value("Period", point.x), yStart: .value("Historical low", point.low), yEnd: .value("Historical high", point.high))
                    .foregroundStyle(Color.secondary.opacity(0.13))
                    .accessibilityLabel("\(label(point.x)), historical \(band.monthly ? "5th–95th percentile" : "minimum–maximum")")
                    .accessibilityValue(bandValue(point))
            }
        }
    }
    @ViewBuilder private var selectionOverlay: some View {
        if !selected.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(selected) { point in
                    Text("\(point.series) · \(label(point.x)): \(value(point))\(point.partial ? " · incomplete" : "")")
                        .font(.caption).fixedSize(horizontal: false, vertical: true)
                }
                if let band, let point = band.points.first(where: { $0.x == selected.first?.x }) {
                    Text("Historical \(band.monthly ? "5–95%" : "min–max"): \(bandValue(point))")
                        .font(.caption).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
            .allowsHitTesting(false)
        }
    }
    private func isReference(_ point: StatsChartPoint) -> Bool {
        style == .lines && point.series != series.first
    }
    private var endpoints: [StatsChartPoint] {
        series.compactMap { name in points.last { $0.series == name && $0.value != nil } }
    }
    private var endpointLabelsOverlap: Bool {
        guard endpoints.count == 2, let first = endpoints[0].value, let last = endpoints[1].value else { return false }
        return abs(first - last) / maximum < 0.13 && abs(endpoints[0].x - endpoints[1].x) < (axis == .year ? 40 : 4)
    }
    private var comparisonTicks: [Int] {
        axis == .day ? [1, 8, 15, 22, 29] : [1, 4, 7, 10].map { StatsDates.start(year: 2000, month: $0) - StatsDates.start(year: 2000) }
    }
    private var xDomain: ClosedRange<Double> {
        if axis == .year { return 0...365 }
        if axis == .day { return 0...31 }
        let first = points.map(\.x).min() ?? 0, last = points.map(\.x).max() ?? 1
        return (Double(first) - (axis == .weekday ? 0.5 : 0))...(Double(max(first + 1, last)) + (axis == .weekday ? 0.5 : 0))
    }
    private func shortAxisLabel(_ x: Int) -> String {
        let day = axis == .year ? StatsDates.start(year: 2000) + x : x
        return StatsDates.date(day).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated).day())
    }
}

/// Equal-width calendar buckets keep monthly bars legible at phone widths.
struct StatsPeriodBars: View {
    let points: [StatsChartPoint]
    let expanded: Bool
    @State private var selectedIndex: Int?
    @ScaledMetric private var overviewHeight = 110.0
    private var maximum: Double { max(1, points.compactMap(\.value).max() ?? 0) * 1.08 }
    private var ticks: [Int] {
        Array(stride(from: 0, to: points.count, by: max(1, Int(ceil(Double(points.count) / (expanded ? 6 : 4))))))
    }
    private func dateLabel(_ index: Int, full: Bool = false) -> String {
        let date = StatsDates.date(points[index].x)
        if full { return StatsDisplay.date(points[index].x) }
        let format = Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated)
        return date.formatted(format)
    }
    private func valueLabel(_ value: Double) -> String {
        "\(StatsDisplay.number(value, decimals: 1)) m / km"
    }
    var body: some View { chart }
    private var chart: some View {
        Chart {
            ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                RectangleMark(xStart: .value("Start", Double(index) - 0.34), xEnd: .value("End", Double(index) + 0.34),
                              yStart: .value("Baseline", 0.0), yEnd: .value("Value", point.value ?? 0))
                    .foregroundStyle(Color.primary.opacity(point.partial ? 0.85 : 0.28))
                    .accessibilityLabel("\(dateLabel(index, full: true))\(point.partial ? ", incomplete" : "")")
                    .accessibilityValue(valueLabel(point.value ?? 0))
            }
            if let selectedIndex, points.indices.contains(selectedIndex) {
                RuleMark(x: .value("Selected", selectedIndex)).foregroundStyle(.secondary.opacity(0.5))
            }
        }
        .chartXScale(domain: -0.5...Double(max(0, points.count - 1)) + 0.5)
        .chartYScale(domain: 0...maximum)
        .chartXAxis {
            AxisMarks(values: ticks) { value in
                AxisValueLabel { if let index = value.as(Int.self), points.indices.contains(index) { Text(dateLabel(index)).font(.caption2) } }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine()
                AxisValueLabel { if let y = value.as(Double.self) { Text(y >= 1000 ? "\(StatsDisplay.number(y / 1000, decimals: y.truncatingRemainder(dividingBy: 1000) == 0 ? 0 : 1))k" : StatsDisplay.number(y)).font(.caption2) } }
            }
        }
        .chartXSelection(value: $selectedIndex)
        .statsExpansionHeight(expanded: expanded, compact: overviewHeight, detail: max(240, overviewHeight))
        .overlay(alignment: .topLeading) {
            if let selectedIndex, points.indices.contains(selectedIndex) {
                let point = points[selectedIndex]
                Text("\(dateLabel(selectedIndex, full: true)): \(valueLabel(point.value ?? 0))\(point.partial ? " · incomplete" : "")")
                    .font(.caption).padding(8).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .allowsHitTesting(false)
            }
        }
    }
}

import Charts
import SwiftUI

/// One selectable column of an explorer's bar panel: a day, month, week or year.
/// `x1`/`x2` place it on the same numeric axis as the cumulative lines above.
struct StatsExplorerColumn: Identifiable {
    let key: Int
    /// Spoken and shown in readouts, e.g. "Week of 12 Oct".
    let label: String
    /// Short axis label, e.g. "Oct".
    let tickLabel: String
    let x1: Double
    let x2: Double
    let values: [ActivityCategory: Double]
    /// The comparison period's totals; drawn as a faded bar beside the current one.
    var previous: [ActivityCategory: Double]? = nil
    var incomplete = false
    /// A day that has not happened yet: drawn faintly and not selectable.
    var disabled = false
    var id: Int { key }
    var total: Double { values.values.reduce(0, +) }
    var previousTotal: Double? { previous.map { $0.values.reduce(0, +) } }
}

struct StatsExplorerLine: Identifiable {
    let key: String
    let label: String
    let current: Bool
    let points: [(x: Double, y: Double)]
    var id: String { key }
}

struct StatsExplorerBandPoint: Identifiable {
    let x: Double
    let low: Double
    let high: Double
    var id: Double { x }
}

struct StatsExplorerTick: Identifiable {
    let x: Double
    let label: String
    var id: Double { x }
}

/// Cumulative comparison lines above the periods that produce them, on one
/// shared x axis, with the explorer's selection marked in both panels. The
/// panels are separate charts so each keeps its own y scale and native axis;
/// fixed-width axis labels keep their plot areas aligned.
struct StatsExplorerChart: View {
    var lineTitle: String? = nil
    var barTitle: String? = nil
    var lines: [StatsExplorerLine] = []
    var band: [StatsExplorerBandPoint] = []
    let columns: [StatsExplorerColumn]
    let domain: ClosedRange<Double>
    let ticks: [StatsExplorerTick]
    let selected: Int?
    let select: (Int) -> Void
    /// Dashed neutral line over the bars, e.g. the four-period average.
    var trend: [(x: Double, y: Double)] = []
    var boundary: (x: Double, label: String)? = nil
    var futureLabel: String? = nil
    var comparisonLabel: String? = nil
    let formatValue: (Double) -> String
    /// A canonical value and the canonical interval between its axis ticks.
    let formatAxis: (Double, Double) -> String
    var barHeight: Double = 150
    var lineHeight: Double = 190

    @State private var selectedX: Double?
    @ScaledMetric(relativeTo: .caption2) private var axisLabelWidth = 38.0
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.layoutDirection) private var layoutDirection

    /// The chart's own labels stop growing early; headings, lists and controls scale fully.
    private var scale: Double { typeSize.isAccessibilitySize ? 1.3 : 1 }
    private var lineMaximum: Double {
        max(1, lines.flatMap { $0.points.map(\.y) }.max() ?? 0, band.map(\.high).max() ?? 0) * 1.06
    }
    private var barMaximum: Double {
        max(1, columns.flatMap { [$0.total, $0.previousTotal ?? 0] }.max() ?? 0, trend.map(\.y).max() ?? 0) * 1.08
    }
    private var selectedColumn: StatsExplorerColumn? { columns.first { $0.key == selected } }
    private var selectedCenter: Double? { selectedColumn.map { ($0.x1 + $0.x2) / 2 } }
    private let sports = ActivityCategory.allCases
    /// The axis always names the selected period, dropping a neighbouring label it would touch.
    private var axisTickItems: [StatsExplorerTick] {
        // Large text leaves room for about three labels across the plot.
        let stride = typeSize.isAccessibilitySize ? max(1, Int((Double(ticks.count) / 3).rounded(.up))) : 1
        let base = ticks.enumerated().filter { $0.offset % stride == 0 }.map(\.element)
        guard let center = selectedCenter, let column = selectedColumn, !base.contains(where: { $0.x == center }) else { return base }
        let gap = (domain.upperBound - domain.lowerBound) * (typeSize.isAccessibilitySize ? 0.25 : 0.12)
        return (base.filter { abs($0.x - center) >= gap } + [StatsExplorerTick(x: center, label: column.tickLabel)]).sorted { $0.x < $1.x }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !lines.isEmpty {
                if let lineTitle { Text(lineTitle).font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader) }
                lineChart.frame(height: lineHeight * scale).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                if let barTitle { Text(barTitle).font(.subheadline.weight(.semibold)).padding(.top, 8).accessibilityAddTraits(.isHeader) }
            }
            barChart.frame(height: barHeight * scale).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        }
        .onChange(of: selectedX) { _, x in if let x { selectNearest(x) } }
    }

    private func selectNearest(_ x: Double) {
        guard let nearest = columns.filter({ !$0.disabled })
            .min(by: { abs(($0.x1 + $0.x2) / 2 - x) < abs(($1.x1 + $1.x2) / 2 - x) }) else { return }
        if nearest.key != selected { select(nearest.key) }
    }

    /// Swift Charts' own x-selection starts on press-and-hold. A plain tap selects too,
    /// without taking vertical drags away from the page's scroll view.
    private func tapLayer(_ proxy: ChartProxy) -> some View {
        GeometryReader { geometry in
            Color.clear.contentShape(Rectangle())
                .gesture(SpatialTapGesture().onEnded { tap in
                    guard let plot = proxy.plotFrame,
                          let x: Double = proxy.value(atX: tap.location.x - geometry[plot].origin.x) else { return }
                    selectNearest(x)
                })
        }
    }

    // MARK: Axes

    private func axisTicks(_ maximum: Double, count: Int) -> [Double] { StatsDisplay.axisTicks(maximum: maximum, count: count) }
    @AxisContentBuilder private func yAxis(maximum: Double, count: Int) -> some AxisContent {
        let values = axisTicks(maximum, count: count)
        let step = values.count > 1 ? values[1] - values[0] : 1
        AxisMarks(position: .leading, values: values) { tick in
            AxisGridLine()
            AxisValueLabel {
                if let value = tick.as(Double.self) {
                    Text(formatAxis(value, step)).font(.caption2)
                        .frame(width: axisLabelWidth, alignment: .trailing)
                        .minimumScaleFactor(0.7).lineLimit(1)
                }
            }
        }
    }
    @AxisContentBuilder private var xAxis: some AxisContent {
        AxisMarks(values: axisTickItems.map(\.x)) { tick in
            AxisValueLabel(anchor: .top) {
                if let x = tick.as(Double.self), let item = axisTickItems.first(where: { $0.x == x }) {
                    Text(item.label).font(.caption2).foregroundStyle(x == selectedCenter ? AnyShapeStyle(AppTheme.accent) : AnyShapeStyle(.secondary))
                        .fontWeight(x == selectedCenter ? .semibold : .regular)
                }
            }
        }
    }

    // MARK: Lines

    private var lineChart: some View {
        Chart {
            if let boundary { boundaryRule(boundary, label: true) }
            ForEach(band) { point in
                AreaMark(x: .value("Day", point.x), yStart: .value("Low", point.low), yEnd: .value("High", point.high), series: .value("Series", "Historical range"))
                    .foregroundStyle(Color.secondary.opacity(0.14))
                    .accessibilityHidden(true)
            }
            ForEach(lines) { line in
                ForEach(Array(line.points.enumerated()), id: \.offset) { _, point in
                    LineMark(x: .value("Day", point.x), y: .value("Total", point.y), series: .value("Series", line.key))
                        .foregroundStyle(line.current ? Color.primary : Color.secondary)
                        .lineStyle(StrokeStyle(lineWidth: line.current ? 3 : 1.6, dash: line.current ? [] : [5, 4]))
                        .accessibilityLabel(line.label)
                        .accessibilityValue(formatValue(point.y))
                }
                if let last = line.points.last {
                    PointMark(x: .value("Day", last.x), y: .value("Total", last.y))
                        .symbolSize(line.current ? 50 : 0)
                        .foregroundStyle(Color.primary)
                        .annotation(position: annotationPosition(line, last: last), spacing: 3,
                                    overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                            Text(line.current ? "\(line.label) · \(formatValue(last.y))" : line.label)
                                .font(.caption2.weight(line.current ? .semibold : .regular))
                                .foregroundStyle(line.current ? Color.primary : Color.secondary)
                        }
                        .accessibilityHidden(true)
                }
            }
            if let selectedCenter { cursor(selectedCenter) }
        }
        .chartXScale(domain: domain)
        .chartYScale(domain: 0...lineMaximum)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis(maximum: lineMaximum, count: 3) }
        .chartLegend(.hidden)
        .chartXSelection(value: $selectedX)
        .chartOverlay { tapLayer($0) }
    }

    /// The current line's label sits on the side away from the comparison line.
    private func annotationPosition(_ line: StatsExplorerLine, last: (x: Double, y: Double)) -> AnnotationPosition {
        let others = lines.filter { $0.key != line.key }.compactMap(\.points.last)
        guard let other = others.first, abs(other.x - last.x) < (domain.upperBound - domain.lowerBound) * 0.25,
              abs(other.y - last.y) / lineMaximum < 0.2 else { return .top }
        return (last.y >= other.y) == line.current ? .top : .bottom
    }

    // MARK: Bars

    private var barChart: some View {
        Chart {
            if let boundary, boundary.x < domain.upperBound {
                RectangleMark(xStart: .value("From", boundary.x), xEnd: .value("To", domain.upperBound),
                              yStart: .value("Bottom", 0), yEnd: .value("Top", barMaximum))
                    .foregroundStyle(Color.primary.opacity(0.06))
                    .accessibilityHidden(true)
                boundaryRule(boundary, label: lines.isEmpty)
            }
            if let selectedColumn {
                RectangleMark(xStart: .value("From", selectedColumn.x1), xEnd: .value("To", selectedColumn.x2),
                              yStart: .value("Bottom", 0), yEnd: .value("Top", barMaximum))
                    .foregroundStyle(AppTheme.accent.opacity(0.1))
                    .accessibilityHidden(true)
            }
            ForEach(columns) { column in
                let padding = (column.x2 - column.x1) * 0.14
                let paired = column.previous != nil
                let width = (column.x2 - column.x1 - padding * 2) / (paired ? 2 : 1)
                let opacity = column.disabled ? 0.15 : column.incomplete ? 0.55 : 0.92
                stack(column.values, column: column, x: column.x1 + padding, width: width, opacity: opacity, previous: false)
                if let previous = column.previous {
                    stack(previous, column: column, x: column.x1 + padding + width, width: width, opacity: 0.3, previous: true)
                }
                // One spoken value per column; the sport split lives in the data table.
                RectangleMark(xStart: .value("From", column.x1), xEnd: .value("To", column.x2),
                              yStart: .value("Bottom", 0), yEnd: .value("Top", max(column.total, column.previousTotal ?? 0, barMaximum * 0.02)))
                    .foregroundStyle(.clear)
                    .accessibilityLabel(columnLabel(column))
                    .accessibilityValue(column.disabled ? "Upcoming" : formatValue(column.total))
            }
            if !trend.isEmpty {
                ForEach(Array(trend.enumerated()), id: \.offset) { _, point in
                    LineMark(x: .value("Period", point.x), y: .value("Average", point.y), series: .value("Series", "Trend"))
                        .foregroundStyle(Color.primary)
                        .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                        .accessibilityHidden(true)
                }
            }
            if let selectedCenter, !lines.isEmpty { cursor(selectedCenter) }
        }
        .chartXScale(domain: domain)
        .chartYScale(domain: 0...barMaximum)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis(maximum: barMaximum, count: 2) }
        .chartLegend(.hidden)
        .chartXSelection(value: $selectedX)
        .chartOverlay { tapLayer($0) }
    }

    private func columnLabel(_ column: StatsExplorerColumn) -> String {
        var label = column.label
        if let previous = column.previousTotal, let comparisonLabel { label += "; \(comparisonLabel) \(formatValue(previous))" }
        if column.incomplete { label += "; incomplete" }
        if selected == column.key { label += "; selected" }
        return label
    }

    @ChartContentBuilder private func stack(_ values: [ActivityCategory: Double], column: StatsExplorerColumn,
                                            x: Double, width: Double, opacity: Double, previous: Bool) -> some ChartContent {
        let ordered = sports.map { ($0, values[$0] ?? 0) }
        ForEach(ordered.indices, id: \.self) { index in
            let (sport, value) = ordered[index]
            if value > 0 {
                let base = ordered[..<index].reduce(0) { $0 + $1.1 }
                RectangleMark(xStart: .value("From", x), xEnd: .value("To", x + width),
                              yStart: .value("Lower", base), yEnd: .value("Upper", base + value))
                    .foregroundStyle(sport.color.opacity(opacity))
                    .accessibilityHidden(true)
            }
        }
    }

    @ChartContentBuilder private func boundaryRule(_ boundary: (x: Double, label: String), label: Bool) -> some ChartContent {
        RuleMark(x: .value("Reporting date", boundary.x))
            .foregroundStyle(Color.secondary.opacity(0.5))
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 4]))
            .annotation(position: .top, alignment: boundary.x < (domain.lowerBound + domain.upperBound) / 2 ? .leading : .trailing,
                        spacing: 2, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                if label { Text(boundary.label).font(.caption2).foregroundStyle(.secondary) }
            }
            .accessibilityHidden(true)
    }

    @ChartContentBuilder private func cursor(_ x: Double) -> some ChartContent {
        RuleMark(x: .value("Selected", x))
            .foregroundStyle(Color.secondary.opacity(0.35))
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            .accessibilityHidden(true)
    }
}

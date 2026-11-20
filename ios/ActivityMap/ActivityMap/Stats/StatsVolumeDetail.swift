import Charts
import SwiftUI

extension StatsHistoryRange {
    var label: String {
        switch self { case .weeks: "By week"; case .months: "By month"; case .years: "By year" }
    }
    var period: String {
        switch self { case .weeks: "week"; case .months: "month"; case .years: "year" }
    }
    var totalLabel: String { self == .years ? "over all years" : "over 12 \(rawValue)" }
}

/// The dashboard card's twelve-week trend. The expanded page is
/// `StatsVolumeExplorer`; the groupings are calculated with the tile's metric
/// on the background stats executor.
struct StatsVolumeDetail<CompactSummary: View>: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    let history: [StatsHistoryRange: [StatsHistoryBucket]]
    let averages: [StatsHistoryRange: [StatsPoint]]
    let metric: StatsMetric
    @Binding var range: StatsHistoryRange
    private var buckets: [StatsHistoryBucket] { history[.weeks] ?? [] }
    @State private var selectedX: Double?
    @ViewBuilder let compactSummary: () -> CompactSummary
    private var trend: [StatsPoint] { averages[.weeks] ?? [] }
    @ScaledMetric private var compactHeight = 110.0
    /// Clears the leading y-axis labels for text drawn over the plot.
    @ScaledMetric(relativeTo: .caption2) private var yAxisInset = 40.0
    private var sports: [ActivityCategory] {
        ActivityCategory.allCases.filter { sport in buckets.contains { ($0.bySport[sport] ?? 0) > 0 } }
    }
    private var axisTicks: [Double] { StatsDisplay.axisTicks(maximum: maximum) }
    private var axisStep: Double { axisTicks.count > 1 ? metric.displayValue(axisTicks[1] - axisTicks[0], units: units) : 1 }
    private var maximum: Double { max(1, max(buckets.map(\.total).max() ?? 1, trend.map(\.y).max() ?? 0)) * 1.08 }
    private func lower(_ bucket: StatsHistoryBucket, _ sport: ActivityCategory) -> Double {
        sports.prefix(while: { $0 != sport }).reduce(0) { $0 + (bucket.bySport[$1] ?? 0) }
    }
    private var selected: Int? {
        selectedX.map { min(max(0, Int($0.rounded())), max(0, buckets.count - 1)) }
    }
    private func label(_ day: Int) -> String { "Week of \(StatsDisplay.shortDate(day, locale: locale))" }
    /// Every fourth week back from the latest bucket.
    private var ticks: [Int] {
        guard !buckets.isEmpty else { return [] }
        return Array(stride(from: buckets.count - 1, through: 0, by: -4)).reversed()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            compactSummary().padding(.bottom, 12)
            chart
        }
        .onChange(of: metric) { selectedX = nil }
    }

    private var chart: some View {
        Chart {
            ForEach(0..<max(1, buckets.count - 1), id: \.self) { segment in
                ForEach(sports) { sport in
                    ForEach(segmentIndices(segment), id: \.self) { index in
                        band(sport: sport, index: index, segment: segment)
                    }
                }
                ForEach(segmentIndices(segment), id: \.self) { index in
                    LineMark(x: .value("Period", Double(index)), y: .value("Total", buckets[index].total),
                             series: .value("Line", "Total-\(segment)"))
                        .foregroundStyle(segmentIncomplete(segment) ? Color.secondary : Color.primary)
                        .lineStyle(.init(lineWidth: segmentIncomplete(segment) ? 1 : 2, dash: segmentIncomplete(segment) ? [2, 3] : []))
                        .accessibilityLabel("\(label(buckets[index].start))\(buckets[index].incomplete ? ", incomplete" : "")")
                        .accessibilityValue(StatsDisplay.measurement(buckets[index].total, metric: metric, units: units, locale: locale))
                }
            }
            ForEach(Array(trend.enumerated()), id: \.offset) { _, point in
                if let index = buckets.firstIndex(where: { $0.start == point.x }) {
                    // Neutral like the web; the chart names it in its top corner.
                    LineMark(x: .value("Period", Double(index)), y: .value("Average", point.y), series: .value("Line", "Average"))
                        .foregroundStyle(Color.secondary).lineStyle(.init(lineWidth: 1.5, dash: [4, 3]))
                        .accessibilityLabel("4-week average, \(label(point.x))")
                        .accessibilityValue(StatsDisplay.measurement(point.y, metric: metric, units: units, locale: locale))
                }
            }
            if let selected {
                RuleMark(x: .value("Selected", Double(selected))).foregroundStyle(.secondary)
            }
        }
        .chartXScale(domain: -0.5...(Double(max(1, buckets.count)) - 0.5))
        .chartYScale(domain: 0...maximum)
        .chartXAxis {
            AxisMarks(values: ticks) { value in
                if let index = value.as(Int.self), buckets.indices.contains(index) {
                    // Labels start at their period; the latest one ends at its point.
                    AxisValueLabel(anchor: index == buckets.count - 1 ? .topTrailing : .topLeading) {
                        Text(StatsDisplay.shortDate(buckets[index].start, locale: locale))
                    }.font(.caption2)
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: axisTicks) { tick in
                AxisGridLine()
                AxisValueLabel {
                    if let value = tick.as(Double.self) { Text(StatsDisplay.compactAxis(metric.displayValue(value, units: units), step: axisStep, locale: locale)) }
                }
            }
        }
        .chartLegend(.hidden)
        .chartXSelection(value: $selectedX)
        .frame(height: compactHeight)
        .overlay(alignment: .topLeading) {
            if selected == nil && !trend.isEmpty {
                Text("4-wk avg").font(.caption2).foregroundStyle(.secondary)
                    .padding(.leading, yAxisInset).offset(y: -2).accessibilityHidden(true)
            }
        }
        .overlay(alignment: .topLeading) {
            if let selected, buckets.indices.contains(selected) {
                let bucket = buckets[selected]
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(label(bucket.start))\(bucket.incomplete ? " · incomplete" : "")")
                    Text("Total: \(StatsDisplay.measurement(bucket.total, metric: metric, units: units, locale: locale))").bold()
                }
                .font(.caption).padding(8)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                .allowsHitTesting(false)
            }
        }
    }

    private func segmentIndices(_ segment: Int) -> [Int] {
        guard !buckets.isEmpty else { return [] }
        return buckets.count == 1 ? [0] : [segment, segment + 1]
    }
    private func segmentIncomplete(_ segment: Int) -> Bool {
        segmentIndices(segment).contains { buckets[$0].incomplete }
    }

    @ChartContentBuilder private func band(sport: ActivityCategory, index: Int, segment: Int) -> some ChartContent {
        let bucket = buckets[index]
        let low = lower(bucket, sport)
        let value = bucket.bySport[sport] ?? 0
        let partial = segmentIncomplete(segment)
        let description = "\(sport.name), \(label(bucket.start))\(bucket.incomplete ? ", incomplete" : "")"
        // A single period still needs a visible band; equal endpoints avoid
        // inventing a second one while preserving its actual value.
        ForEach(buckets.count == 1 ? [-0.35, 0.35] : [Double(index)], id: \.self) { x in
            AreaMark(x: .value("Period", x),
                     yStart: .value("Lower", low), yEnd: .value("Upper", low + value),
                     series: .value("Layer", "\(sport.rawValue)-\(segment)"))
                .foregroundStyle(Color.primary.opacity(partial ? 0.04 : 0.12))
                .accessibilityLabel(description)
                .accessibilityHidden(true)
        }
    }
}

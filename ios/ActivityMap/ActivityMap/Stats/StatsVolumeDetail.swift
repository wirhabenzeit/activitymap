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

/// Groupings are calculated with the tile's metric on the background stats
/// executor. Switching grouping only selects an already-paired result.
struct StatsVolumeDetail<CompactSummary: View>: View {
    let history: [StatsHistoryRange: [StatsHistoryBucket]]
    let averages: [StatsHistoryRange: [StatsPoint]]
    let metric: StatsMetric
    @Binding var range: StatsHistoryRange
    private var shownRange: StatsHistoryRange { expanded ? range : .weeks }
    private var buckets: [StatsHistoryBucket] { history[shownRange] ?? [] }
    @State private var selectedX: Double?
    @State var showTotals = false
    @State private var width: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var typeSize
    private var wide: Bool { expanded && width >= 760 && !typeSize.isAccessibilitySize }
    private var sideBySide: Bool { wide && width >= 1000 }
    @Environment(\.statsTileInspection) private var inspection
    private var totalsSelection: Binding<Bool> {
        if let inspection {
            return Binding(get: { inspection.volumeTotals }, set: { inspection.volumeTotals = $0 })
        }
        return $showTotals
    }
    var expanded = true
    @Environment(\.statsExpansionProgress) private var sharedProgress
    @Environment(\.statsDetailHeightLimit) private var shortViewportLimit
    private var progress: Double { sharedProgress ?? (expanded ? 1 : 0) }
    @ViewBuilder let compactSummary: () -> CompactSummary
    private var trend: [StatsPoint] { averages[shownRange] ?? [] }
    private var averageLabel: String { "4-\(shownRange.period) average" }
    @ScaledMetric private var height = 240.0
    @ScaledMetric private var compactHeight = 110.0
    /// Clears the leading y-axis labels for text drawn over the plot.
    @ScaledMetric(relativeTo: .caption2) private var yAxisInset = 40.0
    private var sports: [ActivityCategory] {
        ActivityCategory.allCases.filter { sport in buckets.contains { ($0.bySport[sport] ?? 0) > 0 } }
    }
    private var maximum: Double { max(1, max(buckets.map(\.total).max() ?? 1, trend.map(\.y).max() ?? 0)) * 1.08 }
    private func lower(_ bucket: StatsHistoryBucket, _ sport: ActivityCategory) -> Double {
        sports.prefix(while: { $0 != sport }).reduce(0) { $0 + (bucket.bySport[$1] ?? 0) }
    }
    private var selected: Int? {
        selectedX.map { min(max(0, Int($0.rounded())), max(0, buckets.count - 1)) }
    }
    private func label(_ day: Int) -> String {
        switch shownRange {
        case .weeks: "Week of \(StatsDisplay.shortDate(day))"
        case .months: StatsDisplay.month(day)
        case .years: String(StatsDates.parts(day).year!)
        }
    }
    /// Whole periods back from the latest bucket: every fourth week, every
    /// third month, and about four labels across the years.
    private var ticks: [Int] {
        guard !buckets.isEmpty else { return [] }
        let step = switch shownRange {
        case .weeks: 4
        case .months: 3
        case .years: max(1, Int((Double(buckets.count) / 4).rounded(.up)))
        }
        return Array(stride(from: buckets.count - 1, through: 0, by: -step)).reversed()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StatsExpansionReveal(expanded: !expanded, inverted: true) {
                compactSummary().padding(.bottom, 12)
            }
            StatsExpansionReveal(expanded: expanded) {
                expandedHeader.padding(.bottom, 12)
            }
            let layout = sideBySide ? AnyLayout(HStackLayout(alignment: .top, spacing: 24)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            layout {
                chart.frame(maxWidth: .infinity)
                StatsExpansionReveal(expanded: expanded) {
                    expandedFooter.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onChange(of: range) { selectedX = nil }
        .onChange(of: metric) { selectedX = nil }
        .onChange(of: expanded) { selectedX = nil }
    }

    private var expandedHeader: some View {
        // iPhone landscape: grouping, total and range share one row when they fit.
        ViewThatFits(in: .horizontal) {
            if shortViewportLimit != nil {
                HStack(alignment: .center, spacing: 12) {
                    groupingPicker.fixedSize()
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) { total; dateRange }.fixedSize()
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                groupingPicker
                dateRange
                total
            }
        }
    }
    private var groupingPicker: some View {
        StatsRangePicker(title: "Volume grouping", ranges: StatsHistoryRange.allCases,
                         selection: $range, label: \.label)
    }
    @ViewBuilder private var dateRange: some View {
        if let first = buckets.first, let last = buckets.last {
            Text("\(StatsDisplay.date(first.start)) – \(StatsDisplay.date(last.end))")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
    @ViewBuilder private var total: some View {
        if !buckets.isEmpty {
            Text("\(Text(StatsDisplay.measurement(buckets.reduce(0) { $0 + $1.total }, metric: metric)).font(.title2.weight(.semibold))) \(Text(shownRange.totalLabel).font(.caption).foregroundColor(.secondary))")
                .monospacedDigit()
        }
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
                        .foregroundStyle(segmentIncomplete(segment) ? Color.secondary.opacity(1 - 0.5 * progress) : Color.primary.opacity(1 - 0.4 * progress))
                        .lineStyle(.init(lineWidth: segmentIncomplete(segment) ? 1 : 2 - progress,
                                         dash: segmentIncomplete(segment) ? [2, 3] : []))
                        .accessibilityLabel("\(label(buckets[index].start))\(buckets[index].incomplete ? ", incomplete" : "")")
                        .accessibilityValue(StatsDisplay.measurement(buckets[index].total, metric: metric))
                        .accessibilityHidden(expanded)
                }
            }
            ForEach(Array(trend.enumerated()), id: \.offset) { _, point in
                if let index = buckets.firstIndex(where: { $0.start == point.x }) {
                    // Neutral like the web; the collapsed chart names it in its top corner.
                    LineMark(x: .value("Period", Double(index)), y: .value("Average", point.y), series: .value("Line", "Average"))
                        .foregroundStyle(Color.secondary.mix(with: .primary, by: progress)).lineStyle(.init(lineWidth: 1.5, dash: [4, 3]))
                        .accessibilityLabel("\(averageLabel), \(label(point.x))")
                        .accessibilityValue(StatsDisplay.measurement(point.y, metric: metric))
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
                        switch shownRange {
                        case .weeks: Text(StatsDisplay.shortDate(buckets[index].start))
                        case .months: Text(StatsDates.date(buckets[index].start).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated)))
                        case .years: Text(label(buckets[index].start))
                        }
                    }.font(.caption2)
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { tick in
                AxisGridLine()
                AxisValueLabel {
                    if let value = tick.as(Double.self) { Text(StatsDisplay.value(value, metric: metric)) }
                }
            }
        }
        .chartLegend(.hidden)
        .chartXSelection(value: $selectedX)
        .statsExpansionHeight(expanded: expanded, compact: compactHeight, detail: height, fillsFocus: true)
        .overlay(alignment: .topLeading) {
            if !expanded && selected == nil && !trend.isEmpty {
                Text("4-wk avg").font(.caption2).foregroundStyle(.secondary)
                    .padding(.leading, yAxisInset).offset(y: -2).accessibilityHidden(true)
            }
        }
        .overlay(alignment: .topLeading) {
            if let selected, buckets.indices.contains(selected) {
                let bucket = buckets[selected]
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(label(bucket.start))\(bucket.incomplete ? " · incomplete" : "")")
                    Text("Total: \(StatsDisplay.measurement(bucket.total, metric: metric))").bold()
                    if expanded {
                        ForEach(sports) { sport in
                            Text("\(sport.name): \(StatsDisplay.measurement(bucket.bySport[sport] ?? 0, metric: metric))")
                        }
                    }
                }
                .font(.caption).padding(8)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                .allowsHitTesting(false)
            }
        }
    }

    private var expandedFooter: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !trend.isEmpty {
                Text("Dashed: \(averageLabel)").font(.caption).foregroundStyle(.secondary)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { legend }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)]) { legend }
            }
            if wide {
                Text("Period totals").font(.subheadline.weight(.semibold))
                periodTotals
            } else {
                DisclosureGroup("Period totals", isExpanded: totalsSelection) { periodTotals }.font(.caption)
            }
        }
    }
    private var periodTotals: some View {
                ScrollView(.horizontal) {
                    Grid(alignment: .trailing, horizontalSpacing: 16, verticalSpacing: 10) {
                        GridRow {
                            Text(shownRange.period.capitalized).gridColumnAlignment(.leading)
                            ForEach(sports) { sport in Text(sport.name) }
                            Text("Total")
                        }.fontWeight(.semibold).accessibilityAddTraits(.isHeader)
                        ForEach(buckets.indices, id: \.self) { index in
                            let bucket = buckets[index]
                            GridRow {
                                Text("\(label(bucket.start))\(bucket.incomplete ? " · incomplete" : "")")
                                ForEach(sports) { sport in
                                    Text(StatsDisplay.measurement(bucket.bySport[sport] ?? 0, metric: metric))
                                        .accessibilityLabel("\(sport.name), \(label(bucket.start))")
                                }
                                Text(StatsDisplay.measurement(bucket.total, metric: metric)).fontWeight(.semibold)
                            }
                            .accessibilityElement(children: .combine)
                            .accessibilityHint(bucket.incomplete ? "Incomplete \(shownRange.period)" : "")
                        }
                    }
                    .font(.caption).monospacedDigit().fixedSize(horizontal: true, vertical: false).padding(.vertical, 8)
                }
                .accessibilityLabel("Period totals by sport")
    }
    private func segmentIndices(_ segment: Int) -> [Int] {
        guard !buckets.isEmpty else { return [] }
        return buckets.count == 1 ? [0] : [segment, segment + 1]
    }
    private func segmentIncomplete(_ segment: Int) -> Bool {
        segmentIndices(segment).contains { buckets[$0].incomplete }
    }

    // Keep the same area marks throughout expansion. Only their color and
    // chart geometry change with the shared animation progress.
    @ChartContentBuilder private func band(sport: ActivityCategory, index: Int, segment: Int) -> some ChartContent {
        let bucket = buckets[index]
        let low = lower(bucket, sport)
        let value = bucket.bySport[sport] ?? 0
        let partial = segmentIncomplete(segment)
        let description = "\(sport.name), \(label(bucket.start))\(bucket.incomplete ? ", incomplete" : "")"
        // A single year still needs a visible band; equal endpoints avoid
        // inventing a second period while preserving its actual value.
        ForEach(buckets.count == 1 ? [-0.35, 0.35] : [Double(index)], id: \.self) { x in
            AreaMark(x: .value("Period", x),
                     yStart: .value("Lower", low), yEnd: .value("Upper", low + value),
                     series: .value("Layer", "\(sport.rawValue)-\(segment)"))
                .foregroundStyle(Color.primary.opacity(partial ? 0.04 : 0.12)
                    .mix(with: sport.color.opacity(partial ? 0.35 : 1), by: progress))
                .accessibilityLabel(description)
                .accessibilityHidden(!expanded || (segment > 0 && index == segment))
                .accessibilityValue(StatsDisplay.measurement(value, metric: metric))
        }
    }

    private var legend: some View {
        ForEach(sports) { sport in
            HStack(spacing: 4) {
                Circle().fill(sport.color).frame(width: 7, height: 7)
                Text(sport.name).font(.caption)
            }
        }
    }
}

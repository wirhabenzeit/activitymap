import SwiftUI

/// The dashboard owns calculated values and tile choices. This shared surface
/// owns only title/period/control/content hierarchy; it introduces no analytics.
struct StatsTileSurface<Controls: View, Content: View>: View {
    let title: String
    let period: String
    var expand: (() -> Void)? = nil
    var expanded = false
    var compactHeader = false
    @ViewBuilder let controls: () -> Controls
    @ViewBuilder let content: () -> Content
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
            HStack(alignment: .firstTextBaseline, spacing: AppTheme.Spacing.small) {
                BrowseSectionHeading(title: title)
                Spacer(minLength: 0)
                if let expand {
                    BrowseIconButton(title: "\(expanded ? "Collapse" : "Expand") \(title)", systemImage: expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", action: expand)
                }
            }
            .frame(minHeight: AppTheme.minimumTarget)
            if compactHeader && !typeSize.isAccessibilitySize {
                ViewThatFits(in: .horizontal) {
                    HStack {
                        periodLabel.fixedSize()
                        Spacer(minLength: 8)
                        controls()
                    }
                    VStack(alignment: .leading, spacing: 4) { periodLabel; controls() }
                }
            } else {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.small) {
                    periodLabel
                    controls()
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .modifier(BrowseSurface())
        .clipShape(RoundedRectangle(cornerRadius: AppTheme.cornerRadius))

    }
    private var periodLabel: some View {
        Text(period).font(AppTheme.Typography.caption).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct StatsMetricPicker: View {
    let metrics: [StatsMetric]
    @Binding var selection: StatsMetric
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        StatsRangePicker(title: "Metric", ranges: metrics, selection: $selection,
                         label: { $0 == .count ? "#" : $0.definition.unit },
                         accessibilityLabel: { $0.definition.label })
            .frame(width: typeSize.isAccessibilitySize ? nil : CGFloat(metrics.count) * AppTheme.minimumTarget)
    }
}

struct StatsComparison: View {
    enum Direction { case higher, lower, unchanged }
    let value: String
    let context: String
    let direction: Direction

    private var symbol: String {
        switch direction {
        case .higher: "arrow.up"
        case .lower: "arrow.down"
        case .unchanged: "minus"
        }
    }

    var body: some View {
        // A direction describes a comparison, not success or failure. Keep
        // semantic text and a non-colour cue instead of red/green-only meaning.
        Label {
            Text("\(Text(value).fontWeight(.medium)) \(Text(context).foregroundStyle(.secondary))")
        } icon: {
            Image(systemName: symbol)
        }
        .font(AppTheme.Typography.caption)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(directionLabel): \(value) \(context)")
    }

    private var directionLabel: String {
        switch direction {
        case .higher: "Increase"
        case .lower: "Decrease"
        case .unchanged: "Unchanged"
        }
    }
}

/// Native range selection, with full labels and a menu at accessibility sizes.
/// Range meanings and their persistence remain with the dashboard/history.
struct StatsRangePicker<Range: Hashable>: View {
    let title: String
    let ranges: [Range]
    @Binding var selection: Range
    let label: (Range) -> String
    var accessibilityLabel: ((Range) -> String)? = nil
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if typeSize.isAccessibilitySize {
            picker.pickerStyle(.menu).frame(minHeight: AppTheme.minimumTarget)
        } else {
            picker.pickerStyle(.segmented).frame(minHeight: AppTheme.minimumTarget)
        }
    }

    private var picker: some View {
        Picker(title, selection: $selection) {
            ForEach(ranges, id: \.self) { range in
                Text(typeSize.isAccessibilitySize ? (accessibilityLabel?(range) ?? label(range)) : label(range))
                    .tag(range)
                    .accessibilityLabel(accessibilityLabel?(range) ?? label(range))
            }
        }
    }
}

enum StatsChartPalette {
    static let current = Color.primary
    static let comparison = Color.secondary
    static let reference = AppTheme.accent
    // Multi-sport charts keep catalogue colours, backed by sport symbols and
    // text in StatsSportLegend, rather than colouring their text labels.
    static func sport(_ category: ActivityCategory) -> Color { category.color }
}

struct StatsSportLegend: View {
    let categories: [ActivityCategory]
    var includesMixedSports = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        LazyVGrid(columns: typeSize.isAccessibilitySize
                  ? [GridItem(.flexible(), alignment: .leading)]
                  : [GridItem(.adaptive(minimum: 140), alignment: .leading)], alignment: .leading, spacing: AppTheme.Spacing.small) {
            ForEach(categories) { category in
                HStack(spacing: AppTheme.Spacing.small) {
                    BrowseSportSymbol(category: category)
                    Text(category.name).font(AppTheme.Typography.caption)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(category.name)
            }
            if includesMixedSports {
                Label("Multiple sports", systemImage: "square.stack.3d.up")
                    .font(AppTheme.Typography.caption)
            }
        }
    }
}

struct StatsSummaryItem: Identifiable {
    let label: String
    let value: String
    var color: Color? = nil
    var id: String { label }
}

struct StatsSummaryValues: View {
    let items: [StatsSummaryItem]
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 2) { label(item); Text(item.value).monospacedDigit() }
                }
            }.font(.subheadline)
        } else {
            HStack(alignment: .top, spacing: 8) {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        label(item)
                        Text(item.value).font(.subheadline.weight(.medium)).monospacedDigit().fixedSize(horizontal: false, vertical: true)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
    private func label(_ item: StatsSummaryItem) -> some View {
        HStack(spacing: 4) {
            if let color = item.color { RoundedRectangle(cornerRadius: 1).fill(color).frame(width: 7, height: 7) }
            Text(item.label).font(.caption2).foregroundStyle(.secondary)
        }.fixedSize(horizontal: false, vertical: true)
    }
}

struct StatsProjectionSummary: View {
    let pace: StatsPace
    let metric: StatsMetric
    let year: Int
    private var scale: Double { max(1, pace.projected, pace.current, pace.lastYear) }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 1).fill(.primary.opacity(0.25)).frame(width: 7, height: 7)
                Text("Projected").font(.caption2).foregroundStyle(.secondary)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Rectangle().fill(.primary.opacity(0.25)).frame(width: proxy.size.width * pace.projected / scale, height: 10)
                    Rectangle().fill(.primary).frame(width: proxy.size.width * pace.current / scale, height: 10)
                    if pace.lastYear > 0 {
                        Rectangle().fill(.orange).frame(width: 2, height: 16).offset(x: min(proxy.size.width - 2, proxy.size.width * pace.lastYear / scale))
                    }
                }.frame(height: 16)
            }.frame(height: 16).accessibilityHidden(true)
            StatsSummaryValues(items: [
                .init(label: "So far", value: StatsDisplay.measurement(pace.current, metric: metric), color: .primary),
                .init(label: "Daily average", value: "\(StatsDisplay.dailyRate(pace.perDay)) \(metric.definition.unit) / day"),
                .init(label: String(year - 1), value: pace.lastYear > 0 ? StatsDisplay.measurement(pace.lastYear, metric: metric) : "—", color: .orange),
            ])
        }
    }
}

struct StatsSportMixVisual: View {
    let shares: [StatsShare]
    let breakdown: [ActivityCategory: StatsTotals]
    let expanded: Bool
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { proxy in
                HStack(spacing: 2) {
                    ForEach(shares, id: \.sport) { share in
                        Rectangle().fill(share.sport.color)
                            .frame(width: max(0, proxy.size.width - CGFloat(max(0, shares.count - 1)) * 2) * share.share)
                    }
                }
            }.frame(height: 10).clipShape(RoundedRectangle(cornerRadius: 2)).accessibilityHidden(true)
            StatsExpansionReveal(expanded: expanded) {
                if typeSize.isAccessibilitySize { detailRows }
                else { ViewThatFits(in: .horizontal) { detailTable.fixedSize(horizontal: true, vertical: false); detailRows } }
            }
            StatsExpansionReveal(expanded: !expanded, inverted: true) {
                LazyVGrid(columns: typeSize.isAccessibilitySize ? [GridItem(.flexible(), alignment: .leading)] : [GridItem(.adaptive(minimum: 140), alignment: .leading)], alignment: .leading, spacing: 6) {
                    ForEach(shares, id: \.sport) { share in
                        HStack(spacing: 4) {
                            Circle().fill(share.sport.color).frame(width: 6, height: 6)
                            Text("\(share.sport.name) \(StatsDisplay.number(share.share * 100))%")
                        }.font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
    private var detailRows: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(shares, id: \.sport) { share in
                VStack(alignment: .leading, spacing: 8) {
                    HStack { sportLabel(share.sport); Spacer(); Text("\(StatsDisplay.number(share.share * 100))%").monospacedDigit() }.font(.subheadline.weight(.medium))
                    let totals = breakdown[share.sport] ?? StatsTotals()
                    LazyVGrid(columns: typeSize.isAccessibilitySize ? [GridItem(.flexible())] : [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 4) {
                        detailValue("Moving time", StatsDisplay.measurement(totals.time, metric: .time))
                        detailValue("Activities", StatsDisplay.number(totals.count))
                        detailValue("Distance", StatsDisplay.measurement(totals.distance, metric: .distance))
                        detailValue("Climb", StatsDisplay.measurement(totals.elevation, metric: .elevation))
                    }
                }
                Divider()
            }
        }
    }
    private func detailValue(_ label: String, _ value: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) { Text(label).foregroundStyle(.secondary); Spacer(minLength: 2); Text(value).monospacedDigit() }
            VStack(alignment: .leading, spacing: 2) { Text(label).foregroundStyle(.secondary); Text(value).monospacedDigit() }
        }.font(.caption2).frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
    }
    private func sportLabel(_ sport: ActivityCategory) -> some View {
        HStack(spacing: 6) { Circle().fill(sport.color).frame(width: 7, height: 7); Text(sport.name) }
    }
    private var detailTable: some View {
        Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 10) {
            GridRow { ForEach(["Sport", "Share", "Activities", "km", "m", "h"], id: \.self) { Text($0).foregroundStyle(.secondary) } }
            ForEach(shares, id: \.sport) { share in
                let totals = breakdown[share.sport] ?? StatsTotals()
                GridRow {
                    sportLabel(share.sport)
                    Text("\(StatsDisplay.number(share.share * 100))%")
                    Text(StatsDisplay.number(totals.count))
                    Text(StatsDisplay.number(totals.distance))
                    Text(StatsDisplay.number(totals.elevation))
                    Text(StatsDisplay.number(totals.time, decimals: totals.time < 10 ? 1 : 0))
                }
            }
        }.font(.caption).monospacedDigit()
    }
}

/// Reveal detail content in the space made available by the card animation.
/// The child remains mounted, retaining picker and disclosure state.
struct StatsExpansionReveal<Content: View>: View, Animatable {
    var progress: Double
    var inverted: Bool
    @Environment(\.statsExpansionProgress) private var sharedProgress
    @ViewBuilder let content: () -> Content

    init(expanded: Bool, inverted: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        progress = expanded ? 1 : 0
        self.inverted = inverted
        self.content = content
    }
    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }
    var body: some View {
        let progress = sharedProgress.map { inverted ? 1 - $0 : $0 } ?? progress
        StatsRevealLayout(progress: progress) {
            VStack(alignment: .leading, spacing: 8) { content() }
        }
            .opacity(max(0, min(1, (progress - 0.35) / 0.65)))
            .clipped()
            .allowsHitTesting(progress >= 0.99)
            .accessibilityHidden(progress < 0.99)
    }
}

private struct StatsRevealLayout: Layout {
    var progress: Double
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let size = subviews.first?.sizeThatFits(.init(width: proposal.width, height: nil)) ?? .zero
        return CGSize(width: size.width, height: size.height * max(0, min(1, progress)))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading,
                              proposal: .init(width: bounds.width, height: nil))
    }
}

private struct StatsExpansionProgressKey: EnvironmentKey {
    static let defaultValue: Double? = nil
}
extension EnvironmentValues {
    var statsExpansionProgress: Double? {
        get { self[StatsExpansionProgressKey.self] }
        set { self[StatsExpansionProgressKey.self] = newValue }
    }
}

/// Shared sizing for charts, calendar cells and any future compact/detail visual.
/// The section supplies the same progress used for the surrounding card geometry.
private struct StatsExpansionHeight: ViewModifier {
    let expanded: Bool
    let compact: Double
    let detail: Double
    @Environment(\.statsExpansionProgress) private var progress
    func body(content: Content) -> some View {
        content.frame(height: compact + (detail - compact) * (progress ?? (expanded ? 1 : 0)))
    }
}
extension View {
    func statsExpansionHeight(expanded: Bool, compact: Double, detail: Double) -> some View {
        modifier(StatsExpansionHeight(expanded: expanded, compact: compact, detail: detail))
    }
}

/// Reflows persistent summary items into detail rows on the section's clock.
/// Collapsed, items fill up to `compactColumns` columns of at least
/// `minimumItemWidth`, so wide cards use one row instead of a half-empty grid.
struct StatsDetailGrid<Content: View>: View {
    let expanded: Bool
    let compactColumns: Int
    var minimumItemWidth = 150.0
    @ViewBuilder let content: () -> Content
    @Environment(\.statsExpansionProgress) private var progress
    var body: some View {
        StatsDetailGridLayout(progress: progress ?? (expanded ? 1 : 0), maximumColumns: compactColumns, minimumItemWidth: minimumItemWidth) {
            content()
        }
    }
}
private struct StatsDetailGridLayout: Layout {
    let progress: Double
    let maximumColumns: Int
    let minimumItemWidth: Double
    private func frames(width: Double, subviews: Subviews) -> [CGRect] {
        let spacing = 16.0
        let compactColumns = max(1, min(maximumColumns, Int((width + spacing) / (minimumItemWidth + spacing))))
        let compactWidth = max(0, (width - spacing * Double(compactColumns - 1)) / Double(compactColumns))
        let itemWidth = compactWidth + (width - compactWidth) * progress
        let heights = subviews.map { $0.sizeThatFits(.init(width: itemWidth, height: nil)).height }
        var compactY = 0.0, detailY = 0.0
        return subviews.indices.map { index in
            if index > 0 && index % compactColumns == 0 {
                compactY += (heights[(index - compactColumns)..<index].max() ?? 0) + spacing
            }
            let frame = CGRect(x: Double(index % compactColumns) * (compactWidth + spacing) * (1 - progress),
                               y: compactY + (detailY - compactY) * progress,
                               width: itemWidth, height: heights[index])
            detailY += heights[index] + spacing
            return frame
        }
    }
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = max(0, proposal.width ?? 0)
        return CGSize(width: width, height: frames(width: width, subviews: subviews).map(\.maxY).max() ?? 0)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (view, frame) in zip(subviews, frames(width: bounds.width, subviews: subviews)) {
            view.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                       anchor: .topLeading, proposal: .init(width: frame.width, height: frame.height))
        }
    }
}

/// One row style for every activity a Stats tile lists: sport symbol, name,
/// a secondary summary and an optional detail line, linked when it can open.
struct StatsActivityRow: View {
    let sport: ActivityCategory
    let name: String
    let summary: String
    var detail: String? = nil
    var open: (() -> Void)? = nil

    var body: some View {
        if let open {
            Button(action: open) { row(linked: true) }.buttonStyle(.plain)
        } else {
            row(linked: false)
        }
    }
    private func row(linked: Bool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            BrowseSportSymbol(category: sport)
            VStack(alignment: .leading, spacing: 4) {
                Text(name.isEmpty ? sport.name : name).font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                Text(summary).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let detail { Text(detail).font(.caption).monospacedDigit() }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if linked { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary) }
        }.padding(.vertical, 12).frame(minHeight: 44).contentShape(Rectangle())
    }
}

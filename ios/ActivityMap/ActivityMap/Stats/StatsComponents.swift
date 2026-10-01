import SwiftUI

/// The dashboard owns calculated values and tile choices. This shared surface
/// owns only title/period/control/content hierarchy; it introduces no analytics.
struct StatsTileSurface<Controls: View, Content: View>: View {
    let title: String
    let period: String
    var expand: (() -> Void)? = nil
    @ViewBuilder let controls: () -> Controls
    @ViewBuilder let content: () -> Content
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
            HStack(alignment: .firstTextBaseline, spacing: AppTheme.Spacing.small) {
                BrowseSectionHeading(title: title)
                Spacer(minLength: 0)
                if let expand {
                    BrowseIconButton(title: "Expand \(title)", systemImage: "arrow.up.left.and.arrow.down.right", action: expand)
                }
            }
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: AppTheme.Spacing.small))
                : AnyLayout(HStackLayout(alignment: .center, spacing: AppTheme.Spacing.small))
            layout {
                Text(period).font(AppTheme.Typography.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
                controls()
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(BrowseSurface())
    }
}

struct StatsMetricPicker: View {
    let metrics: [StatsMetric]
    @Binding var selection: StatsMetric
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if typeSize.isAccessibilitySize {
            Picker("Metric", selection: $selection) {
                ForEach(metrics, id: \.self) { metric in
                    Text(metric.definition.label).tag(metric)
                }
            }
            .pickerStyle(.menu)
            .frame(minHeight: AppTheme.minimumTarget)
        } else {
            HStack(spacing: 0) {
                ForEach(metrics, id: \.self) { metric in
                    Button { selection = metric } label: {
                        Text(metric == .count ? "#" : metric.definition.unit)
                            .font(AppTheme.Typography.caption.weight(selection == metric ? .semibold : .regular))
                            .foregroundStyle(selection == metric ? Color.primary : Color.secondary)
                            .frame(minWidth: AppTheme.minimumTarget, minHeight: AppTheme.minimumTarget)
                            .background {
                                if selection == metric {
                                    RoundedRectangle(cornerRadius: 6).fill(AppTheme.surface)
                                        .padding(4)
                                }
                            }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(metric.definition.label)
                    .accessibilityAddTraits(selection == metric ? .isSelected : [])
                }
            }
            .background(AppTheme.contentBackground, in: RoundedRectangle(cornerRadius: 8))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Metric")
        }
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
            ForEach(ranges, id: \.self) { range in Text(label(range)).tag(range) }
        }
    }
}

/// A native chart and an equivalent readable value table. Callers supply both
/// from the same result, including units, missing-value and partial-period
/// labels. Marks own their axes/series; this wrapper never fills gaps with zero.
struct StatsChartSurface<Plot: View, DataRows: View>: View {
    let title: String
    @ViewBuilder let chart: () -> Plot
    @ViewBuilder let dataRows: () -> DataRows
    @ScaledMetric(relativeTo: .body) private var chartHeight = 120.0

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.small) {
            chart()
                .frame(height: chartHeight)
                .accessibilityLabel(title)
            DisclosureGroup {
                dataRows()
            } label: {
                Text("Chart data").font(AppTheme.Typography.caption)
                    .frame(minHeight: AppTheme.minimumTarget, alignment: .leading)
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

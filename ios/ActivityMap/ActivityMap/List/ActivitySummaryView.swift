import SwiftUI

/// A compact result card that scrolls with the activity list.
struct ActivitySummaryView: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var typeSize
    @Bindable var store: ActivityStore
    @State private var allMetricsExpanded = false
    private let availableWidth: CGFloat?

    init(store: ActivityStore, allMetricsExpanded: Bool = false, availableWidth: CGFloat? = nil) {
        self.store = store
        self.availableWidth = availableWidth
        _allMetricsExpanded = State(initialValue: allMetricsExpanded)
    }

    private var mode: ActivitySummaryMode { store.listPresentation.settings.summaryMode }

    var body: some View {
        if let summary = store.activitySummary {
            VStack(alignment: .leading, spacing: 8) {
                header(summary)
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 16) {
                        hero(.distance, title: "Distance", rowID: "distance", summary: summary)
                        hero(.elapsedTime, title: "Elapsed", rowID: "elapsedTime", summary: summary)
                        hero(.elevationGain, title: "Elev. gain", rowID: "elevationGain", summary: summary)
                    }
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 10) {
                            hero(.distance, title: "Distance", rowID: "distance", summary: summary)
                            Rectangle().fill(.primary.opacity(0.14)).frame(width: 0.5, height: 46)
                            hero(.elapsedTime, title: "Elapsed", rowID: "elapsedTime", summary: summary)
                            Rectangle().fill(.primary.opacity(0.14)).frame(width: 0.5, height: 46)
                            hero(.elevationGain, title: "Elev. gain", rowID: "elevationGain", summary: summary)
                        }
                        .frame(minWidth: 310, idealWidth: 310, maxWidth: .infinity)
                        VStack(spacing: 10) {
                            compactHero(.distance, title: "Distance", rowID: "distance", summary: summary)
                            compactHero(.elapsedTime, title: "Elapsed", rowID: "elapsedTime", summary: summary)
                            compactHero(.elevationGain, title: "Elev. gain", rowID: "elevationGain", summary: summary)
                        }
                    }
                }
                if allMetricsExpanded { details(summary).padding(.top, 6) }
            }
            .padding(.horizontal, 14).padding(.bottom, 16).padding(.top, 4)
            .frame(width: availableWidth, alignment: .leading)
            .background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
            .buttonStyle(.borderless)
        }
    }

    private func header(_ summary: ActivitySummary) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                Text("Summary").font(.headline).fixedSize()
                if !store.selectedActivityIDs.isEmpty {
                    scopeSwitch.fixedSize(horizontal: true, vertical: false)
                } else {
                    Text("·").foregroundStyle(.secondary)
                    Text(AppMessages.selectionCount(summary.activityCount, locale: locale))
                        .font(.caption).foregroundStyle(.secondary).fixedSize()
                }
                Spacer(minLength: 0)
                disclosure(summary)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Summary").font(.headline)
                    Spacer(minLength: 0)
                    disclosure(summary)
                }
                if !store.selectedActivityIDs.isEmpty {
                    scopeSwitch
                } else {
                    Text(AppMessages.selectionCount(summary.activityCount, locale: locale))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func disclosure(_ summary: ActivitySummary) -> some View {
        Button { toggleDetails() } label: {
            Image(systemName: allMetricsExpanded ? "chevron.up" : "chevron.down")
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(allMetricsExpanded ? "Collapse summary" : "Expand summary")
        .accessibilityValue("\(mode.title), \(String(localized: AppMessages.selectionCount(summary.activityCount, locale: locale)))")
        .accessibilityIdentifier("activity-summary-toggle")
    }

    @ViewBuilder private var scopeSwitch: some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 0) {
                scopeButton(.selected, count: store.selectedActivityIDs.count)
                scopeButton(.filtered, count: store.visibleActivityIDs.count)
            }
        } else {
            HStack(spacing: 2) {
                scopeButton(.selected, count: store.selectedActivityIDs.count)
                Text("/").font(.caption).foregroundStyle(.tertiary).accessibilityHidden(true)
                scopeButton(.filtered, count: store.visibleActivityIDs.count)
            }
        }
    }

    private func scopeButton(_ scope: ActivitySummaryMode, count: Int) -> some View {
        let active = mode == scope
        let count = count.formatted(.number.locale(locale))
        return Button {
            store.listPresentation.settings.summaryMode = scope
        } label: {
            Group {
                if scope == .selected { Text("\(count) selected") }
                else { Text("\(count) filtered") }
            }
            .font(.caption.weight(active ? .semibold : .regular))
            .foregroundStyle(active ? AppTheme.accent : .secondary)
            .padding(.horizontal, 5).padding(.vertical, 4)
            .background(active ? AppTheme.accent.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 6))
            .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier("activity-summary-scope-\(scope.rawValue)")
    }

    // Avoid competing List-cell and content resize animations.
    private func toggleDetails() {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) { allMetricsExpanded.toggle() }
    }

    private func hero(_ metric: ActivitySummaryMetric, title: String, rowID: String, summary: ActivitySummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: MetricPresentation.definition(rowID, locale: locale)?.glyph ?? "ruler")
                    .foregroundStyle(AppTheme.accent).font(.subheadline)
                Text(title).foregroundStyle(.secondary).font(.caption)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            heroValue(metric, summary: summary)
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(metric.title)
        .accessibilityValue(metric.formatted(summary[metric].value, units: units, locale: locale))
    }

    private func compactHero(_ metric: ActivitySummaryMetric, title: String, rowID: String, summary: ActivitySummary) -> some View {
        HStack(spacing: 8) {
            Image(systemName: MetricPresentation.definition(rowID, locale: locale)?.glyph ?? "ruler")
                .foregroundStyle(AppTheme.accent).font(.subheadline).frame(width: 18)
            Text(title).font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            heroValue(metric, summary: summary).monospacedDigit().fixedSize()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(metric.title)
        .accessibilityValue(metric.formatted(summary[metric].value, units: units, locale: locale))
    }

    private func heroValue(_ metric: ActivitySummaryMetric, summary: ActivitySummary) -> Text {
        let value = summary[metric].value
        let digits: String
        let unit: String
        switch metric {
        case .distance:
            digits = number(value.map { $0 / units.distanceScale }, decimals: 1)
            unit = units.distanceUnit
        case .elevationGain:
            digits = number(value.map { $0 / units.elevationScale })
            unit = units.elevationUnit
        default:
            return Text(metric.formatted(value, units: units, locale: locale)).font(.title3.weight(.semibold))
        }
        let amount = Text(digits).font(.title3.weight(.semibold))
        let suffix = Text(value == nil ? "" : " \(unit)").font(.caption).foregroundColor(.secondary)
        return Text("\(amount)\(suffix)")
    }

    private func details(_ summary: ActivitySummary) -> some View {
        VStack(spacing: 8) {
            Divider()
            if typeSize.isAccessibilitySize {
                inline(.movingTime, title: "Moving", summary: summary)
                inline(.averageSpeed, title: "Avg speed", summary: summary)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 14) {
                        inline(.movingTime, title: "Moving", summary: summary)
                        inline(.averageSpeed, title: "Avg speed", summary: summary)
                    }
                    VStack(spacing: 8) {
                        inline(.movingTime, title: "Moving", summary: summary)
                        inline(.averageSpeed, title: "Avg speed", summary: summary)
                    }
                }
            }
            if typeSize.isAccessibilitySize {
                inline(.elevationLow, title: "Min elevation", summary: summary)
                inline(.elevationHigh, title: "Max elevation", summary: summary)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack {
                        Text("Elevation · min / max").font(.caption).foregroundStyle(.secondary)
                        Spacer(minLength: 8)
                        elevationRange(summary)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Elevation · min / max").font(.caption).foregroundStyle(.secondary)
                        elevationRange(summary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Minimum and maximum elevation")
                .accessibilityValue("\(ActivitySummaryMetric.elevationLow.formatted(summary[.elevationLow].value, units: units, locale: locale)), \(ActivitySummaryMetric.elevationHigh.formatted(summary[.elevationHigh].value, units: units, locale: locale))")
            }
            Divider()
            if typeSize.isAccessibilitySize {
                accessibleGroup("Power · W", icon: "bolt", metrics: [.averagePower, .weightedPower, .maxPower], summary: summary)
                Divider()
                accessibleGroup("HR · bpm", icon: "heart", metrics: [.averageHeartRate, .maxHeartRate], summary: summary)
            } else {
                Grid(horizontalSpacing: 10, verticalSpacing: 10) {
                    GridRow {
                        Color.clear.frame(width: 0, height: 0).gridCellUnsizedAxes([.horizontal, .vertical])
                        columnTitle("Avg")
                        columnTitle("Weighted")
                        columnTitle("Max")
                    }
                    GridRow {
                        groupLabel("Power · W", icon: "bolt")
                        groupValue(.averagePower, summary: summary)
                        groupValue(.weightedPower, summary: summary)
                        groupValue(.maxPower, summary: summary)
                    }
                    Divider().gridCellColumns(4)
                    GridRow {
                        groupLabel("HR · bpm", icon: "heart")
                        groupValue(.averageHeartRate, summary: summary)
                        Text(Formatters.unknown).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .trailing).accessibilityHidden(true)
                        groupValue(.maxHeartRate, summary: summary)
                    }
                }
            }
        }
    }

    private func inline(_ metric: ActivitySummaryMetric, title: String, summary: ActivitySummary) -> some View {
        HStack(spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(metric.formatted(summary[metric].value, units: units, locale: locale))
                .font(.subheadline).monospacedDigit().fixedSize()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(metric.title)
        .accessibilityValue(metric.formatted(summary[metric].value, units: units, locale: locale))
    }

    private func elevationRange(_ summary: ActivitySummary) -> some View {
        let range = Text("\(number(summary[.elevationLow].value.map { $0 / units.elevationScale })) / \(number(summary[.elevationHigh].value.map { $0 / units.elevationScale }))").font(.subheadline)
        let suffix = Text(" \(units.elevationUnit)").font(.caption).foregroundColor(.secondary)
        return Text("\(range)\(suffix)").monospacedDigit().fixedSize()
    }

    private func columnTitle(_ title: String) -> some View {
        Text(title).font(.caption).foregroundStyle(.secondary)
            .lineLimit(1).minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func groupLabel(_ title: String, icon: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).foregroundStyle(AppTheme.accent).font(.subheadline)
            Text(title).font(.caption).foregroundStyle(.secondary).fixedSize()
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func groupValue(_ metric: ActivitySummaryMetric, summary: ActivitySummary) -> some View {
        Text(number(summary[metric].value)).font(.subheadline).monospacedDigit()
            .frame(maxWidth: .infinity, alignment: .trailing)
            .accessibilityLabel(metric.title)
            .accessibilityValue(metric.formatted(summary[metric].value, units: units, locale: locale))
    }

    private func accessibleGroup(_ title: String, icon: String, metrics: [ActivitySummaryMetric], summary: ActivitySummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            groupLabel(title, icon: icon)
            ForEach(metrics) { metric in inline(metric, title: metric.title, summary: summary) }
        }
    }

    private func number(_ value: Double?, decimals: Int = 0) -> String {
        guard let value, value.isFinite else { return Formatters.unknown }
        let normalized = (value * pow(10, Double(decimals))).rounded(.toNearestOrEven) == 0 ? 0 : value
        return normalized.formatted(.number.precision(.fractionLength(0...decimals)).locale(locale))
    }
}

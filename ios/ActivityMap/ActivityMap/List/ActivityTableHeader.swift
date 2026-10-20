import SwiftUI

/// The header and every row share widths, so values stay comparable vertically.
enum ActivityTableLayout {
    static func supports(_ settings: ActivityListSettings, typeSize: DynamicTypeSize,
                         availableWidth: CGFloat = 390) -> Bool {
        !typeSize.isAccessibilitySize && settings.width == .columns
            && metricsFit(settings, availableWidth: availableWidth)
    }

    static func metricsFit(_ settings: ActivityListSettings, availableWidth: CGFloat) -> Bool {
        // Preserve a readable activity name as well as the selected metrics.
        let nameWidth: CGFloat = availableWidth >= 700 ? 180 : 104
        return availableWidth >= 60 + nameWidth + settings.orderedMetrics.reduce(CGFloat(0)) {
            $0 + width($1, availableWidth: availableWidth)
        }
    }

    static func width(_ metric: ActivityListMetric, availableWidth: CGFloat = 390) -> CGFloat {
        switch metric {
        case .distance, .elevationGain: availableWidth >= 700 ? 90 : 50
        case .elapsedTime, .movingTime: availableWidth >= 700 ? 90 : 62
        case .averageSpeed, .maxSpeed: availableWidth >= 700 ? 110 : 80
        default: 110
        }
    }

    static func showsDate(_ settings: ActivityListSettings, availableWidth: CGFloat) -> Bool {
        availableWidth >= 700 && availableWidth >= 60 + 180 + 120
            + settings.orderedMetrics.reduce(CGFloat(0)) { $0 + width($1, availableWidth: availableWidth) }
    }

    static func title(_ metric: ActivityListMetric, speedDisplay: SpeedDisplay = .speed, units: UnitSystem = .metric, locale: Locale = .current) -> String {
        return switch metric {
        case .distance: units.distanceUnit
        case .elapsedTime: "Time"
        case .movingTime: "Moving"
        case .averageSpeed: "Avg \(speedDisplay.unit(units))"
        case .maxSpeed: "\(speedDisplay == .speed ? "Max" : "Best") \(speedDisplay.unit(units))"
        case .elevationGain: "↑ \(units.elevationUnit)"
        default: metric.title
        }
    }

    static func value(_ metric: ActivityListMetric, activity: Activity, speedDisplay: SpeedDisplay = .speed, units: UnitSystem = .metric, locale: Locale = .current) -> String {
        let value = metric.value(for: activity, speedDisplay: speedDisplay, units: units, locale: locale)
        switch metric {
        case .distance: return value.replacingOccurrences(of: " \(units.distanceUnit)", with: "")
        case .elevationGain: return value.replacingOccurrences(of: " \(units.elevationUnit)", with: "")
        case .averageSpeed, .maxSpeed: return value.replacingOccurrences(of: " \(speedDisplay.unit(units))", with: "")
        default: return value
        }
    }
}

struct ActivityTableHeader: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    @Bindable var store: ActivityStore
    var availableWidth: CGFloat = 390
    /// Shorter in iPhone landscape, where vertical space is scarce.
    var rowHeight: CGFloat = 44
    var speedDisplay: SpeedDisplay = .speed
    private var presentation: ActivityListPresentation { store.listPresentation }

    var body: some View {
        HStack(spacing: 0) {
            Button { sort(.selection) } label: {
                HStack(spacing: 2) {
                    Image(systemName: "checkmark.circle")
                    if presentation.settings.sort.field == .selection { arrow }
                }
                .frame(width: 44, height: rowHeight)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Sort by selection state")
            .accessibilityValue(presentation.settings.sort.field == .selection
                ? (presentation.settings.sort.direction == .descending ? "Selected first" : "Unselected first") : "Not sorted")
            Menu {
                Button("Sort by name") { sort(.name) }
                Button("Sort by date") { sort(.localDate) }
            } label: {
                HStack(spacing: 3) {
                    Text("Activity")
                    if [.name, .localDate].contains(presentation.settings.sort.field) {
                        arrow
                    } else {
                        Image(systemName: "chevron.down").font(.system(size: 8))
                    }
                }
                .frame(maxWidth: .infinity, minHeight: rowHeight, alignment: .leading)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Sort activities by name or date")
            if ActivityTableLayout.showsDate(presentation.settings, availableWidth: availableWidth) {
                Button { sort(.localDate) } label: {
                    HStack(spacing: 2) {
                        Text("Date")
                        if presentation.settings.sort.field == .localDate { arrow }
                    }
                    .frame(width: 120, height: rowHeight, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("Sort by date")
            }
            ForEach(presentation.settings.orderedMetrics) { metric in
                Button { sort(metric.field) } label: {
                    HStack(spacing: 2) {
                        Text(ActivityTableLayout.title(metric, speedDisplay: speedDisplay, units: units, locale: locale))
                        if presentation.settings.sort.field == metric.field { arrow }
                    }
                    .frame(width: ActivityTableLayout.width(metric, availableWidth: availableWidth), height: rowHeight, alignment: .trailing)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("Sort by \(metric.title(speedDisplay: speedDisplay, locale: locale))")
                .accessibilityValue(presentation.settings.sort.field == metric.field ? presentation.settings.sort.direction.title : "Not sorted")
            }
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(AppTheme.secondaryText)
        .buttonStyle(.plain)
        .padding(.horizontal, 8)
        .background(Color(uiColor: .systemBackground))
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityIdentifier("activity-table-header")
    }

    private var arrow: some View {
        Image(systemName: presentation.settings.sort.direction == .ascending ? "arrow.up" : "arrow.down")
            .font(.system(size: 8, weight: .semibold))
            .foregroundStyle(AppTheme.accent)
    }

    private func sort(_ field: ActivitySortField) {
        let current = presentation.settings.sort
        presentation.settings.sort = ActivityListSort(field: field,
            direction: current.field == field && current.direction == .descending ? .ascending : .descending)
    }
}

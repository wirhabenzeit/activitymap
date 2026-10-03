import SwiftUI

/// The header and every row share widths, so values stay comparable vertically.
enum ActivityTableLayout {
    static func supports(_ settings: ActivityListSettings, typeSize: DynamicTypeSize,
                         availableWidth: CGFloat = 390) -> Bool {
        guard !typeSize.isAccessibilitySize, settings.width == .fitWidth,
              !settings.visibleMetrics.isEmpty else { return false }
        // Preserve every configured metric. Fall back to the adaptive grid when
        // aligned columns would squeeze the activity name or clip their values.
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

    static func title(_ metric: ActivityListMetric) -> String {
        switch metric {
        case .distance: "km"
        case .elapsedTime: "Time"
        case .movingTime: "Moving"
        case .averageSpeed: "Avg km/h"
        case .maxSpeed: "Max km/h"
        case .elevationGain: "↑ m"
        default: metric.title
        }
    }

    static func value(_ metric: ActivityListMetric, activity: Activity) -> String {
        let value = metric.value(for: activity)
        switch metric {
        case .distance: return value.replacingOccurrences(of: " km", with: "")
        case .elevationGain: return value.replacingOccurrences(of: " m", with: "")
        case .averageSpeed, .maxSpeed: return value.replacingOccurrences(of: " km/h", with: "")
        default: return value
        }
    }
}

struct ActivityTableHeader: View {
    @Bindable var store: ActivityStore
    var availableWidth: CGFloat = 390
    private var presentation: ActivityListPresentation { store.listPresentation }

    var body: some View {
        HStack(spacing: 0) {
            SelectionBar(store: store, iconOnly: true).frame(width: 44)
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
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Sort activities by name or date")
            if ActivityTableLayout.showsDate(presentation.settings, availableWidth: availableWidth) {
                Button { sort(.localDate) } label: {
                    HStack(spacing: 2) {
                        Text("Date")
                        if presentation.settings.sort.field == .localDate { arrow }
                    }
                    .frame(width: 120, height: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("Sort by date")
            }
            ForEach(presentation.settings.orderedMetrics) { metric in
                Button { sort(metric.field) } label: {
                    HStack(spacing: 2) {
                        Text(ActivityTableLayout.title(metric))
                        if presentation.settings.sort.field == metric.field { arrow }
                    }
                    .frame(width: ActivityTableLayout.width(metric, availableWidth: availableWidth), height: 44, alignment: .trailing)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("Sort by \(metric.title)")
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

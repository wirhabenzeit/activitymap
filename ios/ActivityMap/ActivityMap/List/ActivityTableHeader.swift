import SwiftUI

/// The header and every row share widths, so values stay comparable vertically.
enum ActivityTableLayout {
    static func supports(_ settings: ActivityListSettings, typeSize: DynamicTypeSize) -> Bool {
        !typeSize.isAccessibilitySize && settings.width == .fitWidth
            && !settings.visibleMetrics.isEmpty
            && settings.visibleMetrics.isSubset(of: [.distance, .elapsedTime, .elevationGain])
    }

    static func width(_ metric: ActivityListMetric) -> CGFloat {
        metric == .elapsedTime ? 62 : 50
    }

    static func title(_ metric: ActivityListMetric) -> String {
        switch metric {
        case .distance: "km"
        case .elapsedTime: "Time"
        case .elevationGain: "↑ m"
        default: metric.title
        }
    }

    static func value(_ metric: ActivityListMetric, activity: Activity) -> String {
        metric.value(for: activity)
            .replacingOccurrences(of: " km", with: "")
            .replacingOccurrences(of: " m", with: "")
    }
}

struct ActivityTableHeader: View {
    @Bindable var store: ActivityStore
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
            ForEach(presentation.settings.orderedMetrics) { metric in
                Button { sort(metric.field) } label: {
                    HStack(spacing: 2) {
                        Text(ActivityTableLayout.title(metric))
                        if presentation.settings.sort.field == metric.field { arrow }
                    }
                    .frame(width: ActivityTableLayout.width(metric), height: 44, alignment: .trailing)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("Sort by \(metric.title)")
                .accessibilityValue(presentation.settings.sort.field == metric.field ? presentation.settings.sort.direction.title : "Not sorted")
            }
            ListControls(presentation: presentation, iconOnly: true).frame(width: 44)
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

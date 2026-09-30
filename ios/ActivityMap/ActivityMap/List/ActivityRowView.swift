import SwiftUI

struct ActivityRowView: View {
    @Bindable var store: ActivityStore
    let activity: Activity
    @Environment(\.dynamicTypeSize) private var typeSize

    private var isSelected: Bool { store.selectedActivityIDs.contains(activity.id) }
    private var isActive: Bool { store.activeActivityID == activity.id }
    private var hasGeometry: Bool { !activity.coordinates.isEmpty }
    private var settings: ActivityListSettings { store.listPresentation.settings }

    var body: some View {
        VStack(alignment: .leading, spacing: settings.density == .compact ? 4 : 10) {
            if typeSize.isAccessibilitySize {
                identification
                HStack { Spacer(); actions }
            } else {
                HStack(alignment: .top, spacing: 4) {
                    identification
                    Spacer(minLength: 0)
                    actions
                }
            }
            if !settings.visibleMetrics.isEmpty {
                if settings.width == .scrollingMetrics && !typeSize.isAccessibilitySize {
                    // Identifying context sits outside this scroller: horizontal
                    // metric inspection never moves the name/date/actions away.
                    ScrollView(.horizontal) {
                        HStack(alignment: .top, spacing: 20) {
                            ForEach(settings.orderedMetrics) { metric in
                                metricView(metric).frame(minWidth: 110, alignment: .leading)
                            }
                        }
                    }
                    .accessibilityLabel("Metrics for \(activity.name)")
                } else {
                    LazyVGrid(columns: typeSize.isAccessibilitySize
                              ? [GridItem(.flexible(), alignment: .leading)]
                              : [GridItem(.adaptive(minimum: AppTheme.minimumMetricColumnWidth), alignment: .leading)],
                              alignment: .leading, spacing: settings.density == .compact ? 4 : 10) {
                        ForEach(settings.orderedMetrics) { metricView($0) }
                    }
                }
            }
        }
        .padding(.vertical, settings.density == .compact ? 0 : 6)
        .contentShape(Rectangle())
        .accessibilityIdentifier("activity-list-row-\(activity.id)")
    }

    private var identification: some View {
        HStack(alignment: .top, spacing: 8) {
            Button { store.toggleSelection(activity.id) } label: {
                BrowseSportSymbol(category: activity.category, isSelected: isSelected)
                    .frame(minWidth: AppTheme.minimumTarget, minHeight: AppTheme.minimumTarget)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isSelected ? "Deselect \(activity.name)" : "Select \(activity.name)")
            .accessibilityAddTraits(isSelected ? .isSelected : [])

            VStack(alignment: .leading, spacing: 2) {
                Text(activity.name)
                    .fontWeight(isActive ? .semibold : .regular)
                    .lineLimit(typeSize.isAccessibilitySize || settings.density == .comfortable ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(activity.sportType.rawValue)
                    .font(.caption).foregroundStyle(.secondary)
                Text(Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt))
                    .font(.caption).foregroundStyle(.secondary)
                if isActive {
                    BrowseBadge(title: "Active on map", systemImage: "location.fill")
                }
            }
            .padding(.top, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var actions: some View {
        BrowseIconButton(title: "Show \(activity.name) on map", systemImage: hasGeometry ? "map" : "map.slash") {
            store.showOnMap(activity.id)
        }
        .disabled(!hasGeometry)
        .accessibilityHint(hasGeometry ? "" : "This activity has no GPS route.")

        BrowseIconButton(
            title: "\(store.inspectedActivityID == activity.id ? "Close details for" : "Details for") \(activity.name)",
            systemImage: store.inspectedActivityID == activity.id ? "xmark.circle" : "info.circle"
        ) {
            if store.inspectedActivityID == activity.id { store.dismissInspection() }
            else { store.inspect(activity.id) }
        }
    }

    private func metricView(_ metric: ActivityListMetric) -> some View {
        BrowseMetricValue(title: metric.title, value: metric.value(for: activity))
    }
}

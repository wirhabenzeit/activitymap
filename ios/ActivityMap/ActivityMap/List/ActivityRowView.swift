import SwiftUI

struct ActivityRowView: View {
    @Bindable var store: ActivityStore
    let activity: Activity
    var availableWidth: CGFloat = 390
    @Environment(\.dynamicTypeSize) private var typeSize

    private var isSelected: Bool { store.selectedActivityIDs.contains(activity.id) }
    private var isActive: Bool { store.activeActivityID == activity.id }
    private var hasGeometry: Bool { !activity.coordinates.isEmpty }
    private var settings: ActivityListSettings { store.listPresentation.settings }

    private var primaryMetricsOnly: Bool { settings.visibleMetrics.isSubset(of: [.distance, .elapsedTime, .elevationGain]) }

    private var usesTable: Bool { ActivityTableLayout.supports(settings, typeSize: typeSize, availableWidth: availableWidth) }

    var body: some View {
        HStack(alignment: typeSize.isAccessibilitySize ? .top : .center, spacing: 0) {
            Button { store.toggleSelection(activity.id) } label: {
                BrowseSportSymbol(category: activity.category, isSelected: isSelected)
                    .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(isSelected ? "Deselect" : "Select") \(activity.name)")
            .accessibilityValue("\(activity.sportType.rawValue), \(isSelected ? "Selected" : "Not selected")")
            .accessibilityAddTraits(isSelected ? .isSelected : [])
            Button(action: inspect) {
                Group {
                    if usesTable {
                        tableContent
                    } else {
                        VStack(alignment: .leading, spacing: 2) {
                            BrowseActivityHeading(activity: activity, isActive: isActive, comfortable: settings.density == .comfortable)
                            metrics
                        }
                    }
                }
                .frame(maxWidth: .infinity, minHeight: AppTheme.minimumTarget, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Details for \(activity.name)")
            .accessibilityValue(accessibleDetails)
            .accessibilityHint("Inspect activity without changing selection")
            .contextMenu { actionItems }
            .accessibilityActions {
                if hasGeometry {
                    Button("Show on map") { store.showOnMap(activity.id) }
                }
            }
        }
        .padding(.vertical, settings.density == .compact ? 0 : 2)
        .contentShape(Rectangle())
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if hasGeometry && settings.width == .fitWidth {
                Button { store.showOnMap(activity.id) } label: {
                    Label("Show on map", systemImage: "map")
                }.tint(AppTheme.accent)
            }
        }
        .overlay(alignment: .leading) {
            if isSelected {
                RoundedRectangle(cornerRadius: 2).fill(AppTheme.accent)
                    .frame(width: 3).padding(.vertical, 5)
                    .allowsHitTesting(false).accessibilityHidden(true)
            }
        }
        .accessibilityIdentifier("activity-list-row-\(activity.id)")
    }

    private var tableContent: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 2) {
                    Text(activity.name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(settings.density == .compact ? 1 : 2)
                    if isActive {
                        Image(systemName: "location.fill").font(.caption2).foregroundStyle(AppTheme.accent)
                    }
                }
                if !ActivityTableLayout.showsDate(settings, availableWidth: availableWidth) {
                    Text(Formatters.shortDate(activity.startDateLocal, timeZone: .gmt))
                        .font(.caption2).foregroundStyle(AppTheme.secondaryText)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.trailing, 6)
            if ActivityTableLayout.showsDate(settings, availableWidth: availableWidth) {
                Text(Formatters.shortDate(activity.startDateLocal, timeZone: .gmt))
                    .font(.caption).foregroundStyle(AppTheme.secondaryText)
                    .frame(width: 120, alignment: .leading)
            }
            ForEach(settings.orderedMetrics) { metric in
                Text(ActivityTableLayout.value(metric, activity: activity))
                    .font(.caption).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.85)
                    .frame(width: ActivityTableLayout.width(metric, availableWidth: availableWidth), alignment: .trailing)
            }
        }
    }

    @ViewBuilder private var metrics: some View {
        if !settings.visibleMetrics.isEmpty {
            if settings.width == .scrollingMetrics && !typeSize.isAccessibilitySize {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: AppTheme.Spacing.large) {
                        ForEach(settings.orderedMetrics) { metric in
                            metricView(metric).frame(minWidth: AppTheme.minimumMetricColumnWidth, alignment: .leading)
                        }
                    }
                }
                .accessibilityLabel("Metrics for \(activity.name)")
            } else {
                LazyVGrid(columns: typeSize.isAccessibilitySize
                          ? [GridItem(.flexible(), alignment: .leading)]
                          : primaryMetricsOnly
                            ? Array(repeating: GridItem(.flexible(), alignment: .leading), count: settings.orderedMetrics.count)
                            : [GridItem(.adaptive(minimum: metricColumnWidth), alignment: .leading)],
                          alignment: .leading, spacing: AppTheme.Spacing.tight) {
                    ForEach(settings.orderedMetrics) { metricView($0) }
                }
            }
        }
    }

    private var metricColumnWidth: CGFloat {
        settings.visibleMetrics.isSubset(of: [.distance, .elapsedTime, .elevationGain])
            ? AppTheme.minimumInlineMetricColumnWidth : AppTheme.minimumMetricColumnWidth
    }

    @ViewBuilder private var actionItems: some View {
        Button(store.inspectedActivityID == activity.id ? "Close details" : "Details", systemImage: "info.circle", action: inspect)
        Button("Show on map", systemImage: "map") { store.showOnMap(activity.id) }
            .disabled(!hasGeometry)
    }

    private var accessibleDetails: String {
        ([activity.sportType.rawValue, Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt)]
            + settings.orderedMetrics.map { metric in
                let value = metric.value(for: activity)
                return "\(metric.title): \(value == Formatters.unknown ? "Not recorded" : value)"
            } + (isActive ? ["Active on map"] : [])).joined(separator: ". ")
    }

    private func inspect() {
        if store.inspectedActivityID == activity.id { store.dismissInspection() }
        else { store.inspect(activity.id) }
    }

    @ViewBuilder private func metricView(_ metric: ActivityListMetric) -> some View {
        if primaryMetricsOnly && !typeSize.isAccessibilitySize {
            Text(metric.value(for: activity))
                .font(.caption).monospacedDigit()
                .foregroundStyle(AppTheme.secondaryText)
                .lineLimit(1).minimumScaleFactor(0.85)
                .accessibilityLabel("\(metric.title): \(metric.value(for: activity))")
        } else {
            BrowseMetricValue(title: metric.title, value: metric.value(for: activity))
        }
    }
}

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
                        VStack(alignment: .leading, spacing: AppTheme.Spacing.tight) {
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
            actions
        }
        .padding(.vertical, settings.density == .compact ? 0 : AppTheme.Spacing.tight)
        .contentShape(Rectangle())
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

    private var actions: some View {
        Menu {
            Button(store.inspectedActivityID == activity.id ? "Close details" : "Details", systemImage: "info.circle", action: inspect)
            Button("Show on map", systemImage: "map") { store.showOnMap(activity.id) }
                .disabled(!hasGeometry)
        } label: {
            BrowseIconLabel(systemImage: "ellipsis")
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Actions for \(activity.name)")
        .accessibilityHint(hasGeometry ? "Details or show on map" : "No GPS route; details remain available")
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
        let symbol: String? = switch metric {
        case .distance: "ruler"
        case .elapsedTime: "clock"
        case .elevationGain: "mountain.2"
        default: nil
        }
        if let symbol, !typeSize.isAccessibilitySize {
            BrowseInlineMetric(title: metric.title, value: metric.value(for: activity), systemImage: symbol)
        } else {
            BrowseMetricValue(title: metric.title, value: metric.value(for: activity))
        }
    }
}

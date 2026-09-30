import SwiftUI

struct ActivityRowView: View {
    @Bindable var store: ActivityStore
    let activity: Activity
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var isSelected: Bool { store.selectedActivityIDs.contains(activity.id) }
    private var isActive: Bool { store.activeActivityID == activity.id }
    private var hasGeometry: Bool { !activity.coordinates.isEmpty }
    private var settings: ActivityListSettings { store.listPresentation.settings }

    var body: some View {
        HStack(alignment: typeSize.isAccessibilitySize ? .top : .center, spacing: 0) {
            BrowseSelectionButton(title: "\(isSelected ? "Deselect" : "Select") \(activity.name)", isSelected: isSelected) {
                store.toggleSelection(activity.id)
            }
            VStack(alignment: .leading, spacing: AppTheme.Spacing.tight) {
                if sizeClass == .regular && !typeSize.isAccessibilitySize && settings.width == .fitWidth {
                    HStack(spacing: AppTheme.Spacing.large) {
                        identification.frame(maxWidth: .infinity, alignment: .leading)
                        metrics.frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else {
                    identification
                    metrics
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            actions
        }
        .padding(.vertical, settings.density == .compact ? 0 : AppTheme.Spacing.tight)
        .contentShape(Rectangle())
        .accessibilityIdentifier("activity-list-row-\(activity.id)")
    }

    private var identification: some View {
        Button(action: inspect) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(activity.name)
                        .font(.subheadline.weight(isActive ? .semibold : .medium))
                        .lineLimit(typeSize.isAccessibilitySize ? nil : settings.density == .compact ? 1 : 2)
                        .fixedSize(horizontal: false, vertical: true)
                    if isActive {
                        Image(systemName: "location.fill").font(.system(size: 10))
                            .foregroundStyle(AppTheme.accent)
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Image(systemName: activity.category.symbolName)
                        .font(.system(size: 11)).foregroundStyle(AppTheme.sportSymbolColor(activity.category))
                    Text("\(activity.sportType.rawValue) · \(Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt))")
                        .font(.caption2).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: AppTheme.minimumTarget, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Details for \(activity.name)")
        .accessibilityValue("\(activity.sportType.rawValue), \(Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt))\(isActive ? ", active on map" : "")")
        .accessibilityHint("Inspect activity without changing selection")
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

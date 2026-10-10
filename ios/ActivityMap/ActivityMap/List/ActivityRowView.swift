import SwiftUI

struct ActivityRowView: View {
    @Bindable var store: ActivityStore
    let activity: Activity
    var availableWidth: CGFloat = 390
    var isInspected = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    private var isSelected: Bool { store.selectedActivityIDs.contains(activity.id) }
    private var isActive: Bool { store.activeActivityID == activity.id }
    private var hasGeometry: Bool { !activity.coordinates.isEmpty }
    private var settings: ActivityListSettings { store.listPresentation.settings }

    private var usesTable: Bool { ActivityTableLayout.supports(settings, typeSize: typeSize, availableWidth: availableWidth) }

    var body: some View {
        HStack(alignment: usesTable ? .center : .top, spacing: 0) {
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
                        VStack(alignment: .leading, spacing: AppTheme.Spacing.small) {
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
        .padding(.vertical, settings.density == .compact || verticalSizeClass == .compact ? 0 : 2)
        .contentShape(Rectangle())
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if hasGeometry {
                Button { store.showOnMap(activity.id) } label: {
                    Label("Show on map", systemImage: "map")
                }.tint(AppTheme.accent)
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

    private var metrics: some View {
        ActivityMetricFlow(spacing: 16, rowSpacing: 8, stacked: typeSize.isAccessibilitySize) {
            ForEach(settings.orderedMetrics) { metric in
                VStack(alignment: .leading, spacing: 2) {
                    Text(metric.value(for: activity))
                        .font(.subheadline.weight(.medium)).monospacedDigit()
                    Text(metric.title)
                        .font(.caption2).foregroundStyle(AppTheme.secondaryText)
                }
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(metric.title)
                .accessibilityValue(metric.value(for: activity))
            }
        }
    }

    @ViewBuilder private var actionItems: some View {
        Button("Details", systemImage: "info.circle") { store.inspect(activity.id) }
        Button("Show on map", systemImage: "map") { store.showOnMap(activity.id) }
            .disabled(!hasGeometry)
    }

    private var accessibleDetails: String {
        ([activity.sportType.rawValue, Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt)]
            + settings.orderedMetrics.map { metric in
                let value = metric.value(for: activity)
                return "\(metric.title): \(value == Formatters.unknown ? "Not recorded" : value)"
            } + [isInspected ? "Inspected" : "Not inspected", isSelected ? "Selected" : "Not selected"]
            + (isActive ? ["Active on map"] : [])).joined(separator: ". ")
    }

    private func inspect() {
        if store.inspectedActivityID == activity.id { store.dismissInspection() }
        else { store.inspect(activity.id) }
    }

}

/// Each metric keeps its natural width and wraps as a unit. The outer List
/// remains the only scroll view, leaving horizontal gestures for row actions.
struct ActivityMetricFlow: Layout {
    var spacing: CGFloat = 16
    var rowSpacing: CGFloat = 8
    var stacked = false

    private func frames(width: CGFloat, subviews: Subviews) -> [CGRect] {
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        return subviews.map { subview in
            let ideal = subview.sizeThatFits(.unspecified)
            let size = subview.sizeThatFits(ProposedViewSize(width: min(width, ideal.width), height: nil))
            if x > 0 && (stacked || x + size.width > width) {
                x = 0
                y += rowHeight + rowSpacing
                rowHeight = 0
            }
            let frame = CGRect(origin: CGPoint(x: x, y: y), size: size)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            return frame
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = max(0, proposal.width ?? subviews.reduce(CGFloat(0)) {
            $0 + $1.sizeThatFits(.unspecified).width + spacing
        })
        let frames = frames(width: width, subviews: subviews)
        return CGSize(width: width, height: frames.map(\.maxY).max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (subview, frame) in zip(subviews, frames(width: bounds.width, subviews: subviews)) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                          anchor: .topLeading, proposal: ProposedViewSize(frame.size))
        }
    }
}

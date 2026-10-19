import SwiftUI

/// Shared hierarchy for Map and List; see docs/activity-detail-presentation.md.
struct ActivityDetailContent<Profile: View, Photos: View>: View {
    let activity: Activity
    @Environment(\.activityDetailOverMap) private var overMap
    var headerTrailingInset: CGFloat = 0
    var showsHeading = true
    var showsPrimaryMetrics = true
    var showsDescription = true
    /// Route and editing actions share the scrolling footer on every detail surface.
    var hasRoute = true
    var showOnMap: ((Int) -> Void)? = nil
    var editing: ActivityEditingService? = nil
    var streamSummaries: StreamSummaryLoader? = nil
    var exportStore: ActivityStore? = nil
    @ViewBuilder var profile: (Activity) -> Profile
    @ViewBuilder var photos: (Activity) -> Photos
    @Environment(\.dynamicTypeSize) private var typeSize

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), alignment: .leading), count: typeSize.isAccessibilitySize ? 1 : 2)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
            if showsHeading {
                ActivityDetailHeading(activity: activity, trailingInset: headerTrailingInset)
            }
            profile(activity)
            if showsDescription { ActivityDetailDescription(activity: activity) }
            if showsPrimaryMetrics {
                Divider()
                ActivityHeadlineStats(activity: activity)
            }
            photos(activity)
            ForEach(ActivityMetricGroup.groups(for: activity)) { group in
                VStack(alignment: .leading, spacing: 12) {
                    Divider()
                    Label(group.title, systemImage: group.icon)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppTheme.secondaryText)
                        .accessibilityAddTraits(.isHeader)
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                        ForEach(group.rows) { metric in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(metric.value).font(.subheadline.weight(.medium)).monospacedDigit()
                                Text(metric.title).font(.caption).foregroundStyle(AppTheme.secondaryText)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("\(group.title), \(metric.title)")
                            .accessibilityValue(metric.value)
                            .accessibilityIdentifier("activity-metric-\(metric.id)")
                        }
                    }
                }
                .accessibilityIdentifier("activity-metric-group-\(group.id)")
            }
            ActivityDetailActions(activity: activity, hasRoute: hasRoute, showOnMap: showOnMap,
                                  editing: editing, summaries: streamSummaries, exportStore: exportStore)
                .id(activity.id)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, AppTheme.Spacing.large)
        .padding(.vertical, AppTheme.Spacing.small)
        .background { if !overMap { AppTheme.surface } }
    }
}

/// Optional prose follows the chart on every detail surface.
struct ActivityDetailDescription: View {
    let activity: Activity

    var body: some View {
        if let description = activity.description, !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text(description).font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }
}

/// The same three actual measurements on every detail surface.
struct ActivityHeadlineStats: View {
    let activity: Activity
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 12) { metrics }
            } else {
                HStack(alignment: .top, spacing: 8) { metrics }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("map-activity-stats")
    }

    @ViewBuilder private var metrics: some View {
        metric("Distance", value: Formatters.distance(activity.distance))
        metric("Moving time", value: Formatters.duration(activity.movingTime))
        let display = SpeedDisplay.forSport(activity.sportType)
        if display == .speed {
            metric("Elevation gain", value: Formatters.elevation(activity.totalElevationGain))
        } else {
            metric("Average pace", value: display.format(activity.averageSpeed))
        }
    }

    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: typeSize.isAccessibilitySize ? .leading : .center, spacing: 5) {
            Text(value).font(.headline).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(title).font(.caption).foregroundStyle(AppTheme.secondaryText)
                .multilineTextAlignment(typeSize.isAccessibilitySize ? .leading : .center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: typeSize.isAccessibilitySize ? .leading : .center)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(value)
    }
}

/// Optional navigation supplied by a paged detail host. Closures read the live
/// selection so cached pages keep their accessibility actions up to date.
struct ActivityDetailPaging {
    let position: (Int) -> String?
    let previous: () -> Void
    let next: () -> Void
    var canGoPrevious: (Int) -> Bool = { _ in true }
    var canGoNext: (Int) -> Bool = { _ in true }
}

extension EnvironmentValues {
    @Entry var activityDetailPaging: ActivityDetailPaging? = nil
}

/// Shared identity stays in one place while Map summary grows into detail.
struct ActivityDetailIdentity: View {
    @Environment(\.activityDetailPaging) private var paging
    let activity: Activity
    var trailingInset: CGFloat = 0
    var titleLineLimit: Int? = nil
    var onNavigationBar = false

    var body: some View {
        HStack(alignment: .top, spacing: AppTheme.Spacing.small) {
            BrowseSportSymbol(category: activity.category)
            VStack(alignment: .leading, spacing: AppTheme.Spacing.tight) {
                Text(activity.name).font(.headline)
                    .foregroundStyle(onNavigationBar ? Color.white : .primary)
                    // Native bars reserve one line for identity and one for
                    // metadata; wrapping a long title must not grow the bar.
                    .lineLimit(onNavigationBar ? 1 : titleLineLimit)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("activity-detail-name")
                    .accessibilityValue(paging?.position(activity.id) ?? "")
                    .accessibilityActions {
                        if let paging, paging.position(activity.id) != nil {
                            if paging.canGoPrevious(activity.id) { Button("Previous activity", action: paging.previous) }
                            if paging.canGoNext(activity.id) { Button("Next activity", action: paging.next) }
                        }
                    }
                Text("\(activity.sportType.rawValue) · \(Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt))")
                    .font(.caption).foregroundStyle(onNavigationBar ? Color.white.opacity(0.8) : AppTheme.secondaryText)
                    .lineLimit(onNavigationBar || titleLineLimit == 1 ? 1 : nil)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.trailing, trailingInset)
    }
}

/// The title row stays focused on identity and moving between activities.
/// Map owns its previous/next controls in the persistent group header.
struct ActivityDetailHeading: View {
    @Environment(\.activityDetailPaging) private var paging
    @Environment(\.activityDetailOverMap) private var overMap
    let activity: Activity
    var trailingInset: CGFloat = 0
    var titleLineLimit: Int? = nil
    var onNavigationBar = false

    var body: some View {
        HStack(alignment: .center, spacing: AppTheme.Spacing.small) {
            ActivityDetailIdentity(activity: activity, titleLineLimit: titleLineLimit, onNavigationBar: onNavigationBar)
            if !overMap, let paging, paging.position(activity.id) != nil {
                ActivityDetailStepButtons(previous: paging.canGoPrevious(activity.id) ? paging.previous : nil,
                                          next: paging.canGoNext(activity.id) ? paging.next : nil,
                                          onNavigationBar: onNavigationBar)
            }
        }
        .padding(.trailing, trailingInset)
    }
}

extension ActivityDetailContent where Profile == EmptyView, Photos == EmptyView {
    init(activity: Activity, headerTrailingInset: CGFloat = 0, showsHeading: Bool = true, streamSummaries: StreamSummaryLoader? = nil) {
        self.init(activity: activity, headerTrailingInset: headerTrailingInset, showsHeading: showsHeading,
                  streamSummaries: streamSummaries, profile: { _ in EmptyView() }, photos: { _ in EmptyView() })
    }
}

/// Both browsing hosts use their visible order and stop at its boundaries.
struct ActivityDetailSequence {
    let ids: [Int]
    let currentID: Int
    private var index: Int? { ids.firstIndex(of: currentID) }
    var previousID: Int? {
        guard let index, index > 0 else { return nil }
        return ids[index - 1]
    }
    var nextID: Int? {
        guard let index, index + 1 < ids.count else { return nil }
        return ids[index + 1]
    }
    var position: String? {
        guard ids.count > 1, let index else { return nil }
        return String(localized: "\(index + 1) of \(ids.count)")
    }
}

/// Visible alternatives to pulling past the end; shared by Map and List.
struct ActivityDetailStepButtons: View {
    let previous: (() -> Void)?
    let next: (() -> Void)?
    var onNavigationBar = false
    var body: some View {
        HStack(spacing: 0) {
            step("Previous activity", icon: "chevron.up", identifier: "activity-previous", action: previous)
            step("Next activity", icon: "chevron.down", identifier: "activity-next", action: next)
        }
        .buttonStyle(.plain)
        .foregroundStyle(onNavigationBar ? Color.white : AppTheme.accent)
    }

    private func step(_ label: LocalizedStringKey, icon: String, identifier: String,
                      action: (() -> Void)?) -> some View {
        Button { action?() } label: {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
                .contentShape(Rectangle())
        }
        .disabled(action == nil)
        .opacity(action == nil ? 0.35 : 1)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(identifier)
    }
}

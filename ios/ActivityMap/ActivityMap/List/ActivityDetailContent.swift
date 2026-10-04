import SwiftUI

/// Shared hierarchy for Map and List; see docs/activity-detail-presentation.md.
struct ActivityDetailContent<Profile: View, Photos: View>: View {
    let activity: Activity
    @Environment(\.activityDetailOverMap) private var overMap
    var headerTrailingInset: CGFloat = 0
    var showsHeading = true
    var showsPrimaryMetrics = true
    var showsDescription = true
    @ViewBuilder var profile: (Activity) -> Profile
    @ViewBuilder var photos: (Activity) -> Photos
    @Environment(\.dynamicTypeSize) private var typeSize

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), alignment: .leading), count: typeSize.isAccessibilitySize ? 1 : 2)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
            if showsHeading {
                ActivityDetailIdentity(activity: activity, trailingInset: headerTrailingInset)
            }
            profile(activity)
            if showsDescription { ActivityDetailDescription(activity: activity) }
            if showsPrimaryMetrics {
                Divider()
                ActivityHeadlineStats(activity: activity)
            }
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
            photos(activity)
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
        metric("Elevation gain", value: Formatters.elevation(activity.totalElevationGain))
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

/// Shared identity stays in one place while Map summary grows into detail.
struct ActivityDetailIdentity: View {
    let activity: Activity
    var trailingInset: CGFloat = 0
    var titleLineLimit: Int? = nil

    var body: some View {
        HStack(alignment: .top, spacing: AppTheme.Spacing.small) {
            BrowseSportSymbol(category: activity.category)
            VStack(alignment: .leading, spacing: AppTheme.Spacing.tight) {
                Text(activity.name).font(.headline)
                    .lineLimit(titleLineLimit)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("activity-detail-name")
                Text("\(activity.sportType.rawValue) · \(Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt))")
                    .font(.caption).foregroundStyle(AppTheme.secondaryText)
                    .lineLimit(titleLineLimit == 1 ? 1 : nil)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.trailing, trailingInset)
    }
}

extension ActivityDetailContent where Profile == EmptyView, Photos == EmptyView {
    init(activity: Activity, headerTrailingInset: CGFloat = 0, showsHeading: Bool = true) {
        self.init(activity: activity, headerTrailingInset: headerTrailingInset, showsHeading: showsHeading, profile: { _ in EmptyView() }, photos: { _ in EmptyView() })
    }
}

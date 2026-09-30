import SwiftUI

/// Presentation-only content shared by list expansion and map/list sheets.
/// Future profile and photo consumers plug in here without duplicating metrics.
struct ActivityDetailContent<Profile: View, Photos: View>: View {
    let activity: Activity
    @ViewBuilder var profile: (Activity) -> Profile
    @ViewBuilder var photos: (Activity) -> Photos
    @Environment(\.dynamicTypeSize) private var typeSize

    private var rows: [ActivityMetricRow] { ActivityMetricRow.rows(for: activity) }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.section) {
            VStack(alignment: .leading, spacing: AppTheme.Spacing.small) {
                Label(activity.sportType.rawValue.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression), systemImage: activity.category.symbolName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(activity.name)
                    .font(AppTheme.Typography.title)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("activity-detail-name")
                Text(Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if activity.isPrivate == true || activity.commute == true || activity.trainer == true || activity.flagged == true {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) { badges }
                        VStack(alignment: .leading, spacing: 8) { badges }
                    }
                    .font(.caption)
                }
            }

            LazyVGrid(columns: typeSize.isAccessibilitySize
                      ? [GridItem(.flexible(), alignment: .leading)]
                      : [GridItem(.adaptive(minimum: AppTheme.minimumMetricColumnWidth), alignment: .leading)],
                      alignment: .leading, spacing: AppTheme.Spacing.medium) {
                highlights
            }

            profile(activity)
            metricSection("Time & speed", ids: ["movingTime", "averageSpeed", "maxSpeed"])
            metricSection("Elevation", ids: ["elevHigh", "elevLow"])
            metricSection("Heart rate", ids: ["averageHeartrate", "maxHeartrate"])
            metricSection("Power & energy", ids: ["averageWatts", "weightedAverageWatts", "maxWatts", "calories", "kilojoules"])
            metricSection("Activity information", ids: ["id", "geometry", "photos", "kudos", "achievements", "comments",
                                                         "commute", "privacy", "flagged", "trainer", "manual"])
            photos(activity)

            if let description = activity.description, !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    sectionTitle("Description")
                    Text(description)
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
    }

    @ViewBuilder private var badges: some View {
        if activity.isPrivate == true { BrowseBadge(title: "Private", systemImage: "lock") }
        if activity.commute == true { BrowseBadge(title: "Commute", systemImage: "arrow.left.arrow.right") }
        if activity.trainer == true { BrowseBadge(title: "Indoor", systemImage: "house") }
        if activity.flagged == true { BrowseBadge(title: "Flagged", systemImage: "flag") }
    }

    @ViewBuilder private var highlights: some View {
        highlight("Distance", value: Formatters.distance(activity.distance))
        highlight("Elapsed time", value: Formatters.duration(activity.elapsedTime))
        highlight("Elevation gain", value: Formatters.elevation(activity.totalElevationGain))
    }

    private func highlight(_ title: String, value: String) -> some View {
        BrowseMetricValue(title: title, value: value, emphasis: .detail)
            .modifier(BrowseSurface(inset: AppTheme.Spacing.medium))
    }

    @ViewBuilder private func metricSection(_ title: String, ids: [String]) -> some View {
        let metrics = ids.compactMap { id in rows.first { $0.id == id } }
        if !metrics.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                sectionTitle(title)
                VStack(spacing: 0) {
                    ForEach(metrics) { metric in
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline, spacing: 16) {
                                Text(metric.title).foregroundStyle(.secondary).fixedSize()
                                Spacer(minLength: 12)
                                Text(metric.value).fontWeight(.semibold).monospacedDigit().fixedSize()
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(metric.title).foregroundStyle(.secondary)
                                Text(metric.value).fontWeight(.semibold).monospacedDigit()
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 10)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(metric.title)
                        .accessibilityValue(metric.value)
                        .accessibilityIdentifier("activity-metric-\(metric.id)")
                        if metric.id != metrics.last?.id { Divider() }
                    }
                }
                .padding(.horizontal, 16)
                .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: AppTheme.cornerRadius))
            }
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        BrowseSectionHeading(title: title)
    }
}

extension ActivityDetailContent where Profile == EmptyView, Photos == EmptyView {
    init(activity: Activity) {
        self.init(activity: activity, profile: { _ in EmptyView() }, photos: { _ in EmptyView() })
    }
}

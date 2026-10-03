import SwiftUI

/// Shared by List navigation, wide List detail and the Map results panel. Each headline owns
/// related recorded context, like the web card, without deriving missing data.
struct ActivityDetailContent<Profile: View, Photos: View>: View {
    let activity: Activity
    @Environment(\.activityDetailOverMap) private var overMap
    var headerTrailingInset: CGFloat = 0
    var showsHeading = true
    @ViewBuilder var profile: (Activity) -> Profile
    @ViewBuilder var photos: (Activity) -> Photos
    @Environment(\.dynamicTypeSize) private var typeSize

    private var rows: [ActivityMetricRow] { ActivityMetricRow.rows(for: activity) }
    private var columns: [GridItem] {
        if typeSize.isAccessibilitySize { return [GridItem(.flexible(), alignment: .leading)] }
        // Use the content width, including inside a narrow iPad map panel,
        // rather than inheriting the size class of the entire window.
        return [GridItem(.adaptive(minimum: AppTheme.minimumDetailColumnWidth), alignment: .leading)]
    }
    private var supplementary: [ActivityMetricRow] {
        let ids = ["averageHeartrate", "maxHeartrate", "calories", "kilojoules"]
            + (rows.contains { $0.id == "weightedAverageWatts" } ? [] : ["averageWatts", "maxWatts"])
        return rows.filter { ids.contains($0.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
            if showsHeading {
                ActivityDetailIdentity(activity: activity, trailingInset: headerTrailingInset)
            }
            if activity.isPrivate == true || activity.commute == true || activity.trainer == true || activity.flagged == true {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { badges }
                    VStack(alignment: .leading, spacing: 4) { badges }
                }
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: AppTheme.Spacing.medium) {
                highlight("Distance", value: Formatters.distance(activity.distance),
                          context: context([("averageSpeed", "avg"), ("maxSpeed", "max")]))
                highlight("Moving time", value: Formatters.duration(activity.movingTime),
                          context: context([("elapsedTime", "elapsed")]))
                highlight("Elevation gain", value: elevationGain,
                          context: context([("elevLow", "min"), ("elevHigh", "max")]))
                if let power = rows.first(where: { $0.id == "weightedAverageWatts" }) {
                    highlight("Weighted power", value: power.value,
                              context: context([("averageWatts", "avg"), ("maxWatts", "max")]))
                }
            }
            if !supplementary.isEmpty {
                Divider()
                LazyVGrid(columns: columns, alignment: .leading, spacing: AppTheme.Spacing.small) {
                    ForEach(supplementary) { metric in
                        BrowseMetricValue(title: metric.title, value: metric.value, valueFirst: true)
                            .accessibilityIdentifier("activity-metric-\(metric.id)")
                    }
                }
            }
            profile(activity)
            photos(activity)
            if let description = activity.description, !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(description).font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            DisclosureGroup {
                VStack(spacing: 0) {
                    ForEach(rows.filter { !["date", "distance", "movingTime", "elapsedTime", "elevationGain"].contains($0.id) }) { metric in
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline, spacing: AppTheme.Spacing.small) {
                                Text(metric.title).foregroundStyle(AppTheme.secondaryText).fixedSize()
                                Spacer(minLength: 4)
                                Text(metric.value).fontWeight(.medium).monospacedDigit().fixedSize()
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(metric.title).foregroundStyle(AppTheme.secondaryText)
                                Text(metric.value).fontWeight(.medium).monospacedDigit()
                            }
                        }
                        .font(.caption)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, AppTheme.Spacing.small)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(metric.title)
                        .accessibilityValue(metric.value)
                        .accessibilityIdentifier("activity-metric-\(metric.id)")
                    }
                }
            } label: {
                Text("All recorded details").font(.subheadline)
                    .frame(minHeight: AppTheme.minimumTarget, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, AppTheme.Spacing.large)
        .padding(.vertical, AppTheme.Spacing.small)
        .background { if !overMap { AppTheme.surface } }
    }

    private var elevationGain: String {
        let value = Formatters.elevation(activity.totalElevationGain)
        guard value != Formatters.unknown, let gain = activity.totalElevationGain, gain >= 0 else { return value }
        return "+\(value)"
    }

    // Each sibling contributes independently. A measured maximum or zero must
    // survive even when its average/minimum/primary measurement is missing.
    private func context(_ fields: [(String, String)]) -> String? {
        let parts = fields.compactMap { id, suffix in
            rows.first { $0.id == id }.map { "\($0.value) \(suffix)" }
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func highlight(_ title: String, value: String, context: String? = nil) -> some View {
        BrowseMetricValue(title: title, value: value, emphasis: .detail, context: context, valueFirst: true)
    }

    @ViewBuilder private var badges: some View {
        if activity.isPrivate == true { BrowseBadge(title: "Private", systemImage: "lock") }
        if activity.commute == true { BrowseBadge(title: "Commute", systemImage: "arrow.left.arrow.right") }
        if activity.trainer == true { BrowseBadge(title: "Indoor", systemImage: "house") }
        if activity.flagged == true { BrowseBadge(title: "Flagged", systemImage: "flag") }
    }
}

/// Shared identity stays in one place while Map summary grows into detail.
struct ActivityDetailIdentity: View {
    let activity: Activity
    var trailingInset: CGFloat = 0

    var body: some View {
        HStack(alignment: .top, spacing: AppTheme.Spacing.small) {
            BrowseSportSymbol(category: activity.category)
            VStack(alignment: .leading, spacing: AppTheme.Spacing.tight) {
                Text(activity.name).font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("activity-detail-name")
                Text("\(activity.sportType.rawValue) · \(Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt))")
                    .font(.caption).foregroundStyle(AppTheme.secondaryText)
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

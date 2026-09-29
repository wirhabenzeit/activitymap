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
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Label(activity.sportType.rawValue.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression), systemImage: activity.category.symbolName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(activity.name)
                    .font(.title2.bold())
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

            if typeSize.isAccessibilitySize {
                VStack(spacing: 12) { highlights }
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) { highlights }.fixedSize(horizontal: true, vertical: false)
                    VStack(spacing: 12) { highlights }
                }
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
        if activity.isPrivate == true { Label("Private", systemImage: "lock") }
        if activity.commute == true { Label("Commute", systemImage: "arrow.left.arrow.right") }
        if activity.trainer == true { Label("Indoor", systemImage: "house") }
        if activity.flagged == true { Label("Flagged", systemImage: "flag") }
    }

    @ViewBuilder private var highlights: some View {
        highlight("Distance", value: Formatters.distance(activity.distance))
        highlight("Elapsed time", value: Formatters.duration(activity.elapsedTime))
        highlight("Elevation gain", value: Formatters.elevation(activity.totalElevationGain))
    }

    private func highlight(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(uiColor: .tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(value == Formatters.unknown ? "Not recorded" : value)
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
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.headline).accessibilityAddTraits(.isHeader)
    }
}

extension ActivityDetailContent where Profile == EmptyView, Photos == EmptyView {
    init(activity: Activity) {
        self.init(activity: activity, profile: { _ in EmptyView() }, photos: { _ in EmptyView() })
    }
}

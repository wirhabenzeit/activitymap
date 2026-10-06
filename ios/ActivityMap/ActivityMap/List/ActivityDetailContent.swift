import SwiftUI

/// Shared hierarchy for Map and List; see docs/activity-detail-presentation.md.
struct ActivityDetailContent<Profile: View, Photos: View>: View {
    let activity: Activity
    @Environment(\.activityDetailOverMap) private var overMap
    var headerTrailingInset: CGFloat = 0
    var showsHeading = true
    var showsPrimaryMetrics = true
    var showsDescription = true
    /// Puts the route action beside the title (List, iPad pane, Stats sheet).
    var hasRoute = true
    var showOnMap: ((Int) -> Void)? = nil
    @ViewBuilder var profile: (Activity) -> Profile
    @ViewBuilder var photos: (Activity) -> Photos
    @Environment(\.dynamicTypeSize) private var typeSize

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), alignment: .leading), count: typeSize.isAccessibilitySize ? 1 : 2)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
            if showsHeading {
                ActivityDetailHeading(activity: activity, trailingInset: headerTrailingInset,
                                      hasRoute: hasRoute, showOnMap: showOnMap)
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

/// An activity's title row. The route action sits beside the title rather
/// than in a footer row; Edit, Strava refresh, GPX and Open in Strava
/// (#220–#222) join it as a ••• menu once they exist.
struct ActivityDetailHeading: View {
    let activity: Activity
    var trailingInset: CGFloat = 0
    var titleLineLimit: Int? = nil
    var hasRoute = true
    var showOnMap: ((Int) -> Void)? = nil
    @Environment(\.activityDetailOverMap) private var overMap
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var width: CGFloat = 0

    /// Rows this wide keep a readable title beside "Show on map" (iPhone
    /// landscape, full-width iPad). Narrower rows and accessibility text
    /// sizes show the icon alone.
    static let labelledWidth: CGFloat = 520
    private var labelled: Bool { width >= Self.labelledWidth && !typeSize.isAccessibilitySize }
    private var title: String { overMap ? "Fit route" : "Show on map" }
    private var icon: String { overMap ? "arrow.up.left.and.arrow.down.right" : "map" }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.tight) {
            HStack(alignment: .center, spacing: AppTheme.Spacing.small) {
                ActivityDetailIdentity(activity: activity, titleLineLimit: titleLineLimit)
                if let showOnMap {
                    Button { showOnMap(activity.id) } label: {
                        if labelled {
                            Label(title, systemImage: icon)
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 14)
                                .frame(minHeight: 36)
                                .background(AppTheme.selectionBackground, in: Capsule())
                                .frame(minHeight: AppTheme.minimumTarget)
                        } else {
                            // Grows with Dynamic Type instead of clipping the symbol.
                            Image(systemName: icon)
                                .font(.body.weight(.semibold))
                                .padding(10)
                                .frame(minWidth: AppTheme.minimumTarget, minHeight: AppTheme.minimumTarget)
                                .background(AppTheme.selectionBackground, in: Circle())
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(AppTheme.accent)
                    .contentShape(Rectangle())
                    .disabled(!hasRoute)
                    .opacity(hasRoute ? 1 : 0.4)
                    .accessibilityLabel(title)
                    .accessibilityIdentifier("activity-show-on-map")
                    .accessibilityHint(hasRoute ? (overMap ? "Frame this route while keeping its elevation profile visible" : "Select this activity and frame its route") : "This activity has no GPS route")
                }
            }
            if showOnMap != nil && !hasRoute {
                Text("No GPS route recorded").font(.caption).foregroundStyle(AppTheme.secondaryText)
                    .accessibilityIdentifier("activity-no-route")
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .padding(.trailing, trailingInset)
    }
}

extension ActivityDetailContent where Profile == EmptyView, Photos == EmptyView {
    init(activity: Activity, headerTrailingInset: CGFloat = 0, showsHeading: Bool = true) {
        self.init(activity: activity, headerTrailingInset: headerTrailingInset, showsHeading: showsHeading, profile: { _ in EmptyView() }, photos: { _ in EmptyView() })
    }
}

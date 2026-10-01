import SwiftUI

/// Sheet wrapper only. The panel is also embedded in the wide list expansion.
struct ActivityDetailView: View {
    @Bindable var store: ActivityStore
    let activityID: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ActivityDetailPanel(store: store, activityID: activityID)
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .presentationBackground(AppTheme.surface)
            // The content's activity name is the sheet heading. Keep the
            // native escape gesture available without duplicating a toolbar.
            .accessibilityAction(.escape) { dismiss() }
    }
}

/// Resolve by identity on every update, never retain the sheet's initial snapshot.
/// The action bar is outside the scroll view so long content cannot bury actions.
struct ActivityDetailPanel: View {
    @Environment(\.activityDetailOverMap) private var overMap
    @Bindable var store: ActivityStore
    let activityID: Int
    var headerTrailingInset: CGFloat = 0
    var showOnMap: ((Int) -> Void)? = nil

    private var activity: Activity? { store.activities.first { $0.id == activityID } }

    var body: some View {
        Group {
            if let activity {
                VStack(spacing: 0) {
                    ScrollView {
                        ActivityDetailContent(activity: activity, headerTrailingInset: headerTrailingInset)
                    }
                    .accessibilityIdentifier("activity-detail-scroll")
                    .clipped()
                    ActivityDetailActions(activity: activity) { id in
                        if let showOnMap { showOnMap(id) }
                        else { store.showOnMap(id) }
                    }
                }
            } else {
                ContentUnavailableView("Activity unavailable", systemImage: "figure.run.circle",
                                       description: Text("This activity is no longer in your library."))
            }
        }
        .background { if !overMap { AppTheme.surface } }
    }
}

/// Single integration point for real edit/refresh/share actions (#220–#222).
/// Until those land, the menu explicitly identifies them as unavailable.
private struct ActivityDetailActions: View {
    @Environment(\.activityDetailOverMap) private var overMap
    let activity: Activity
    let showOnMap: (Int) -> Void

    private var hasRoute: Bool { RouteExtent(coordinates: activity.coordinates) != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Button {
                    showOnMap(activity.id)
                } label: {
                    Label("Show on map", systemImage: "map")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(AppTheme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: AppTheme.cornerRadius))
                }
                .buttonStyle(.plain)
                .foregroundStyle(AppTheme.accent)
                .disabled(!hasRoute)
                .accessibilityIdentifier("activity-show-on-map")
                .accessibilityHint(hasRoute ? "Select this activity and frame its route" : "This activity has no GPS route")
                Menu {
                    Section("Not available yet") {
                        Button("Edit activity", systemImage: "pencil") {}.disabled(true)
                        Button("Refresh from Strava", systemImage: "arrow.clockwise") {}.disabled(true)
                        Button("Share GPX", systemImage: "square.and.arrow.up") {}.disabled(true)
                        Button("Open in Strava", systemImage: "arrow.up.right.square") {}.disabled(true)
                    }
                } label: {
                    BrowseIconLabel(systemImage: "ellipsis")
                }
                .accessibilityLabel("More activity actions")
                .accessibilityHint("Editing, refresh, GPX sharing and Strava links are not available yet")
            }
            if !hasRoute {
                Text("No GPS route recorded").font(.caption).foregroundStyle(AppTheme.secondaryText)
            }
        }
        .padding(.horizontal, AppTheme.Spacing.large)
        .padding(.vertical, AppTheme.Spacing.small)
        .background { if !overMap { AppTheme.surface } }
    }
}

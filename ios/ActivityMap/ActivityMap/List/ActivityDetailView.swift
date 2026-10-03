import SwiftUI

/// Native List navigation destination. Wide List and Map host the same panel.
struct ActivityDetailView: View {
    @Bindable var store: ActivityStore
    let activityID: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ActivityDetailPanel(store: store, activityID: activityID)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            // The activity name remains the content heading. Native Back and
            // swipe-back return to the retained List without a second title.
            .accessibilityAction(.escape) { dismiss() }
    }
}

/// Resolve by identity on every update, never retain the destination's initial snapshot.
/// The action bar is outside the scroll view so long content cannot bury actions.
struct ActivityDetailPanel: View {
    @Environment(\.activityDetailOverMap) private var overMap
    @Bindable var store: ActivityStore
    let activityID: Int
    var headerTrailingInset: CGFloat = 0
    var mapExpansion: MapActivityExpansion? = nil
    var showOnMap: ((Int) -> Void)? = nil

    private var activity: Activity? { store.activity(id: activityID) }

    var body: some View {
        Group {
            if let activity {
                if let mapExpansion {
                    MapActivityDetailReveal(activity: activity, expansion: mapExpansion,
                                            trailingInset: headerTrailingInset, hasRoute: store.routableActivityIDs.contains(activityID),
                                            summary: "\(Formatters.distance(activity.distance))  ·  \(Formatters.duration(activity.elapsedTime))  ·  \(Formatters.elevation(activity.totalElevationGain)) ↑") { id in
                        if let showOnMap { showOnMap(id) }
                        else { store.showOnMap(id) }
                    }
                } else {
                    VStack(spacing: 0) {
                        ScrollView {
                            ActivityDetailContent(activity: activity, headerTrailingInset: headerTrailingInset)
                        }
                        .accessibilityIdentifier("activity-detail-scroll")
                        .clipped()
                        ActivityDetailActions(activity: activity, hasRoute: store.routableActivityIDs.contains(activityID)) { id in
                            if let showOnMap { showOnMap(id) }
                            else { store.showOnMap(id) }
                        }
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

/// The heading is one persistent element. Compact metrics fade out before
/// full metrics appear below it; there are never two activity-title layers.
private struct MapActivityDetailReveal: View {
    let activity: Activity
    let expansion: MapActivityExpansion
    private var progress: CGFloat { expansion.progress }
    let trailingInset: CGFloat
    let hasRoute: Bool
    let summary: String
    let showOnMap: (Int) -> Void
    @State private var summaryHeight: CGFloat = 20
    @State private var actionHeight: CGFloat = 64
    private var reveal: CGFloat { min(1, max(0, (progress - 0.25) / 0.75)) }

    var body: some View {
        VStack(spacing: 0) {
            ActivityDetailIdentity(activity: activity, trailingInset: trailingInset)
                .padding(.horizontal, AppTheme.Spacing.large)
                .padding(.vertical, AppTheme.Spacing.small)
            Text(summary)
                .font(.caption).foregroundStyle(AppTheme.secondaryText)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, AppTheme.Spacing.large)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { summaryHeight = $0 }
                .opacity(max(0, 1 - progress * 4))
                .frame(height: summaryHeight * (1 - progress), alignment: .top)
                .clipped()
                .accessibilityHidden(progress > 0.25)
            ScrollView {
                ActivityDetailContent(activity: activity, showsHeading: false)
            }
            .accessibilityIdentifier("activity-detail-scroll")
            .opacity(reveal)
            .clipped()
            .allowsHitTesting(progress > 0.8)
            .accessibilityHidden(progress < 0.8)
            ActivityDetailActions(activity: activity, hasRoute: hasRoute, showOnMap: showOnMap)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { actionHeight = $0 }
                .opacity(reveal)
                .frame(height: actionHeight * reveal, alignment: .bottom)
                .clipped()
                .allowsHitTesting(progress > 0.8)
                .accessibilityHidden(progress < 0.8)
        }
    }
}

/// Single integration point for real edit/refresh/share actions (#220–#222).
/// Add those actions when implemented; the current surface contains only working actions.
private struct ActivityDetailActions: View {
    @Environment(\.activityDetailOverMap) private var overMap
    let activity: Activity
    let hasRoute: Bool
    let showOnMap: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Button {
                    showOnMap(activity.id)
                } label: {
                    Label(overMap ? "Fit route" : "Show on map", systemImage: overMap ? "arrow.up.left.and.arrow.down.right" : "map")
                        .font(.subheadline.weight(.medium))
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(AppTheme.accent)
                .disabled(!hasRoute)
                .accessibilityIdentifier("activity-show-on-map")
                .accessibilityHint(hasRoute ? (overMap ? "Collapse detail and frame this route, leaving room to reopen detail" : "Select this activity and frame its route") : "This activity has no GPS route")
                Spacer(minLength: 0)
            }
            if !hasRoute {
                Text("No GPS route recorded").font(.caption).foregroundStyle(AppTheme.secondaryText)
            }
        }
        .padding(.horizontal, AppTheme.Spacing.large)
        .padding(.vertical, AppTheme.Spacing.tight)
        .background { if !overMap { AppTheme.surface } }
        .overlay(alignment: .top) { Divider() }
    }
}

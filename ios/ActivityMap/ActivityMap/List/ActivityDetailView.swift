import SwiftUI
import UIKit

/// Native List navigation destination. Wide List and Map host the same panel.
struct ActivityDetailView: View {
    @Bindable var store: ActivityStore
    let activityID: Int
    var backLabel = "Back to activities"
    var backIdentifier = "list-detail-back"
    var onMapShown: (() -> Void)? = nil
    var hostTab = AppTab.list
    @Environment(\.dismiss) private var dismiss
    @AppToolbarEnvironment private var toolbarLayout
    @State private var navigationReference = DetailNavigationReference()

    var body: some View {
        ActivityDetailPanel(store: store, activityID: activityID, showsHeading: false, hostTab: hostTab)
        .background(AppTheme.surface)
        .navigationBarBackButtonHidden()
        .appNavigationBar(toolbar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if hostTab == .list && toolbarLayout.packsListControls {
                SelectionBar(store: store, includesTotal: true, expandsCount: true)
                    .padding(.horizontal, 8).background(.bar)
            }
        }
        .background(DetailBackGesture(navigationReference: navigationReference))
        .accessibilityAction(.escape) { dismiss() }
    }

    private var toolbar: AppToolbar {
        AppToolbar(leading: AnyView(AppToolbarBackButton(label: backLabel, identifier: backIdentifier) { dismiss() }),
            principal: AnyView(Group {
                if let activity = store.activity(id: activityID) {
                    ActivityDetailIdentity(activity: activity, titleLineLimit: toolbarLayout.titleLineLimit, onNavigationBar: true)
                }
            }), trailing: AnyView(HStack(spacing: AppToolbarLayout.spacing) {
                if let editing = store.activityEditing, let activity = store.activity(id: activityID) {
                    ActivityEditButton(activity: activity, service: editing, onNavigationBar: true)
                }
                Button {
                    showActivityOnMapFromDetail(activityID, store: store, navigationController: navigationReference.controller)
                    onMapShown?()
                } label: {
                    Image(systemName: "map")
                        .font(.body.weight(.semibold))
                        .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
                        .background(.white.opacity(0.18), in: Circle())
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .disabled(!store.routableActivityIDs.contains(activityID))
                .opacity(store.routableActivityIDs.contains(activityID) ? 1 : 0.4)
                .accessibilityLabel("Show on map")
                .accessibilityIdentifier("activity-show-on-map")
                .accessibilityHint(store.routableActivityIDs.contains(activityID)
                    ? "Select this activity and frame its route" : "This activity has no GPS route")
            }))
    }

}

/// This action changes browsing destinations, rather than going Back to List.
/// Remove the pushed detail in the same transaction as the tab switch so the
/// retained Map cannot present its results sheet over an outgoing List page.
@MainActor func showActivityOnMapFromDetail(_ activityID: Int, store: ActivityStore,
                                         navigationController: UINavigationController?) {
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction) {
        if store.showOnMap(activityID) == .shown {
            store.dismissInspection()
            // An Observation-driven destination binding can still animate a
            // pop despite disablesAnimations. Finish the native stack now too.
            navigationController?.popToRootViewController(animated: false)
        }
    }
}

/// Resolve by identity on every update, never retain the destination's initial snapshot.
/// Editing/map actions stay by the title; Strava/GPX rows scroll with detail.
struct ActivityDetailPanel: View {
    @Environment(\.activityDetailOverMap) private var overMap
    @Bindable var store: ActivityStore
    let activityID: Int
    var headerTrailingInset: CGFloat = 0
    var showsHeading = true
    var mapExpansion: MapActivityExpansion? = nil
    var compactMapProfile = false
    var mapBottomContentInset: CGFloat = 0
    /// Only the visible tab's panel loads its elevation profile.
    var hostTab = AppTab.list
    var showOnMap: ((Int) -> Void)? = nil

    private var activity: Activity? { store.activity(id: activityID) }

    var body: some View {
        Group {
            if let activity {
                if let mapExpansion {
                    MapActivityDetailReveal(store: store, activity: activity, expansion: mapExpansion, compactProfile: compactMapProfile,
                                            bottomContentInset: mapBottomContentInset,
                                            trailingInset: headerTrailingInset, hasRoute: store.routableActivityIDs.contains(activityID)) { id in
                        if let showOnMap { showOnMap(id) }
                        else if overMap { store.mapContext.request(.fitActivity(id)) }
                        else { store.showOnMap(id) }
                    }
                } else {
                    ScrollView {
                        ActivityDetailContent(activity: activity, headerTrailingInset: headerTrailingInset,
                                              showsHeading: showsHeading,
                                              hasRoute: store.routableActivityIDs.contains(activityID),
                                              showOnMap: { id in
                            if let showOnMap { showOnMap(id) }
                            else if overMap { store.mapContext.request(.fitActivity(id)) }
                            else { store.showOnMap(id) }
                        }, editing: store.activityEditing, streamSummaries: store.streamSummaries, exportStore: store, profile: { activity in
                            ElevationProfileView(store: store, activityID: activity.id,
                                                 isRelevant: store.selectedTab == hostTab)
                        }, photos: { activity in PhotoGalleryView(store: store, activityID: activity.id) })
                    }
                    .accessibilityIdentifier("activity-detail-scroll")
                    .clipped()
                }
            } else {
                ContentUnavailableView("Activity unavailable", systemImage: "figure.run.circle",
                                       description: Text("This activity is no longer in your library."))
            }
        }
        .background { if !overMap { AppTheme.surface } }
    }
}

/// Keep the heading stable across sheet sizes. Phone cards show the profile
/// followed by one stats row, leaving the route visible above the sheet.
private struct MapActivityDetailReveal: View {
    let store: ActivityStore
    let activity: Activity
    let expansion: MapActivityExpansion
    let compactProfile: Bool
    let bottomContentInset: CGFloat
    @Environment(\.dynamicTypeSize) private var typeSize
    // Side panels reveal a fixed-height viewport when expanded. Keep their
    // content layout stable while the outer host collapses or expands.
    private var progress: CGFloat { compactProfile ? expansion.progress : 1 }
    let trailingInset: CGFloat
    let hasRoute: Bool
    let showOnMap: (Int) -> Void
    private var reveal: CGFloat { min(1, max(0, (progress - 0.25) / 0.75)) }

    var body: some View {
        VStack(spacing: 0) {
            heading
            ScrollView { fullDetail.padding(.bottom, bottomContentInset) }
                .accessibilityIdentifier("activity-detail-scroll")
                .clipped()
                .allowsHitTesting(progress > 0.8)
        }
    }

    // A short side panel must retain space to scroll at accessibility sizes.
    // The title remains complete in VoiceOver and the activity editor.
    private var titleLineLimit: Int {
        if !compactProfile && typeSize.isAccessibilitySize { return 1 }
        return progress > 0.8 ? 2 : 1
    }

    // The Map title row has no duplicate Fit action; the group header owns it.
    private var heading: some View {
        ActivityDetailHeading(activity: activity, trailingInset: trailingInset,
                              titleLineLimit: titleLineLimit,
                              hasRoute: hasRoute, showOnMap: showOnMap, editing: store.activityEditing)
            .padding(.horizontal, AppTheme.Spacing.large)
            .padding(.vertical, AppTheme.Spacing.small)
    }

    private var fullDetail: some View {
        VStack(spacing: 0) {
            if compactProfile {
                VStack(spacing: 16) {
                    elevation
                    ActivityDetailDescription(activity: activity)
                    Divider()
                    ActivityHeadlineStats(activity: activity)
                }
                .padding(.horizontal, AppTheme.Spacing.large)
                .padding(.vertical, AppTheme.Spacing.small)
                ActivityDetailContent(activity: activity, showsHeading: false, showsPrimaryMetrics: false, showsDescription: false,
                                      streamSummaries: store.streamSummaries, exportStore: store,
                                      profile: { _ in EmptyView() }, photos: { activity in PhotoGalleryView(store: store, activityID: activity.id) })
            } else {
                ActivityDetailContent(activity: activity, showsHeading: false,
                                      streamSummaries: store.streamSummaries, exportStore: store,
                                      profile: { _ in elevation }, photos: { activity in PhotoGalleryView(store: store, activityID: activity.id) })
            }
        }
        .opacity(reveal)
        .allowsHitTesting(progress > 0.8)
        .accessibilityHidden(progress < 0.8)
    }

    private var elevation: some View {
        ElevationProfileView(store: store, activityID: activity.id,
            isRelevant: expansion.progress > 0.8 && store.selectedTab == .map && store.activeActivityID == activity.id,
            compact: compactProfile)
    }
}

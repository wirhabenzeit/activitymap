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
    @State private var navigationReference = DetailNavigationReference()

    var body: some View {
        ActivityDetailPanel(store: store, activityID: activityID, showsHeading: false, hostTab: hostTab)
        .background(AppTheme.surface)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(AppTheme.navigationBlue, for: .navigationBar)
        .toolbarBackgroundVisibility(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 20, weight: .medium))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .accessibilityLabel(backLabel)
                .accessibilityIdentifier(backIdentifier)
            }.sharedBackgroundVisibility(.hidden)
            ToolbarItem(placement: .principal) {
                if let activity = store.activity(id: activityID) {
                    ActivityDetailIdentity(activity: activity, titleLineLimit: 2, onNavigationBar: true)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showActivityOnMapFromDetail(activityID, store: store, navigationController: navigationReference.controller)
                    onMapShown?()
                } label: {
                    Image(systemName: "map")
                        .font(.body.weight(.semibold))
                        .frame(width: 44, height: 44)
                        .background(.white.opacity(0.18), in: Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .disabled(!store.routableActivityIDs.contains(activityID))
                .opacity(store.routableActivityIDs.contains(activityID) ? 1 : 0.4)
                .accessibilityLabel("Show on map")
                .accessibilityIdentifier("activity-show-on-map")
                .accessibilityHint(store.routableActivityIDs.contains(activityID)
                    ? "Select this activity and frame its route" : "This activity has no GPS route")
            }.sharedBackgroundVisibility(.hidden)
        }
        .background(DetailBackGesture(navigationReference: navigationReference))
        .accessibilityAction(.escape) { dismiss() }
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
/// Actions live in the title row, so no footer bar takes height from the content.
struct ActivityDetailPanel: View {
    @Environment(\.activityDetailOverMap) private var overMap
    @Bindable var store: ActivityStore
    let activityID: Int
    var headerTrailingInset: CGFloat = 0
    var showsHeading = true
    var mapExpansion: MapActivityExpansion? = nil
    var compactMapProfile = false
    var scrollsMapHeading = false
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
                                            scrollsHeading: scrollsMapHeading, bottomContentInset: mapBottomContentInset,
                                            trailingInset: headerTrailingInset, hasRoute: store.routableActivityIDs.contains(activityID)) { id in
                        if let showOnMap { showOnMap(id) }
                        else { store.showOnMap(id) }
                    }
                } else {
                    ScrollView {
                        ActivityDetailContent(activity: activity, headerTrailingInset: headerTrailingInset,
                                              showsHeading: showsHeading,
                                              hasRoute: store.routableActivityIDs.contains(activityID),
                                              showOnMap: { id in
                            if let showOnMap { showOnMap(id) }
                            else { store.showOnMap(id) }
                        }, profile: { activity in
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
    let scrollsHeading: Bool
    let bottomContentInset: CGFloat
    private var progress: CGFloat { scrollsHeading ? 1 : expansion.progress }
    let trailingInset: CGFloat
    let hasRoute: Bool
    let showOnMap: (Int) -> Void
    private var reveal: CGFloat { min(1, max(0, (progress - 0.25) / 0.75)) }

    var body: some View {
        if scrollsHeading {
            // Keep the entire landscape/iPad detail in the stable scroll viewport.
            ScrollView {
                VStack(spacing: 0) {
                    heading
                    fullDetail
                }
                .padding(.bottom, bottomContentInset)
            }
            .accessibilityIdentifier("activity-detail-scroll")
            .clipped()
        } else {
            VStack(spacing: 0) {
                heading
                ScrollView { fullDetail.padding(.bottom, bottomContentInset) }
                    .accessibilityIdentifier("activity-detail-scroll")
                    .clipped()
                    .allowsHitTesting(progress > 0.8)
            }
        }
    }

    // The same title row and map button as List and Stats; here it fits the route.
    private var heading: some View {
        ActivityDetailHeading(activity: activity, trailingInset: trailingInset,
                              titleLineLimit: compactProfile ? (expansion.progress > 0.8 ? 2 : 1) : nil,
                              hasRoute: hasRoute, showOnMap: showOnMap)
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
                                      profile: { _ in EmptyView() }, photos: { activity in PhotoGalleryView(store: store, activityID: activity.id) })
            } else {
                ActivityDetailContent(activity: activity, showsHeading: false,
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

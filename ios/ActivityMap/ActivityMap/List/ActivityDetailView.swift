import SwiftUI
import UIKit

/// Native List navigation destination. Wide List and Map host the same panel.
struct ActivityDetailView: View {
    @Bindable var store: ActivityStore
    let activityID: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: AppTheme.Spacing.small) {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 20, weight: .medium))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Back to activities")
                .accessibilityIdentifier("list-detail-back")
                if let activity = store.activity(id: activityID) {
                    ActivityDetailHeading(activity: activity, titleLineLimit: 2,
                                          hasRoute: store.routableActivityIDs.contains(activityID)) { id in
                        store.showOnMap(id)
                    }
                } else {
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            ActivityDetailPanel(store: store, activityID: activityID, showsHeading: false)
        }
        .background(AppTheme.surface)
        // UIKit adds a late top inset when a hidden bar is shown during a
        // push. Keep chrome in the sliding content so its geometry is fixed.
        .toolbar(.hidden, for: .navigationBar)
        .background(ListDetailBackGesture())
        .accessibilityAction(.escape) { dismiss() }
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
                                                 isRelevant: store.selectedTab == .list)
                        }, photos: { _ in EmptyView() })
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

    private var heading: some View {
        HStack(alignment: .top, spacing: 8) {
            ActivityDetailIdentity(activity: activity, trailingInset: trailingInset,
                                   titleLineLimit: compactProfile ? (expansion.progress > 0.8 ? 2 : 1) : nil)
            Button { showOnMap(activity.id) } label: {
                Image(systemName: "arrow.up.left.and.arrow.down.right")
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(AppTheme.accent)
            .disabled(!hasRoute)
            .accessibilityLabel("Fit route")
            .accessibilityIdentifier("activity-show-on-map")
            .accessibilityHint(hasRoute ? "Frame this route while keeping its elevation profile visible" : "This activity has no GPS route")
        }
        .padding(.horizontal, AppTheme.Spacing.large)
        .padding(.vertical, AppTheme.Spacing.small)
    }

    private var fullDetail: some View {
        VStack(spacing: 0) {
            if !hasRoute {
                Text("No GPS route recorded")
                    .font(.caption).foregroundStyle(AppTheme.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, AppTheme.Spacing.large)
                    .accessibilityIdentifier("activity-no-route")
            }
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
                                      profile: { _ in EmptyView() }, photos: { _ in EmptyView() })
            } else {
                ActivityDetailContent(activity: activity, showsHeading: false,
                                      profile: { _ in elevation }, photos: { _ in EmptyView() })
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

/// A hidden navigation bar normally disables UIKit's interactive pop gesture.
/// Keep the native transition recognizer, with a depth/transition guard, and
/// restore its original delegate when this detail leaves the hierarchy.
private struct ListDetailBackGesture: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {}
    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) {
        controller.restore()
    }

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        private weak var gesture: UIGestureRecognizer?
        private weak var previousDelegate: (any UIGestureRecognizerDelegate)?
        private var previousEnabled = false

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard let recognizer = navigationController?.interactivePopGestureRecognizer else { return }
            guard recognizer.delegate !== self else { return }
            gesture = recognizer
            previousDelegate = recognizer.delegate
            previousEnabled = recognizer.isEnabled
            recognizer.delegate = self
            recognizer.isEnabled = true
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            restore()
        }

        func restore() {
            guard let gesture, gesture.delegate === self else { return }
            gesture.delegate = previousDelegate
            gesture.isEnabled = previousEnabled
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let navigationController else { return false }
            return navigationController.viewControllers.count > 1
                && navigationController.transitionCoordinator == nil
        }
    }
}

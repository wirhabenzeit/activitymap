import SwiftUI
import UIKit
import Observation

/// Results and their detail are two levels of one native navigation stack.
/// The sheet and results controller survive pushes, activity changes and rotation.
struct MapResultsNavigation: UIViewControllerRepresentable {
    let store: ActivityStore
    let picker: RoutePicker
    let detailID: Int?
    let results: AnyView
    var expansion: CGFloat = 1
    var compactProfile = false
    var bottomContentInset: CGFloat = 0
    @Environment(\.self) private var environment
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UINavigationController {
        let root = UIHostingController(rootView: rootContent)
        root.view.backgroundColor = .clear
        root.view.accessibilityIdentifier = "map-results-navigation-root"
        root.safeAreaRegions = []
        let navigation = UINavigationController(rootViewController: root)
        navigation.setNavigationBarHidden(true, animated: false)
        navigation.view.backgroundColor = .clear
        navigation.view.accessibilityIdentifier = "map-results-navigation"
        navigation.delegate = context.coordinator
        context.coordinator.root = root
        context.coordinator.navigation = navigation
        context.coordinator.update(self)
        return navigation
    }

    func updateUIViewController(_ controller: UINavigationController, context: Context) {
        context.coordinator.update(self)
    }

    static func dismantleUIViewController(_ controller: UINavigationController, coordinator: Coordinator) {
        controller.delegate = nil
        coordinator.parent.picker.isPaging = false
    }

    private var rootContent: AnyView { AnyView(results.environment(\.self, environment)) }

    @MainActor final class Coordinator: NSObject, UINavigationControllerDelegate {
        var parent: MapResultsNavigation
        weak var navigation: UINavigationController?
        var root: UIHostingController<AnyView>?
        private(set) var detail: MapActivityDetailController?
        private var transitioning = false
        private var transitionGeneration = 0
        private var requestedPop = false

        init(_ parent: MapResultsNavigation) { self.parent = parent }

        func update(_ next: MapResultsNavigation) {
            parent = next
            root?.rootView = next.rootContent
            if let detail {
                detail.state.expansion.progress = next.expansion
                detail.rootView = destination(state: detail.state)
            }
            reconcile()
        }

        private func destination(state: MapActivityDetailState) -> AnyView {
            AnyView(MapActivityDetailDestination(store: parent.store, picker: parent.picker, state: state,
                compactProfile: parent.compactProfile, bottomContentInset: parent.bottomContentInset)
                .environment(\.self, parent.environment))
        }

        private func reconcile() {
            guard !transitioning, let navigation, let root else { return }
            if let id = parent.detailID {
                if let detail, navigation.viewControllers.contains(where: { $0 === detail }) {
                    guard detail.state.activityID != id else { return }
                    detail.state.motion = parent.picker.navigationMotion
                    detail.state.activityID = id
                    return
                }
                let state = MapActivityDetailState(activityID: id, expansion: parent.expansion)
                let detail = MapActivityDetailController(state: state, content: destination(state: state))
                self.detail = detail
                let animate = navigation.view.window != nil && !parent.reduceMotion && parent.picker.navigationMotion != .none
                navigation.pushViewController(detail, animated: animate)
            } else if navigation.topViewController !== root {
                requestedPop = true
                navigation.popToRootViewController(animated: navigation.view.window != nil && !parent.reduceMotion)
            }
        }

        func navigationController(_ navigationController: UINavigationController, willShow viewController: UIViewController, animated: Bool) {
            transitioning = true
            transitionGeneration &+= 1
            let generation = transitionGeneration
            DispatchQueue.main.async { [weak self] in
                guard let self, self.transitioning, self.transitionGeneration == generation else { return }
                self.parent.picker.isPaging = true
            }
        }

        func navigationController(_ navigationController: UINavigationController, didShow viewController: UIViewController, animated: Bool) {
            // Keep reconciliation fenced until the deferred state commit. A
            // layout update after a native pop must not re-push the stale ID.
            // UIKit can also call this synchronously for an unanimated push.
            let generation = transitionGeneration
            DispatchQueue.main.async { [weak self, weak navigationController, weak viewController] in
                guard let self, let navigationController, let viewController,
                      self.transitionGeneration == generation,
                      navigationController.topViewController === viewController else { return }
                self.transitioning = false
                self.parent.picker.isPaging = false
                if viewController === self.root {
                    self.detail = nil
                    if !self.requestedPop, self.parent.picker.detailID != nil {
                        // A completed native Back gesture changes presentation
                        // only. Its cancellation leaves selection/focus intact.
                        self.parent.picker.showResults()
                        self.requestedPop = false
                        return
                    }
                    self.requestedPop = false
                }
                self.reconcile()
            }
        }
    }
}

@MainActor @Observable
final class MapActivityDetailState {
    var activityID: Int
    var motion = RoutePicker.NavigationMotion.none
    let expansion: MapActivityExpansion
    init(activityID: Int, expansion: CGFloat) {
        self.activityID = activityID
        self.expansion = MapActivityExpansion(progress: expansion)
    }
}

@MainActor final class MapActivityDetailController: UIHostingController<AnyView> {
    let state: MapActivityDetailState
    init(state: MapActivityDetailState, content: AnyView) {
        self.state = state
        super.init(rootView: content)
        view.backgroundColor = .clear
        view.accessibilityIdentifier = "map-results-navigation-detail"
        // The sheet owns the bottom safe-area inset, included in detail content.
        safeAreaRegions = []
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
}

private struct MapActivityDetailDestination: View {
    @Bindable var store: ActivityStore
    @Bindable var picker: RoutePicker
    @Bindable var state: MapActivityDetailState
    let compactProfile: Bool
    let bottomContentInset: CGFloat

    private var sequence: ActivityDetailSequence {
        ActivityDetailSequence(ids: picker.candidateIDs, currentID: state.activityID)
    }
    private var paging: ActivityDetailPaging {
        ActivityDetailPaging(position: { id in
            ActivityDetailSequence(ids: picker.candidateIDs, currentID: id).position
        }, previous: { picker.step(-1, store: store) }, next: { picker.step(1, store: store) },
        canGoPrevious: { id in ActivityDetailSequence(ids: picker.candidateIDs, currentID: id).previousID != nil && !picker.isPaging },
        canGoNext: { id in ActivityDetailSequence(ids: picker.candidateIDs, currentID: id).nextID != nil && !picker.isPaging })
    }
    private var continuation: ActivityDetailContinuation? {
        let previous = sequence.previousID.flatMap { store.activity(id: $0) }
            .map { ActivityDetailContinuation.Destination(id: $0.id, name: $0.name) }
        let next = sequence.nextID.flatMap { store.activity(id: $0) }
            .map { ActivityDetailContinuation.Destination(id: $0.id, name: $0.name) }
        guard previous != nil || next != nil else { return nil }
        let currentID = state.activityID
        return ActivityDetailContinuation(currentID: currentID, previous: previous, next: next,
            // The ordinary opening sheet is already a usable scroll surface.
            // Reuse its visibility state instead of requiring a larger detent.
            isEnabled: store.selectedTab == .map && state.expansion.progress > 0.8 && picker.detailID == currentID && !picker.isPaging) { direction in
                // Recheck live order/selection after the pull; it may have
                // changed while the person was reading or dragging.
                let target = direction == .previous ? previous : next
                let liveSequence = ActivityDetailSequence(ids: picker.candidateIDs, currentID: currentID)
                let liveID = direction == .previous ? liveSequence.previousID : liveSequence.nextID
                guard let target, liveID == target.id, store.selectedTab == .map, state.expansion.progress > 0.8,
                      picker.detailID == currentID, !picker.isPaging else { return }
                picker.showDetail(target.id, store: store, motion: direction == .previous ? .backward : .forward)
            }
    }
    var body: some View {
        ZStack {
            ActivityDetailPanel(store: store, activityID: state.activityID,
                mapExpansion: state.expansion, compactMapProfile: compactProfile,
                mapBottomContentInset: bottomContentInset) { id in
                    store.mapContext.request(.fitActivity(id))
                }
                .environment(\.activityDetailOverMap, true)
                .environment(\.activityDetailPaging, paging)
                .environment(\.activityDetailContinuation, continuation)
                .environment(\.activityDetailTransitionDirection,
                             state.motion == .none ? nil : (state.motion == .backward ? .previous : .next))
        }
        .clipped()
        .background(DetailBackGesture())
    }
}

/// Observed only by the summary/detail reveal, below the stable hosting root.
@MainActor @Observable
final class MapActivityExpansion {
    var progress: CGFloat
    init(progress: CGFloat) { self.progress = progress }
}

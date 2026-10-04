import SwiftUI
import UIKit
import Observation

/// Native scroll physics owns the drag, cancellation and settling. Only the
/// current page and its neighbours are hosted, even for a large selection.
struct MapActivityPager: UIViewControllerRepresentable {
    let store: ActivityStore
    let picker: RoutePicker
    var expansion: CGFloat = 1
    var scrollsHeading = false
    var bottomContentInset: CGFloat = 0
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIPageViewController {
        let controller = UIPageViewController(transitionStyle: .scroll, navigationOrientation: .horizontal)
        controller.view.backgroundColor = .clear
        controller.delegate = context.coordinator
        context.coordinator.controller = controller
        context.coordinator.update(self)
        return controller
    }

    func updateUIViewController(_ controller: UIPageViewController, context: Context) {
        context.coordinator.update(self)
    }

    static func dismantleUIViewController(_ controller: UIPageViewController, coordinator: Coordinator) {
        controller.dataSource = nil
        controller.delegate = nil
        coordinator.parent.picker.isPaging = false
    }

    @MainActor final class Page: UIHostingController<AnyView> {
        let activityID: Int
        let expansion: MapActivityExpansion
        private(set) var contentUpdateCount = 0

        func replaceContent(_ content: AnyView) {
            rootView = content
            contentUpdateCount += 1
        }

        init(id: Int, expansion: MapActivityExpansion, content: AnyView) {
            activityID = id
            self.expansion = expansion
            super.init(rootView: content)
            view.backgroundColor = .clear
            // The outer Map sheet owns the home-indicator inset once.
            safeAreaRegions = []
        }
        @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
    }

    @MainActor final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
        var parent: MapActivityPager
        weak var controller: UIPageViewController?
        private(set) var pages: [Int: Page] = [:]
        private var transitioning = false

        init(_ parent: MapActivityPager) { self.parent = parent }

        func update(_ next: MapActivityPager) {
            let appearanceChanged = parent.colorScheme != next.colorScheme || parent.typeSize != next.typeSize
                || parent.sizeClass != next.sizeClass || parent.scrollsHeading != next.scrollsHeading
                || parent.bottomContentInset != next.bottomContentInset
            parent = next
            guard let controller else { return }
            if next.picker.candidateIDs.count > 1 {
                if controller.dataSource !== self { controller.dataSource = self }
            } else if controller.dataSource != nil { controller.dataSource = nil }
            // A frame changes only the small reveal subtree. Replacing hosting
            // roots at 60/120Hz redoes metrics, route checks and UIKit layout.
            for (id, page) in pages {
                var transaction = Transaction(animation: nil)
                transaction.disablesAnimations = true
                withTransaction(transaction) { page.expansion.progress = next.expansion }
                if appearanceChanged { page.replaceContent(content(id, expansion: page.expansion)) }
            }
            guard !transitioning, let id = next.picker.detailID else { return }
            if (controller.viewControllers?.first as? Page)?.activityID == id {
                prune(around: id)
                return
            }
            let direction: UIPageViewController.NavigationDirection = next.picker.navigationMotion == .backward ? .reverse : .forward
            let animate = !next.reduceMotion && next.picker.navigationMotion != .none && controller.viewControllers?.isEmpty == false
            transitioning = true
            controller.setViewControllers([page(id)], direction: direction, animated: animate) { [weak self] _ in
                guard let self else { return }
                self.transitioning = false
                self.prune(around: id)
                self.update(self.parent)
            }
        }

        private func content(_ id: Int, expansion: MapActivityExpansion) -> AnyView {
            AnyView(ActivityDetailPanel(store: parent.store, activityID: id,
                mapExpansion: expansion, scrollsMapHeading: parent.scrollsHeading,
                mapBottomContentInset: parent.bottomContentInset) { [weak self] id in
                    guard let self else { return }
                    self.parent.picker.detent = .compact
                    self.parent.store.showOnMap(id)
                }
                .environment(\.activityDetailOverMap, true)
                .environment(\.colorScheme, parent.colorScheme)
                .environment(\.dynamicTypeSize, parent.typeSize)
                .environment(\.horizontalSizeClass, parent.sizeClass))
        }

        private func page(_ id: Int) -> Page {
            if let page = pages[id] { return page }
            let expansion = MapActivityExpansion(progress: parent.expansion)
            let page = Page(id: id, expansion: expansion, content: content(id, expansion: expansion))
            pages[id] = page
            return page
        }

        private func neighbour(of controller: UIViewController, offset: Int) -> Page? {
            let ids = parent.picker.candidateIDs
            guard ids.count > 1, let id = (controller as? Page)?.activityID, let index = ids.firstIndex(of: id) else { return nil }
            return page(ids[(index + offset + ids.count) % ids.count])
        }

        private func prune(around id: Int) {
            let ids = parent.picker.candidateIDs
            guard let index = ids.firstIndex(of: id) else { pages.removeAll(); return }
            let keep = Set([-1, 0, 1].map { ids[(index + $0 + ids.count) % ids.count] })
            pages = pages.filter { keep.contains($0.key) }
        }

        func pageViewController(_ pageViewController: UIPageViewController, viewControllerBefore viewController: UIViewController) -> UIViewController? {
            neighbour(of: viewController, offset: -1)
        }

        func pageViewController(_ pageViewController: UIPageViewController, viewControllerAfter viewController: UIViewController) -> UIViewController? {
            neighbour(of: viewController, offset: 1)
        }

        func pageViewController(_ pageViewController: UIPageViewController, willTransitionTo pendingViewControllers: [UIViewController]) {
            transitioning = true
            parent.picker.isPaging = true
        }

        func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
                                previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
            transitioning = false
            parent.picker.isPaging = false
            if completed, let page = pageViewController.viewControllers?.first as? Page {
                // Commit focus only after a completed native page gesture;
                // cancelling the drag never changes the active route.
                parent.picker.showDetail(page.activityID, store: parent.store, motion: .none)
            }
            update(parent)
        }
    }
}

/// Observed only by the summary/detail reveal, below the stable hosting root.
@MainActor @Observable
final class MapActivityExpansion {
    var progress: CGFloat
    init(progress: CGFloat) { self.progress = progress }
}

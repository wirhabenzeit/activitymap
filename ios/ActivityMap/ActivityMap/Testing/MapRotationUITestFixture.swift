#if DEBUG
import MapboxMaps
import SwiftUI
import UIKit

/// Real shell and results presentation, with no persistent library, auth flow,
/// remote style or photos. The launch flag also uses in-memory app persistence.
struct MapRotationUITestFixture: View {
    @State private var store: ActivityStore
    @State private var picker: RoutePicker

    init(expanded: Bool = false) {
        MapboxOptions.accessToken = "pk.offline-test"
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let continuation = ProcessInfo.processInfo.arguments.contains("--activity-continuation-ui-testing")
        let count = continuation ? 3 : 30
        let activities = (1...count).map { id in
            var activity = Activity(id: id, name: "Rotation activity \(id)", sportType: .ride,
                     startDate: date, startDateLocal: date, timezone: "UTC",
                     distance: 1000, movingTime: 600, elapsedTime: 600,
                     totalElevationGain: 10, averageSpeed: 2, commute: false,
                     coordinates: [.init(latitude: 46, longitude: 8), .init(latitude: 46.01, longitude: 8.01)])
            if continuation {
                activity.elevLow = 680
                activity.elevHigh = 1420
                activity.maxSpeed = 14.2
                activity.averageHeartrate = 142
                activity.maxHeartrate = 176
                activity.averageWatts = 185
                activity.maxWatts = 620
                activity.weightedAverageWatts = 198
                activity.calories = 680
                activity.kilojoules = 720
                activity.kudosCount = 12
                activity.achievementCount = 3
                activity.commentCount = 2
                activity.isPrivate = false
                activity.flagged = false
                activity.trainer = false
                activity.manual = false
            }
            return activity
        }
        let store = ActivityStore(activities: activities, listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = ProcessInfo.processInfo.arguments.contains("--activity-continuation-list") ? .list : .map
        store.replaceSelection(with: Set(1...count))
        let picker = RoutePicker()
        picker.reconcile(with: store)
        picker.detent = expanded ? .expanded : .medium
        _store = State(initialValue: store)
        _picker = State(initialValue: picker)
    }

    var body: some View {
        AppShell(store: store, mapPicker: picker)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))
            .overlay(alignment: .topLeading) {
                MapRotationPresentationProbe(store: store, picker: picker)
                    .frame(width: 74, height: 10).padding(4).allowsHitTesting(false)
            }
    }
}

/// Diagnostics sit outside the undimmed results sheet in a noninteractive
/// shell overlay. Settings can hide the root AX tree; tests inspect its own UI
/// while open, then read this probe again after dismissal. No extra window or
/// presentation controller participates in rotation. The probe uses only public
/// containment/presentation relationships, UIView subviews, UIScrollView geometry
/// and app-owned accessibility IDs.
private struct MapRotationPresentationProbe: UIViewControllerRepresentable {
    let store: ActivityStore
    let picker: RoutePicker
    func makeUIViewController(context: Context) -> Controller { Controller(store: store, picker: picker) }
    func updateUIViewController(_ controller: Controller, context: Context) { controller.start() }
    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) { controller.stop() }

    final class Controller: UIViewController {
        let store: ActivityStore
        let picker: RoutePicker
        private var sampling: Task<Void, Never>?
        private let label = UILabel()
        private weak var resultsScroll: UIScrollView?
        private var presentations: Set<ObjectIdentifier> = []
        private var priorGeometry = ""
        private var stableSamples = 0

        init(store: ActivityStore, picker: RoutePicker) {
            self.store = store
            self.picker = picker
            super.init(nibName: nil, bundle: nil)
        }
        @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

        func start() {
            guard sampling == nil else { return }
            sampling = Task { [weak self] in
                while !Task.isCancelled {
                    guard let self else { return }
                    if let window = view.window, let root = window.rootViewController {
                        sample(root: root, window: window)
                    }
                    do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
                }
            }
        }

        func stop() {
            sampling?.cancel()
            sampling = nil
        }

        override func loadView() {
            view = UIView()
            view.backgroundColor = .clear
            view.isUserInteractionEnabled = false
            label.text = "Rotation fixture"
            label.font = .systemFont(ofSize: 8)
            label.textColor = .label
            label.backgroundColor = .systemBackground
            label.isAccessibilityElement = true
            label.accessibilityIdentifier = "map-rotation-fixture-state"
            label.accessibilityLabel = "Map rotation fixture"
            label.frame = view.bounds
            label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(label)
        }

        private func sample(root: UIViewController, window: UIWindow) {
            let controllers = allControllers(root)
            // Results is the first native sheet containing our results scroller;
            // the Settings sheet above it owns a separate controller and scroll.
            let panel = controllers.first { controller in
                guard controller.presentingViewController != nil,
                      controller.presentationController is UISheetPresentationController,
                      controller.viewIfLoaded != nil else { return false }
                return findResultsScroll(in: controller) != nil
            }
            let scroll = panel.flatMap(findResultsScroll)
            if let scroll { resultsScroll = scroll }
            if let panel { presentations.insert(ObjectIdentifier(panel)) }
            let map = descendants(window).first { $0 is MapView }
            let visibleDetailID = store.selectedTab == .list ? store.inspectedActivityID : picker.detailID
            let detailScroll = visibleDetailID == nil ? nil : findDetailScroll(in: panel ?? root)
            let navigation = panel.flatMap { allControllers($0).compactMap { $0 as? UINavigationController }.first }
            let detailOffset = detailScroll?.contentOffset.y ?? 0
            let detailMaximum = detailScroll.map {
                max(-$0.adjustedContentInset.top, $0.contentSize.height - $0.bounds.height + $0.adjustedContentInset.bottom)
            } ?? 0
            let sheet = panel?.sheetPresentationController
            var depth = 0
            var presented = panel
            while let current = presented, depth < 8 {
                depth += 1
                presented = current.presentedViewController
            }
            let transitioning = controllers.contains { $0.isBeingPresented || $0.isBeingDismissed || $0.transitionCoordinator != nil }
            let frame = panel?.viewIfLoaded.map { $0.convert($0.bounds, to: window) } ?? .zero
            let scrollFrame = scroll.map { $0.convert($0.bounds, to: window) } ?? .zero
            let orientation = window.windowScene?.effectiveGeometry.interfaceOrientation.rawValue ?? 0
            let geometry = "\(orientation)|\(window.bounds)|\(frame)|\(scrollFrame)|\(scroll?.contentOffset ?? .zero)|\(visibleDetailID ?? -1)|\(detailOffset)|\(detailMaximum)"
            // Opposite landscape orientations have equal bounds; require a
            // fresh half-second of stable samples after either rotation.
            stableSamples = geometry == priorGeometry && !transitioning && scroll?.isDragging != true && scroll?.isDecelerating != true
                && detailScroll?.isDragging != true && detailScroll?.isDecelerating != true
                ? stableSamples + 1 : 0
            priorGeometry = geometry
            var values: [String: Any] = [
                "ready": (store.selectedTab == .list || (panel != nil && scroll != nil)) && stableSamples >= 10,
                "orientation": orientation,
                "selection": store.selectedActivityIDs.sorted(),
                "candidates": picker.candidateIDs,
                "detent": picker.detent.rawValue, "detailID": picker.detailID ?? -1,
                "inspectedID": store.inspectedActivityID ?? -1,
                "listedIDs": store.listedActivities.map(\.id),
                "detailScrollID": identity(detailScroll),
                "detailOffset": detailOffset,
                "detailMaximumOffset": detailMaximum,
                "detailTopOffset": -(detailScroll?.adjustedContentInset.top ?? 0),
                "detailFrame": rectangle(detailScroll.map { $0.convert($0.bounds, to: window) } ?? .zero),
                "detailContentFrame": rectangle(detailScroll.map {
                    $0.convert($0.bounds.inset(by: $0.adjustedContentInset), to: window)
                } ?? .zero),
                "navigationDepth": navigation?.viewControllers.count ?? 0,
                "resultsPresented": picker.isPresented,
                "sheetID": identity(sheet), "controllerID": identity(panel),
                "presenterID": identity(panel?.presentingViewController),
                "presentationCount": presentations.count, "presentationDepth": depth,
                "nativeDetent": sheet?.selectedDetentIdentifier?.rawValue ?? "",
                "preferredContentSize": [panel?.preferredContentSize.width ?? 0, panel?.preferredContentSize.height ?? 0],
                "prefersPageSizing": sheet?.prefersPageSizing ?? false,
                "widthFollowsPreferredContentSize": sheet?.widthFollowsPreferredContentSizeWhenEdgeAttached ?? false,
                "prefersEdgeAttachedInCompactHeight": sheet?.prefersEdgeAttachedInCompactHeight ?? false,
                "presentedTraits": [panel?.traitCollection.horizontalSizeClass.rawValue ?? 0,
                                    panel?.traitCollection.verticalSizeClass.rawValue ?? 0,
                                    panel?.traitCollection.userInterfaceIdiom.rawValue ?? -1],
                "containerFrame": rectangle(sheet?.containerView.map { $0.convert($0.bounds, to: window) } ?? .zero),
                "containerSafeInsets": insets(sheet?.containerView?.safeAreaInsets ?? .zero),
                "panelSafeInsets": insets(panel?.viewIfLoaded?.safeAreaInsets ?? .zero),
                "scrollID": identity(scroll), "scrollAttached": scroll?.window === window,
                "offset": [scroll?.contentOffset.x ?? 0, scroll?.contentOffset.y ?? 0],
                "contentSize": [scroll?.contentSize.width ?? 0, scroll?.contentSize.height ?? 0],
                "scrollFrame": rectangle(scrollFrame), "sheetFrame": rectangle(frame),
                "mapFrame": rectangle(map.map { $0.convert($0.bounds, to: window) } ?? .zero),
                "windowFrame": rectangle(window.bounds),
                "mapSafeInsets": insets(map?.safeAreaInsets ?? .zero),
                "safeInsets": [window.safeAreaInsets.top, window.safeAreaInsets.left, window.safeAreaInsets.bottom, window.safeAreaInsets.right],
            ]
            if #available(iOS 27.0, *) { values["preferredPlacement"] = sheet?.preferredPlacement.rawValue ?? -1 }
            if let data = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]),
               let json = String(data: data, encoding: .utf8), label.accessibilityValue != json {
                label.accessibilityValue = json
            }
        }

        private func findResultsScroll(in controller: UIViewController) -> UIScrollView? {
            // UINavigationController retains the root controller while its view
            // is offscreen. Inspect controller containment too, so a native push
            // doesn't look like sheet dismissal or a replaced results scroller.
            let roots = allControllers(controller).compactMap(\.viewIfLoaded)
            if let resultsScroll, roots.contains(where: { resultsScroll.isDescendant(of: $0) }) { return resultsScroll }
            let navigationRoot = roots.first { $0.accessibilityIdentifier == "map-results-navigation-root" }
            let views = (navigationRoot.map { [$0] } ?? roots).flatMap(descendants)
            guard let view = navigationRoot ?? controller.viewIfLoaded else { return nil }
            if let marked = views.first(where: { $0.accessibilityIdentifier == "map-results-scroll" }) {
                if let scroll = marked as? UIScrollView { return scroll }
                if let scroll = descendants(marked).compactMap({ $0 as? UIScrollView }).first { return scroll }
                var ancestor = marked.superview
                while let current = ancestor, current !== view {
                    if let scroll = current as? UIScrollView { return scroll }
                    ancestor = current.superview
                }
            }
            // SwiftUI may place its AX identifier on a virtual accessibility
            // element rather than UIView. Before detail opens, results is the
            // only vertical scroll view inside the native results controller.
            guard picker.detailID == nil else { return nil }
            let vertical = views.compactMap { $0 as? UIScrollView }
                .filter { $0.contentSize.height > 0 && $0.bounds.height > 0 }
            return vertical.count == 1 ? vertical.first : nil
        }

        private func findDetailScroll(in controller: UIViewController) -> UIScrollView? {
            let views = allControllers(controller).compactMap(\.viewIfLoaded).flatMap(descendants)
            // The detail marker is a public, app-owned UIKit root. List's
            // destination uses SwiftUI's AX identifier, which can be virtual.
            let detailRoot = views.first { $0.accessibilityIdentifier == "map-results-navigation-detail" }
            let candidates = (detailRoot.map(descendants) ?? views).compactMap { $0 as? UIScrollView }
                .filter { $0 !== resultsScroll && $0.window != nil && $0.bounds.height > 0 && $0.bounds.width > 0 }
            if let marked = candidates.first(where: { $0.accessibilityIdentifier == "activity-detail-scroll" }) { return marked }
            return candidates.filter { $0.contentSize.height > $0.bounds.height }
                .max { $0.bounds.height < $1.bounds.height }
        }

        private func allControllers(_ root: UIViewController) -> [UIViewController] {
            var seen: Set<ObjectIdentifier> = []
            func visit(_ controller: UIViewController) -> [UIViewController] {
                guard seen.insert(ObjectIdentifier(controller)).inserted else { return [] }
                return [controller] + controller.children.flatMap(visit)
                    + (controller.presentedViewController.map(visit) ?? [])
            }
            return visit(root)
        }
        private func descendants(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap(descendants) }
        private func identity(_ object: AnyObject?) -> String { object.map { String(describing: ObjectIdentifier($0)) } ?? "" }
        private func insets(_ insets: UIEdgeInsets) -> [CGFloat] { [insets.top, insets.left, insets.bottom, insets.right] }
        private func rectangle(_ rect: CGRect) -> [CGFloat] { [rect.minX, rect.minY, rect.width, rect.height] }
    }

}
#endif

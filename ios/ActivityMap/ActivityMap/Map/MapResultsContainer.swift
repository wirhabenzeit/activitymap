import SwiftUI
import UIKit

/// A native sheet retains its content through rotation on iOS 27. Earlier
/// systems use the custom trailing panel in wide windows.
struct MapResultsContainer: View {
    @Bindable var picker: RoutePicker
    let store: ActivityStore
    let size: CGSize
    let topInset: CGFloat
    let bottomInset: CGFloat
    let largeText: Bool
    var geometryChanged: (MapResultsPresentationGeometry?) -> Void = { _ in }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var drag: MapResultsDrag? = nil

    var body: some View {
        let layout = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                                      detent: picker.detent, largeText: largeText)
        let compact = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
            detent: .compact, largeText: largeText).contentHeight
        let expanded = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
            detent: .expanded, largeText: largeText).contentHeight
        if layout.usesNativePresentation {
            let openingHeight = NativeMapResultsSizing.openingHeight(
                height: size.height, largeText: largeText, topInset: topInset)
            NativeMapResultsSheet(picker: picker, store: store, layout: layout,
                compactHeight: layout.isSidePanel ? compact : NativeMapResultsSizing.compactHeight(largeText: largeText),
                openingHeight: openingHeight, expandedHeight: expanded, geometryChanged: geometryChanged)
        } else if picker.isPresented {
            let height = drag?.height(compact: compact, expanded: expanded) ?? layout.contentHeight
            RoutePickerSheet(picker: picker, store: store, isSidePanel: true, bottomInset: bottomInset,
                panelExpandedHeight: expanded,
                collapsedOverride: height <= compact + 1,
                panelHandle: AnyView(handle(start: layout.contentHeight, compact: compact, expanded: expanded)))
                .frame(width: layout.frame.width, height: height + bottomInset)
                .position(x: layout.frame.midX, y: size.height - height / 2 + bottomInset / 2)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: picker.detent)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: drag == nil)
                .transaction { if drag != nil { $0.animation = nil } }
        }
    }

    private func handle(start: CGFloat, compact: CGFloat, expanded: CGFloat) -> some View {
        Capsule().fill(.secondary).frame(width: 36, height: 5)
            .frame(width: 60, height: 44)
            .contentShape(Rectangle())
            // The handle moves with the panel. Local translations feed that
            // movement back into the next event and make resizing oscillate.
            .gesture(DragGesture(minimumDistance: 3, coordinateSpace: .global)
                .updating($drag) { value, state, transaction in
                    transaction.animation = nil
                    if state == nil { state = MapResultsDrag(start: start) }
                    state?.translation = value.translation.height
                }
                .onEnded { value in
                    picker.detent = MapResultsSnap.target(start: drag?.start ?? start,
                        predictedTranslation: value.predictedEndTranslation.height,
                        compact: compact, expanded: expanded)
                })
            .onTapGesture { picker.detent = picker.detent == .compact ? .expanded : .compact }
            .accessibilityElement()
            .accessibilityLabel("Results panel")
            .accessibilityValue(picker.detent == .compact ? "Collapsed" : "Expanded")
            .accessibilityHint("Drag up to expand or down to collapse")
            .accessibilityIdentifier("map-results-handle")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: picker.detent = .expanded
                case .decrement: picker.detent = .compact
                @unknown default: break
                }
            }
            .accessibilityAction(named: "Expand results") { picker.detent = .expanded }
            .accessibilityAction(named: "Collapse results") { picker.detent = .compact }
    }

}

private struct MapResultsPresentationChangedKey: EnvironmentKey {
    static let defaultValue: (Bool) -> Void = { _ in }
}
private struct MapResultsSheetSuspendedKey: EnvironmentKey {
    static let defaultValue = false
}
extension EnvironmentValues {
    var mapResultsPresentationChanged: (Bool) -> Void {
        get { self[MapResultsPresentationChangedKey.self] }
        set { self[MapResultsPresentationChangedKey.self] = newValue }
    }
    var mapResultsSheetSuspended: Bool {
        get { self[MapResultsSheetSuspendedKey.self] }
        set { self[MapResultsSheetSuspendedKey.self] = newValue }
    }
    @Entry var stackedMapPhotoViewer: StackedMapPhotoViewer? = nil
    @Entry var stackedShellSheet: StackedShellSheet? = nil
}

/// The shell's Filters and Settings sheets, presented over the phone results
/// sheet while it is up. UIKit shows one sheet per presenter, so the results
/// sheet presents them instead of being dismissed first.
struct StackedShellSheet {
    var request: Binding<ShellSheet?>
    var content: (ShellSheet) -> AnyView
}

/// The system owns phone scrolling and drag arbitration.
private struct NativeMapResultsSheet: View {
    @Bindable var picker: RoutePicker
    let store: ActivityStore
    let layout: MapResultsLayout
    let compactHeight: CGFloat
    let openingHeight: CGFloat
    let expandedHeight: CGFloat
    let geometryChanged: (MapResultsPresentationGeometry?) -> Void
    @Environment(\.mapResultsSheetSuspended) private var suspended
    @Environment(\.mapResultsPresentationChanged) private var presentationChanged
    @Environment(\.stackedMapPhotoViewer) private var photoViewer
    @Environment(\.stackedShellSheet) private var stacked
    @Environment(\.self) private var environment

    var body: some View {
        NativeMapResultsPresenter(
            isPresented: picker.isPresented && store.selectedTab == .map && !suspended,
            detent: Binding(get: { picker.detent }, set: { picker.detent = $0 }),
            compactHeight: compactHeight, openingHeight: openingHeight,
            wideExpandedHeight: layout.isSidePanel ? expandedHeight : nil,
            preferredWidth: layout.frame.width, presentationChanged: presentationChanged,
            geometryChanged: geometryChanged,
            content: GeometryReader { geometry in
                RoutePickerSheet(picker: picker, store: store, isSidePanel: layout.isSidePanel,
                    bottomInset: geometry.safeAreaInsets.bottom,
                    collapsedOverride: picker.detent == .compact, nativePresentation: true)
                    // The wide header normally puts a custom handle beside its
                    // controls. Native sheets use the system grabber above them.
                    .padding(.top, layout.isSidePanel ? 13 : 0)
                    .ignoresSafeArea(.container, edges: .bottom)
            }
            .fullScreenCover(item: photoViewer?.request ?? .constant(nil), onDismiss: { photoViewer?.onDismiss() }) { destination in
                photoViewer?.content(destination)
            }
            .sheet(item: stacked?.request ?? .constant(nil)) { destination in
                stacked?.content(destination)
            }
            .environment(\.self, environment))
            .allowsHitTesting(false)
            .onDisappear { presentationChanged(false) }
    }
}

/// Configure the native presentation before it starts. Changing SwiftUI's
/// background after presentation leaves the system's glass press interaction
/// installed, even when the visible backdrop uses a noninteractive effect.
private struct NativeMapResultsPresenter<Content: View>: UIViewControllerRepresentable {
    let isPresented: Bool
    var detent: Binding<MapResultsDetent>
    let compactHeight: CGFloat
    let openingHeight: CGFloat
    let wideExpandedHeight: CGFloat?
    let preferredWidth: CGFloat
    let presentationChanged: (Bool) -> Void
    let geometryChanged: (MapResultsPresentationGeometry?) -> Void
    let content: Content

    func makeUIViewController(context: Context) -> Presenter { Presenter() }

    func updateUIViewController(_ controller: Presenter, context: Context) {
        controller.configuration = self
        controller.reconcile()
    }

    static func dismantleUIViewController(_ controller: Presenter, coordinator: ()) {
        controller.configuration = nil
        controller.close(animated: false)
    }

    final class Presenter: UIViewController, UISheetPresentationControllerDelegate {
        var configuration: NativeMapResultsPresenter?
        private var panel: Panel?
        private var closing = false
        private let compactID = UISheetPresentationController.Detent.Identifier("activitymap.compact")
        private let openingID = UISheetPresentationController.Detent.Identifier("activitymap.opening")
        private let expandedID = UISheetPresentationController.Detent.Identifier("activitymap.expanded")
        private struct Sizing: Equatable {
            let compactHeight: CGFloat
            let openingHeight: CGFloat
            let wideExpandedHeight: CGFloat?
            let preferredWidth: CGFloat
        }
        private var lastSizing: Sizing?
        private var geometryReportScheduled = false
        private var lastReportedGeometry: MapResultsPresentationGeometry?

        private final class Panel: UIHostingController<Content> {
            var layoutChanged: (() -> Void)?
            override func viewDidAppear(_ animated: Bool) {
                super.viewDidAppear(animated)
                layoutChanged?()
            }
            override func viewDidLayoutSubviews() {
                super.viewDidLayoutSubviews()
                layoutChanged?()
            }
        }

        override func loadView() {
            view = UIView()
            view.backgroundColor = .clear
            view.isUserInteractionEnabled = false
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            reconcile()
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            scheduleGeometryReport()
        }

        override func viewSafeAreaInsetsDidChange() {
            super.viewSafeAreaInsetsDidChange()
            scheduleGeometryReport()
        }

        private func scheduleGeometryReport() {
            guard !geometryReportScheduled else { return }
            geometryReportScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.geometryReportScheduled = false
                let next: MapResultsPresentationGeometry?
                if !self.closing, self.configuration?.isPresented == true,
                   let panel = self.panel, let window = self.viewIfLoaded?.window,
                   panel.viewIfLoaded?.window === window {
                    next = MapResultsPresentationGeometry(
                        frame: panel.view.convert(panel.view.bounds, to: self.view),
                        containerSize: self.view.bounds.size)
                } else { next = nil }
                guard next != self.lastReportedGeometry else { return }
                self.lastReportedGeometry = next
                self.configuration?.geometryChanged(next)
            }
        }

        func reconcile() {
            guard let configuration, isViewLoaded, view.window != nil, !closing else { return }
            guard configuration.isPresented else { close(animated: true); return }
            if let panel {
                panel.rootView = configuration.content
                guard let sheet = panel.sheetPresentationController else { return }
                updateSizing(sheet, panel: panel)
                return
            }
            guard presentedViewController == nil else { return }
            let panel = Panel(rootView: configuration.content)
            // A sheet above results handles its own keyboard. Keep the
            // backing results viewport (and its row presenters) unchanged.
            panel.safeAreaRegions = .container
            panel.layoutChanged = { [weak self] in self?.scheduleGeometryReport() }
            panel.view.backgroundColor = .clear
            panel.modalPresentationStyle = .pageSheet
            panel.isModalInPresentation = true
            guard let sheet = panel.sheetPresentationController else { return }
            if #available(iOS 27.0, *) {
                // Placement stays stable; UIKit adapts the same sheet as its
                // container rotates instead of dismissing and recreating it.
                sheet.preferredPlacement = .trailing
                sheet.prefersPageSizing = false
                sheet.prefersEdgeAttachedInCompactHeight = true
                sheet.widthFollowsPreferredContentSizeWhenEdgeAttached = true
            }
            updateSizing(sheet, panel: panel)
            sheet.prefersGrabberVisible = true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = false
            // iOS 26.0 keeps the system sheet background.
            if #available(iOS 26.1, *) {
                sheet.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterial)
            }
            sheet.delegate = self
            self.panel = panel
            present(panel, animated: true) { [weak self] in
                self?.configuration?.presentationChanged(true)
            }
        }

        private func updateSizing(_ sheet: UISheetPresentationController, panel: UIHostingController<Content>) {
            guard let configuration else { return }
            let sizing = Sizing(compactHeight: configuration.compactHeight,
                openingHeight: configuration.openingHeight,
                wideExpandedHeight: configuration.wideExpandedHeight,
                preferredWidth: configuration.preferredWidth)
            let target = identifier(configuration.detent.wrappedValue)
            if sizing != lastSizing {
                lastSizing = sizing
                if #available(iOS 27.0, *) {
                    // Form sizing follows the complete preferred size, so
                    // supply meaningful dimensions for both axes.
                    panel.preferredContentSize = CGSize(width: sizing.preferredWidth,
                        height: sizing.wideExpandedHeight ?? sizing.openingHeight)
                }
                let compact = UISheetPresentationController.Detent.custom(identifier: compactID) {
                    min(sizing.compactHeight, $0.maximumDetentValue)
                }
                if let height = sizing.wideExpandedHeight {
                    // Wide medium/expanded share one stop. Keep the logical
                    // picker detent so returning to portrait restores its size.
                    sheet.detents = [compact, .custom(identifier: expandedID) {
                        min(height, $0.maximumDetentValue)
                    }]
                    sheet.largestUndimmedDetentIdentifier = expandedID
                } else {
                    sheet.detents = [compact, .custom(identifier: openingID) {
                        min(sizing.openingHeight, $0.maximumDetentValue)
                    }, .large()]
                    sheet.largestUndimmedDetentIdentifier = .large
                }
                // Geometry changes participate in UIKit's rotation layout;
                // only a requested detent change starts its own animation.
                sheet.selectedDetentIdentifier = target
            } else if sheet.selectedDetentIdentifier != target {
                sheet.animateChanges { sheet.selectedDetentIdentifier = target }
            }
        }

        private func identifier(_ detent: MapResultsDetent) -> UISheetPresentationController.Detent.Identifier {
            switch detent {
            case .compact: compactID
            case .medium: configuration?.wideExpandedHeight == nil ? openingID : expandedID
            case .expanded: configuration?.wideExpandedHeight == nil ? .large : expandedID
            }
        }

        func sheetPresentationControllerDidChangeSelectedDetentIdentifier(_ sheet: UISheetPresentationController) {
            guard let selected = sheet.selectedDetentIdentifier else { return }
            let value: MapResultsDetent
            switch selected {
            case compactID: value = .compact
            case openingID: value = .medium
            case expandedID, .large: value = .expanded
            default: return
            }
            if configuration?.detent.wrappedValue != value { configuration?.detent.wrappedValue = value }
        }

        func adaptivePresentationStyle(for controller: UIPresentationController,
                                       traitCollection: UITraitCollection) -> UIModalPresentationStyle { .none }

        func close(animated: Bool) {
            guard let panel, !closing else { return }
            closing = true
            panel.presentingViewController?.dismiss(animated: animated) { [weak self] in
                guard let self else { return }
                self.panel = nil
                self.closing = false
                self.lastSizing = nil
                self.scheduleGeometryReport()
                self.configuration?.presentationChanged(false)
                self.reconcile()
            }
        }
    }
}

enum NativeMapResultsSizing {
    static func compactHeight(largeText: Bool) -> CGFloat { largeText ? 140 : 64 }

    static func openingHeight(height: CGFloat, largeText: Bool, topInset: CGFloat = 0) -> CGFloat {
        // One middle stop for results and detail. Short phones retain enough
        // map for route framing; content scrolls and Large is always available.
        let maximum = max(160, height - topInset - 64 - 24 - 96)
        return min(maximum, height * (largeText ? 0.55 : 0.5))
    }
}

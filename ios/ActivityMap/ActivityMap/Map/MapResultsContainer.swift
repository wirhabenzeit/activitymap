import SwiftUI
import UIKit

/// Phones use the native sheet. Wide windows use a bottom-trailing panel; expanding
/// the card never changes selection, scroll context or the map camera.
struct MapResultsContainer: View {
    @Bindable var picker: RoutePicker
    let store: ActivityStore
    let size: CGSize
    let topInset: CGFloat
    let bottomInset: CGFloat
    let largeText: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var drag: MapResultsDrag? = nil

    var body: some View {
        let layout = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                                      detent: picker.detent, largeText: largeText)
        if layout.isSidePanel {
            if picker.isPresented {
                let compact = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                    detent: .compact, largeText: largeText).contentHeight
                let expanded = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                    detent: .expanded, largeText: largeText).contentHeight
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
        } else {
            let openingHeight = NativeMapResultsSizing.openingHeight(
                height: size.height, largeText: largeText, topInset: topInset)
            NativeMapResultsSheet(picker: picker, store: store, openingHeight: openingHeight, largeText: largeText)

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
    let openingHeight: CGFloat
    let largeText: Bool
    @Environment(\.mapResultsSheetSuspended) private var suspended
    @Environment(\.mapResultsPresentationChanged) private var presentationChanged
    @Environment(\.stackedMapPhotoViewer) private var photoViewer
    @Environment(\.stackedShellSheet) private var stacked
    @Environment(\.self) private var environment

    var body: some View {
        NativeMapResultsPresenter(
            isPresented: picker.isPresented && store.selectedTab == .map && !suspended,
            detent: Binding(get: { picker.detent }, set: { picker.detent = $0 }),
            compactHeight: NativeMapResultsSizing.compactHeight(largeText: largeText),
            openingHeight: openingHeight, presentationChanged: presentationChanged,
            content: GeometryReader { geometry in
                RoutePickerSheet(picker: picker, store: store, isSidePanel: false,
                    bottomInset: geometry.safeAreaInsets.bottom,
                    collapsedOverride: picker.detent == .compact, nativePresentation: true)
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
    let presentationChanged: (Bool) -> Void
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
        private var panel: UIHostingController<Content>?
        private var closing = false
        private let compactID = UISheetPresentationController.Detent.Identifier("activitymap.compact")
        private let openingID = UISheetPresentationController.Detent.Identifier("activitymap.opening")
        private var lastCompactHeight: CGFloat?
        private var lastOpeningHeight: CGFloat?

        override func loadView() {
            view = UIView()
            view.backgroundColor = .clear
            view.isUserInteractionEnabled = false
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            reconcile()
        }

        func reconcile() {
            guard let configuration, isViewLoaded, view.window != nil, !closing else { return }
            guard configuration.isPresented else { close(animated: true); return }
            if let panel {
                panel.rootView = configuration.content
                guard let sheet = panel.sheetPresentationController else { return }
                updateSizing(sheet)
                let target = identifier(configuration.detent.wrappedValue)
                if sheet.selectedDetentIdentifier != target {
                    sheet.animateChanges { sheet.selectedDetentIdentifier = target }
                }
                return
            }
            guard presentedViewController == nil else { return }
            let panel = UIHostingController(rootView: configuration.content)
            panel.view.backgroundColor = .clear
            panel.modalPresentationStyle = .pageSheet
            panel.isModalInPresentation = true
            guard let sheet = panel.sheetPresentationController else { return }
            updateSizing(sheet)
            sheet.selectedDetentIdentifier = identifier(configuration.detent.wrappedValue)
            sheet.prefersGrabberVisible = true
            sheet.largestUndimmedDetentIdentifier = .large
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

        private func updateSizing(_ sheet: UISheetPresentationController) {
            guard let configuration else { return }
            let compactHeight = configuration.compactHeight
            let openingHeight = configuration.openingHeight
            guard compactHeight != lastCompactHeight || openingHeight != lastOpeningHeight else { return }
            lastCompactHeight = compactHeight
            lastOpeningHeight = openingHeight
            sheet.detents = [
                .custom(identifier: compactID) { _ in compactHeight },
                .custom(identifier: openingID) { _ in openingHeight },
                .large()
            ]
        }

        private func identifier(_ detent: MapResultsDetent) -> UISheetPresentationController.Detent.Identifier {
            switch detent {
            case .compact: compactID
            case .medium: openingID
            case .expanded: .large
            }
        }

        func sheetPresentationControllerDidChangeSelectedDetentIdentifier(_ sheet: UISheetPresentationController) {
            let value: MapResultsDetent = sheet.selectedDetentIdentifier == compactID ? .compact
                : sheet.selectedDetentIdentifier == .large ? .expanded : .medium
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
                self.lastCompactHeight = nil
                self.lastOpeningHeight = nil
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

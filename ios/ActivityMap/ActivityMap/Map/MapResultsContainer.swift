import SwiftUI

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
    @GestureState private var dragTranslation: CGFloat? = nil

    var body: some View {
        let layout = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                                      detent: picker.detent, largeText: largeText)
        if layout.isSidePanel {
            if picker.isPresented {
                let compact = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                    detent: .compact, largeText: largeText).contentHeight
                let expanded = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                    detent: .expanded, largeText: largeText).contentHeight
                let height = MapResultsSnap.height(start: layout.contentHeight,
                    translation: dragTranslation ?? 0, compact: compact, expanded: expanded)
                RoutePickerSheet(picker: picker, store: store, isSidePanel: true, bottomInset: bottomInset,
                    collapsedOverride: height <= compact + 1,
                    panelHandle: AnyView(handle(start: layout.contentHeight, compact: compact, expanded: expanded)))
                    .frame(width: layout.frame.width, height: height + bottomInset)
                    .position(x: layout.frame.midX, y: size.height - height / 2 + bottomInset / 2)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: picker.detent)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: dragTranslation == nil)
                    .transaction { if dragTranslation != nil { $0.animation = nil } }
            }
        } else {
            NativeMapResultsSheet(picker: picker, store: store, size: size, largeText: largeText)
        }
    }

    private func handle(start: CGFloat, compact: CGFloat, expanded: CGFloat) -> some View {
        Capsule().fill(.secondary).frame(width: 36, height: 5)
            .frame(maxWidth: .infinity).frame(height: 44)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 3)
                .updating($dragTranslation) { value, state, _ in state = value.translation.height }
                .onEnded { value in
                    picker.detent = MapResultsSnap.target(start: start,
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
}

/// The system owns phone scrolling and drag arbitration.
private struct NativeMapResultsSheet: View {
    @Bindable var picker: RoutePicker
    let store: ActivityStore
    let size: CGSize
    let largeText: Bool
    @Environment(\.mapResultsSheetSuspended) private var suspended
    @Environment(\.mapResultsPresentationChanged) private var presentationChanged
    private var openingHeight: CGFloat {
        NativeMapResultsSizing.openingHeight(count: picker.candidateIDs.filter(store.visibleActivityIDs.contains).count,
                                            detail: picker.detailID != nil, height: size.height, largeText: largeText)
    }
    private var compact: PresentationDetent { .height(largeText ? 240 : 156) }
    private var opening: PresentationDetent { .height(openingHeight) }
    private var detents: Set<PresentationDetent> { [compact, opening, .large] }
    // Resolve the initial detent before UIKit starts presenting. A default
    // .large followed by onAppear adjustment visibly shrinks during entrance.
    private var selected: PresentationDetent {
        picker.detent == .compact ? compact : picker.detent == .expanded ? .large : opening
    }
    private var selection: Binding<PresentationDetent> {
        Binding(get: { selected }, set: { value in
            picker.detent = value == compact ? .compact : value == .large ? .expanded : .medium
        })
    }
    var body: some View {
        Color.clear.allowsHitTesting(false)
            .sheet(isPresented: Binding(get: { picker.isPresented && store.selectedTab == .map && !suspended }, set: { _ in }), onDismiss: { presentationChanged(false) }) {
                RoutePickerSheet(picker: picker, store: store, isSidePanel: false,
                                 collapsedOverride: selected == compact,
                                 nativePresentation: true)
                    .presentationDetents(detents, selection: selection)
                    .presentationDragIndicator(.visible)
                    .presentationBackgroundInteraction(.enabled(upThrough: .large))
                    .presentationContentInteraction(.resizes)
                    .interactiveDismissDisabled()
                    .onAppear { presentationChanged(true) }

            }
    }
}

enum NativeMapResultsSizing {
    static func openingHeight(count: Int, detail: Bool, height: CGFloat, largeText: Bool) -> CGFloat {
        let minimum: CGFloat = largeText ? 300 : 220
        let content: CGFloat = detail ? (largeText ? 420 : 300) : 76 + CGFloat(max(1, min(count, 5))) * (largeText ? 160 : 64)
        return max(minimum, min(content, height * 0.5))
    }
}

import SwiftUI
import Observation

/// Resize only the results subtree while dragging; the Mapbox view and route
/// sources do not receive an update for every finger movement.
struct MapResultsContainer: View {
    @Bindable var picker: RoutePicker
    let store: ActivityStore
    let size: CGSize
    let topInset: CGFloat
    let bottomInset: CGFloat
    let largeText: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var resizing: MapResultsResizeState

    init(picker: RoutePicker, store: ActivityStore, size: CGSize, topInset: CGFloat, bottomInset: CGFloat,
         largeText: Bool, resizing: MapResultsResizeState? = nil) {
        self.picker = picker
        self.store = store
        self.size = size
        self.topInset = topInset
        self.bottomInset = bottomInset
        self.largeText = largeText
        _resizing = State(initialValue: resizing ?? MapResultsResizeState())
    }

    private func layout(_ detent: MapResultsDetent) -> MapResultsLayout {
        MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                         detent: detent, largeText: largeText)
    }
    private var heights: [CGFloat] { MapResultsDetent.allCases.map { layout($0).contentHeight } }

    var body: some View {
        if layout(picker.detent).isSidePanel {
            if picker.isPresented { customPanel }
        } else {
            NativeMapResultsSheet(picker: picker, store: store, size: size, largeText: largeText)
        }
    }

    private var customPanel: some View {
        MapResultsPresentation(picker: picker, store: store, size: size, topInset: topInset,
                               bottomInset: bottomInset, largeText: largeText,
                               height: resizing.height ?? layout(picker.detent).contentHeight,
                               resize: settle, dragChanged: changed, dragEnded: ended, dragCancelled: cancelled)
            .onPreferenceChange(MapResultsHeightKey.self) { resizing.presentedHeight = $0 }
            .onChange(of: picker.detent) { _, detent in
                // A fit may have collapsed the panel earlier in this update.
                // Do not let a stale expansion callback write the old detent back.
                guard detent == picker.detent else { return }
                if !resizing.drag.isDragging, resizing.height != layout(detent).contentHeight { settle(detent) }
            }
            .onChange(of: size) { _, _ in resetGeometry() }
            .onChange(of: largeText) { _, _ in resetGeometry() }
    }

    private func changed(_ translation: CGFloat) {
        let value = resizing.drag.update(translation: translation,
                                currentHeight: resizing.presentedHeight ?? resizing.height ?? layout(picker.detent).contentHeight,
                                heights: heights)
        // Live tracking has no animation; only the release settles to a detent.
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) { resizing.height = value }
    }

    private func ended(_ translation: CGFloat, _ prediction: CGFloat) {
        guard resizing.drag.isDragging else { return }
        let target = resizing.drag.finish(translation: translation, prediction: prediction, heights: heights)
        settle(target)
    }

    private func cancelled() {
        guard let start = resizing.drag.startHeight else { return }
        let translation = start - (resizing.height ?? start)
        ended(translation, translation)
    }

    private func settle(_ detent: MapResultsDetent) {
        // Observe the model change once; do not animate view insertion/removal,
        // headers, text positions or detail/summary crossfades independently.
        let target = layout(detent).contentHeight
        if picker.detent != detent { picker.detent = detent }
        withAnimation(reduceMotion ? nil : .interpolatingSpring(stiffness: 320, damping: 34)) {
            resizing.height = target
        }
    }

    private func resetGeometry() {
        resizing.drag = MapResultsDrag()
        resizing.height = nil
        resizing.presentedHeight = nil
    }
}

/// A single animatable height drives the actual layout on every settle frame.
/// The same progress drives summary/detail reveal as the panel grows.
private struct MapResultsPresentation: View, Animatable {
    let picker: RoutePicker
    let store: ActivityStore
    let size: CGSize
    let topInset: CGFloat
    let bottomInset: CGFloat
    let largeText: Bool
    var height: CGFloat
    let resize: (MapResultsDetent) -> Void
    let dragChanged: (CGFloat) -> Void
    let dragEnded: (CGFloat, CGFloat) -> Void
    let dragCancelled: () -> Void
    var animatableData: CGFloat {
        get { height }
        set { height = newValue }
    }

    var body: some View {
        let layout = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                                      detent: picker.detent, largeText: largeText, heightOverride: height)
        let compact = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                                       detent: .compact, largeText: largeText).contentHeight
        let medium = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                                      detent: .medium, largeText: largeText).contentHeight
        let progress = medium > compact
            ? min(1, max(0, (layout.contentHeight - compact) / (medium - compact)))
            : (picker.detent == .compact ? CGFloat(0) : CGFloat(1))
        RoutePickerSheet(picker: picker, store: store, isSidePanel: layout.isSidePanel,
                         bottomInset: layout.isSidePanel ? 0 : bottomInset,
                         collapsedOverride: progress <= 0.001, expansionProgress: progress,
                         resizeAction: resize, dragChanged: dragChanged, dragEnded: dragEnded, dragCancelled: dragCancelled)
            .transaction { $0.animation = nil }
            .frame(width: layout.frame.width, height: layout.frame.height)
            .position(x: layout.frame.midX, y: layout.frame.midY)
            .preference(key: MapResultsHeightKey.self, value: layout.contentHeight)
    }
}

private struct MapResultsHeightKey: PreferenceKey {
    static let defaultValue: CGFloat? = nil
    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) { value = nextValue() ?? value }
}

@MainActor @Observable
final class MapResultsResizeState {
    var height: CGFloat?
    var drag = MapResultsDrag()
    // Measured animation progress is for interruption only, not another render.
    @ObservationIgnored var presentedHeight: CGFloat?
}

/// Pure drag physics shared by the live header and regression tests. Global
/// gesture coordinates prevent the moving handle from feeding back into delta.
struct MapResultsDrag {
    private(set) var startHeight: CGFloat?
    var isDragging: Bool { startHeight != nil }

    mutating func update(translation: CGFloat, currentHeight: CGFloat, heights: [CGFloat]) -> CGFloat {
        if startHeight == nil { startHeight = currentHeight }
        return clamp((startHeight ?? currentHeight) - translation, heights: heights)
    }

    mutating func finish(translation: CGFloat, prediction: CGFloat, heights: [CGFloat]) -> MapResultsDetent {
        let start = startHeight ?? heights[MapResultsDetent.medium.rawValue]
        // Use some release velocity without letting a small flick skip every
        // detent. The final height always settles within the measured viewport.
        let momentum = min(180, max(-180, (prediction - translation) * 0.35))
        let projected = clamp(start - translation - momentum, heights: heights)
        startHeight = nil
        let index = heights.indices.min { abs(heights[$0] - projected) < abs(heights[$1] - projected) } ?? 1
        return MapResultsDetent(rawValue: index) ?? .medium
    }

    private func clamp(_ height: CGFloat, heights: [CGFloat]) -> CGFloat {
        min(heights.max() ?? height, max(heights.min() ?? height, height))
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

/// Native iPhone sheet owns scrolling/drag arbitration; iPad retains its panel.
private struct NativeMapResultsSheet: View {
    @Bindable var picker: RoutePicker
    let store: ActivityStore
    let size: CGSize
    let largeText: Bool
    @Environment(\.mapResultsSheetSuspended) private var suspended
    @Environment(\.mapResultsPresentationChanged) private var presentationChanged
    private var openingHeight: CGFloat {
        NativeMapResultsSizing.openingHeight(count: picker.candidateIDs.filter(store.selection.visibleIDs.contains).count,
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
                                 collapsedOverride: selected == compact, expansionProgress: selected == compact ? 0 : 1,
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

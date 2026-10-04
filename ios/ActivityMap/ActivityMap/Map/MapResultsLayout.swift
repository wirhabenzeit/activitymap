import CoreGraphics

/// Stable detents and occupied map space, independent of map rendering.
enum MapResultsDetent: Int, CaseIterable {
    case compact, medium, expanded
}

struct MapResultsLayout {
    let isSidePanel: Bool
    let contentHeight: CGFloat
    let frame: CGRect
    let bottomOcclusion: CGFloat
    let trailingOcclusion: CGFloat

    /// Explicit fits leave room to reveal normal detail after a compact fit.
    /// Resizing itself never changes the camera or queues another fit.
    static func framing(size: CGSize, topInset: CGFloat, bottomInset: CGFloat,
                        detent: MapResultsDetent, largeText: Bool) -> MapResultsLayout {
        let target: MapResultsDetent = detent == .compact ? .medium : detent
        return MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                                detent: target, largeText: largeText)
    }

    static func controlsCenter(size: CGSize, topInset: CGFloat = 0) -> CGPoint {
        // Three 44×48 targets, two dividers and 4pt padding: 52×154.
        CGPoint(x: max(26, size.width - 16 - 26), y: topInset + 12 + 77)
    }

    init(size: CGSize, topInset: CGFloat, bottomInset: CGFloat, detent: MapResultsDetent,
         largeText: Bool = false) {
        isSidePanel = size.width >= 650 || size.width > size.height
        let width = isSidePanel ? min(380, size.width * 0.42) : max(0, size.width - 8)
        // Keep navigation clear. Results overlay the top-right controls when
        // expanded; no empty control lane is reserved beside the panel.
        let top = topInset + 12
        let available = max(120, size.height - top - (isSidePanel ? 0 : 12))
        let compact = min(available, isSidePanel ? (largeText ? 120 : 64) : (largeText ? 240 : 156))
        let height: CGFloat
        switch detent {
        case .compact: height = compact
        case .medium: height = isSidePanel ? available : min(available, max(compact + 120, size.height * 0.46))
        case .expanded: height = available
        }
        contentHeight = height
        // Both hosts rise from the bottom. On wide maps the lower edge stays
        // anchored while the header moves upward to reveal the results.
        frame = CGRect(x: isSidePanel ? max(0, size.width - width - 16) : 4, y: size.height - contentHeight,
                       width: width, height: contentHeight + bottomInset)
        bottomOcclusion = isSidePanel ? 0 : contentHeight + bottomInset
        trailingOcclusion = isSidePanel ? size.width - frame.minX + 12 : 0
    }
}

/// Drag distance is measured from the current resting height, including when
/// starting expanded. Predicted movement lets a short flick reach a snap point.
enum MapResultsSnap {
    static func height(start: CGFloat, translation: CGFloat, compact: CGFloat, expanded: CGFloat) -> CGFloat {
        min(expanded, max(compact, start - translation))
    }
    static func target(start: CGFloat, predictedTranslation: CGFloat, compact: CGFloat, expanded: CGFloat) -> MapResultsDetent {
        height(start: start, translation: predictedTranslation, compact: compact, expanded: expanded)
            < (compact + expanded) / 2 ? .compact : .expanded
    }
}

/// Pin the resting height for the entire gesture, including the release event
/// that changes the model detent before SwiftUI resets the gesture state.
struct MapResultsDrag: Equatable {
    let start: CGFloat
    var translation: CGFloat = 0

    func height(compact: CGFloat, expanded: CGFloat) -> CGFloat {
        MapResultsSnap.height(start: start, translation: translation, compact: compact, expanded: expanded)
    }
}

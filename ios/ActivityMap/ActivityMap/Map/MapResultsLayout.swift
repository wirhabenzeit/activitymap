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
    let leadingOcclusion: CGFloat

    static func controlsCenter(size: CGSize, topInset: CGFloat) -> CGPoint {
        CGPoint(x: max(71, size.width - 83), y: topInset + 40)
    }

    init(size: CGSize, topInset: CGFloat, bottomInset: CGFloat, detent: MapResultsDetent,
         largeText: Bool = false, heightOverride: CGFloat? = nil) {
        isSidePanel = size.width >= 650 || size.width > size.height
        let width = isSidePanel ? min(380, size.width * 0.42) : max(0, size.width - 8)
        // Leave navigation and a horizontal map-controls row above expanded
        // phone results. Wider layouts leave those controls beside the panel.
        let top = topInset + (isSidePanel ? 12 : 140)
        let available = max(120, size.height - top - 12)
        // The native grab area is 44pt tall. Compact must still fit navigation,
        // the persistent activity identity and its one-line summary without
        // compressing the heading during the first expansion frames.
        let compact = min(available, (largeText ? 240 : 156) + (isSidePanel ? 0 : 32))
        let height: CGFloat
        switch detent {
        case .compact: height = compact
        case .medium: height = min(available, max(compact + 120, size.height * 0.46))
        case .expanded: height = available
        }
        contentHeight = min(available, max(compact, heightOverride ?? height))
        frame = CGRect(x: isSidePanel ? 16 : 4, y: isSidePanel ? top : size.height - contentHeight,
                       width: width, height: contentHeight + (isSidePanel ? 0 : bottomInset))
        bottomOcclusion = isSidePanel ? 0 : contentHeight + bottomInset
        leadingOcclusion = isSidePanel ? frame.maxX + 12 : 0
    }
}

import CoreGraphics

/// Stable detents and occupied map space, independent of map rendering.
enum MapResultsDetent: Int, CaseIterable {
    case compact, medium, expanded
}

struct MapResultsLayout {
    let isSidePanel: Bool
    let frame: CGRect
    let bottomOcclusion: CGFloat
    let leadingOcclusion: CGFloat

    static func controlsCenter(size: CGSize, topInset: CGFloat) -> CGPoint {
        CGPoint(x: max(71, size.width - 83), y: topInset + 40)
    }

    init(size: CGSize, topInset: CGFloat, bottomInset: CGFloat, detent: MapResultsDetent,
         largeText: Bool = false) {
        isSidePanel = size.width >= 650 || size.width > size.height
        let width = isSidePanel ? min(380, size.width * 0.42) : max(0, size.width - 24)
        // Leave navigation and a horizontal map-controls row above expanded
        // phone results. Wider layouts leave those controls beside the panel.
        let top = topInset + (isSidePanel ? 12 : 140)
        let available = max(120, size.height - top - 12)
        let compact = min(available, largeText ? 240 : 156)
        let height: CGFloat
        switch detent {
        case .compact: height = compact
        case .medium: height = min(available, max(compact + 120, size.height * 0.46))
        case .expanded: height = available
        }
        frame = CGRect(x: isSidePanel ? 16 : 12, y: isSidePanel ? top : size.height - height - 12,
                       width: width, height: height)
        bottomOcclusion = isSidePanel ? 0 : height + 12 + bottomInset
        leadingOcclusion = isSidePanel ? frame.maxX + 12 : 0
    }
}

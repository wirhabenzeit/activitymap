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

    /// Explicit fits leave room to reveal normal detail after a compact fit.
    /// Resizing itself never changes the camera or queues another fit.
    static func framing(size: CGSize, topInset: CGFloat, bottomInset: CGFloat,
                        detent: MapResultsDetent, largeText: Bool) -> MapResultsLayout {
        let target: MapResultsDetent = detent == .compact ? .medium : detent
        return MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                                detent: target, largeText: largeText)
    }

    static func controlsCenter(size: CGSize) -> CGPoint {
        CGPoint(x: max(71, size.width - 83), y: max(28, size.height - 92))
    }

    init(size: CGSize, topInset: CGFloat, bottomInset: CGFloat, detent: MapResultsDetent,
         largeText: Bool = false, heightOverride: CGFloat? = nil) {
        isSidePanel = size.width >= 650 || size.width > size.height
        let width = isSidePanel ? min(380, size.width * 0.42) : max(0, size.width - 8)
        // Keep navigation clear. Map controls and credits remain at the map's
        // bottom edge behind this panel instead of reserving another top row.
        let top = topInset + 12
        let available = max(120, size.height - top - 12)
        let compact = min(available, largeText ? 240 : 156)
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

import MapboxMaps
import UIKit

/// One compact footer for native branding, visible provider credits and the
/// native info button. Source credits also remain in Mapbox's info menu.
struct MapAttributionLayout {
    let ornamentOptions: OrnamentOptions
    let creditSize: CGSize
    let creditCenter: CGPoint

    init(size: CGSize, bottomInset: CGFloat, credit: String?, fontSize: CGFloat) {
        // Sizes in the pinned SDK: 85×21 wordmark and a 44×44 info target
        // whose visible glyph is bottom-aligned. Keep both native views intact.
        let logoWidth: CGFloat = 85
        let infoWidth: CGFloat = 44
        let gap: CGFloat = 8
        if let credit {
            let available = max(1, size.width - 32 - logoWidth - infoWidth - gap * 2 - 8)
            let textBounds = (credit as NSString).boundingRect(
                with: CGSize(width: available, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                attributes: [.font: UIFont.systemFont(ofSize: fontSize)], context: nil
            )
            creditSize = CGSize(width: ceil(textBounds.width) + 8, height: ceil(textBounds.height) + 4)
        } else {
            creditSize = .zero
        }
        let creditSpan = credit == nil ? 0 : creditSize.width + gap
        let rowWidth = logoWidth + gap + creditSpan + infoWidth
        let leading = max(8, (size.width - rowWidth) / 2)
        // Retain 18pt beneath the footer for the home indicator, using the
        // bottom inset without raising the map/selection controls.
        let bottom = 18 - bottomInset
        ornamentOptions = OrnamentOptions(
            logo: LogoViewOptions(position: .bottomLeft, margins: CGPoint(x: leading, y: bottom)),
            attributionButton: AttributionButtonOptions(position: .bottomLeft, margins: CGPoint(
                x: leading + logoWidth + gap + creditSpan, y: bottom
            ))
        )
        creditCenter = CGPoint(x: leading + logoWidth + gap + creditSize.width / 2,
                               y: size.height - bottom - creditSize.height / 2)
    }
}

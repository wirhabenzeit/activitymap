import MapboxMaps
import UIKit

/// Provider credits live in the SDK's single info menu, including source
/// attribution, feedback and privacy controls. The required native wordmark
/// remains visible in the opposite corner without an extra provider badge.
struct MapAttributionLayout {
    let ornamentOptions: OrnamentOptions

    init(bottomInset: CGFloat, bottomOcclusion: CGFloat = 0, leadingOcclusion: CGFloat = 0) {
        // Retain 18pt beneath the footer for the home indicator and keep both
        // ornaments clear of bottom results and wider hosts' side panels.
        let bottom = 18 - bottomInset + bottomOcclusion
        ornamentOptions = OrnamentOptions(
            logo: LogoViewOptions(position: .bottomLeft,
                                  margins: CGPoint(x: leadingOcclusion + 8, y: bottom)),
            attributionButton: AttributionButtonOptions(position: .bottomRight,
                                                        margins: CGPoint(x: 8, y: bottom))
        )
    }
}

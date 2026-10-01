import MapboxMaps
import UIKit

/// Provider credits live in the SDK's single info menu, including source
/// attribution, feedback and privacy controls. The required native wordmark
/// remains visible in the opposite corner without an extra provider badge.
struct MapAttributionLayout {
    let ornamentOptions: OrnamentOptions

    init(bottomInset: CGFloat) {
        // Stay at the map's normal bottom edge, including while a results
        // panel covers these background ornaments.
        let bottom = 18 - bottomInset
        ornamentOptions = OrnamentOptions(
            logo: LogoViewOptions(position: .bottomLeft,
                                  margins: CGPoint(x: 8, y: bottom)),
            attributionButton: AttributionButtonOptions(position: .bottomRight,
                                                        margins: CGPoint(x: 8, y: bottom))
        )
    }
}

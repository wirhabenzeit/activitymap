import MapLibre
import UIKit

struct MapAttributionLayout {
    let bottomInset: CGFloat
    func apply(to map: MLNMapView) {
        map.logoViewPosition = .bottomLeft
        map.attributionButtonPosition = .bottomRight
        map.logoViewMargins = CGPoint(x: 8, y: max(8, 18 - bottomInset))
        map.attributionButtonMargins = CGPoint(x: 8, y: max(8, 18 - bottomInset))
    }
}

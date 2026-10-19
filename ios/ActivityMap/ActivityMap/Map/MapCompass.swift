import Observation
import SwiftUI

/// Observed only by the compass, keeping camera drags out of MapScreen's body.
@Observable
final class MapCompassState {
    private(set) var bearing: Double = 0
    private(set) var isVisible = false

    init(bearing: Double = 0) { record(bearing) }

    func record(_ value: Double) {
        guard value.isFinite else { return }
        var normalized = value.truncatingRemainder(dividingBy: 360)
        if normalized > 180 { normalized -= 360 }
        if normalized < -180 { normalized += 360 }
        // Hysteresis avoids flicker as rotation gestures settle near north.
        isVisible = abs(normalized) > (isVisible ? 1 : 2)
        if abs(normalized - bearing) >= 0.25 || !isVisible { bearing = normalized }
    }
}

struct MapCompassButton: View {
    let state: MapCompassState
    let reset: () -> Void

    var body: some View {
        if state.isVisible {
            Button(action: reset) {
                ZStack {
                    Circle().fill(.regularMaterial).frame(width: 28, height: 28)
                    VStack(spacing: 0) {
                        Text("N").font(.system(size: 8, weight: .bold))
                        Image(systemName: "location.north.fill")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.red)
                    }
                    .rotationEffect(.degrees(-state.bearing))
                }
                .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Reset bearing")
            .accessibilityValue("\(Int(state.bearing.rounded())) degrees")
            .accessibilityIdentifier("map-compass")
        }
    }
}

enum MapCompassLayout {
    static func center(size: CGSize, topInset: CGFloat, bottomInset: CGFloat,
                       showingResults: Bool, detent: MapResultsDetent, largeText: Bool,
                       resultsFrame: CGRect? = nil) -> CGPoint? {
        let controls = MapResultsLayout.controlsCenter(size: size, topInset: topInset)
        var center = CGPoint(x: controls.x - 26 - 12 - 22, y: topInset + 12 + 22)
        if showingResults {
            let results = MapResultsLayout(size: size, topInset: topInset, bottomInset: bottomInset,
                                           detent: detent, largeText: largeText)
            let frame = resultsFrame ?? results.frame
            if results.isSidePanel {
                // Stay outside the panel even while its handle is being dragged.
                center.x = min(center.x, frame.minX - 12 - 22)
            } else if detent == .expanded || center.y + 22 > frame.minY - 8 {
                // A full-height phone sheet leaves no usable map touch target.
                return nil
            }
        }
        guard center.x >= 22, center.y + 22 < size.height - bottomInset - 50 else { return nil }
        return center
    }
}

import UIKit

/// A twist must be deliberate before it changes bearing. Ordinary panning and
/// pinch zoom keep their own native gestures and no longer turn the globe.
struct MapRotationGesture {
    static let threshold = 10.0
    static let sensitivity = 0.7
    var startingBearing: Double = 0

    func bearing(rotation: Double, engaged: Bool = false) -> Double? {
        let degrees = rotation * 180 / .pi
        guard engaged || abs(degrees) > Self.threshold else { return nil }
        let excess = (degrees >= 0 ? 1.0 : -1.0) * max(0, abs(degrees) - Self.threshold)
        return startingBearing - excess * Self.sensitivity
    }

    static func shouldSnapToNorth(_ bearing: Double) -> Bool {
        let normalized = (bearing + 180).truncatingRemainder(dividingBy: 360) - 180
        return min(abs(normalized), abs(normalized + 360)) <= 10
    }
}

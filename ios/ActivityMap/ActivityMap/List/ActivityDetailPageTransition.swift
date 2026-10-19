import SwiftUI

extension EnvironmentValues {
    @Entry var activityDetailTransitionDirection: ActivityContinuationDirection? = nil
}

/// Switching neighbours stays within one detail destination. Keep the movement
/// short so it reads as continuation rather than another navigation push.
struct ActivityDetailPageTransition<Content: View>: View {
    let activityID: Int
    @ViewBuilder var content: () -> Content
    @Environment(\.activityDetailTransitionDirection) private var direction
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var transition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        let forward = direction != .previous
        return .asymmetric(
            insertion: .offset(y: forward ? 36 : -36).combined(with: .opacity),
            removal: .offset(y: forward ? -24 : 24).combined(with: .opacity))
    }

    var body: some View {
        ZStack {
            content().id(activityID).transition(transition)
        }
        .animation(direction == nil ? nil : .easeInOut(duration: reduceMotion ? 0.16 : 0.28), value: activityID)
    }
}

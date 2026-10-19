import SwiftUI

extension EnvironmentValues {
    @Entry var activityDetailTransitionDirection: ActivityContinuationDirection? = nil
}

/// Neighbours push vertically within one detail destination, keeping horizontal
/// Back navigation distinct. Only Reduce Motion blends the pages.
struct ActivityDetailPageTransition<Content: View>: View {
    let activityID: Int
    @ViewBuilder var content: () -> Content
    @Environment(\.activityDetailTransitionDirection) private var direction
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var transition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        let forward = direction != .previous
        return .asymmetric(
            insertion: .move(edge: forward ? .bottom : .top),
            removal: .move(edge: forward ? .top : .bottom))
    }

    var body: some View {
        ZStack {
            content().id(activityID).transition(transition)
        }
        .animation(direction == nil ? nil : .easeInOut(duration: reduceMotion ? 0.16 : 0.32), value: activityID)
    }
}

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
    @Environment(\.activityDetailOverMap) private var overMap
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var motion = ActivityDetailPageMotion()

    var body: some View {
        // SwiftUI removes the outgoing page with the transition it last
        // rendered, from before this change's direction existed. Both pages
        // share one reference that is updated before the removal resolves.
        let _ = motion.update(forward: direction != .previous)
        ZStack {
            content()
                // Opaque pages keep text from blending wherever they meet.
                .background { if !overMap { AppTheme.surface } }
                .id(activityID)
                .transition(reduceMotion ? AnyTransition.opacity : AnyTransition(ActivityDetailPagePush(motion: motion)))
        }
        .animation(direction == nil ? nil : reduceMotion ? .easeInOut(duration: 0.16) : .smooth(duration: 0.38),
                   value: activityID)
    }
}

/// Not observable: writing it during body evaluation schedules no updates.
private final class ActivityDetailPageMotion {
    private(set) var forward = true
    func update(forward: Bool) { self.forward = forward }
}

private struct ActivityDetailPagePush: Transition {
    let motion: ActivityDetailPageMotion

    func body(content: Content, phase: TransitionPhase) -> some View {
        // Forward: the new page rises from below and the old one leaves above.
        let edge: CGFloat = motion.forward ? 1 : -1
        let pages: CGFloat = switch phase {
        case .willAppear: edge
        case .didDisappear: -edge
        case .identity: 0
        }
        content.modifier(ActivityDetailPageOffset(pages: pages))
    }
}

/// Offsets by whole page heights, so neighbours meet edge-to-edge.
private struct ActivityDetailPageOffset: GeometryEffect {
    var pages: CGFloat
    var animatableData: CGFloat {
        get { pages }
        set { pages = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 0, y: pages * size.height))
    }
}

import SwiftUI

/// The host owns the activity order and whether detail can accept navigation.
/// A missing successor means the sequence ends; the scroll view never wraps it.
struct ActivityDetailContinuation {
    let currentID: Int
    let nextID: Int
    let nextName: String
    let isEnabled: Bool
    let advance: () -> Void
}

extension EnvironmentValues {
    @Entry var activityDetailContinuation: ActivityDetailContinuation? = nil
}

/// A shared detail scroll surface. UIKit keeps ownership of bouncing, sheet
/// expansion, and gesture arbitration; we only observe its scroll lifecycle.
struct ActivityContinuationScrollView<Content: View>: View {
    let activityID: Int
    var bottomContentInset: CGFloat = 0
    @ViewBuilder var content: () -> Content
    @Environment(\.activityDetailContinuation) private var continuation
    @State private var pull = ActivityContinuationPull()
    @State private var position = ScrollPosition(edge: .top)

    private var successor: ActivityDetailContinuation? {
        guard let continuation, continuation.currentID == activityID,
              continuation.nextID != activityID else { return nil }
        return continuation
    }
    private var identity: ActivityContinuationPull.Identity? {
        guard let successor, successor.isEnabled else { return nil }
        return .init(currentID: activityID, nextID: successor.nextID)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                content()
                if let successor { cue(successor) }
            }
            .padding(.bottom, bottomContentInset)
        }
        .scrollPosition($position)
        .scrollBounceBehavior(successor == nil ? .basedOnSize : .always, axes: .vertical)
        .onScrollGeometryChange(for: ActivityContinuationPull.Geometry.self) {
            .init($0)
        } action: { _, geometry in
            pull.configure(identity)
            pull.updateGeometry(geometry)
        }
        .onScrollPhaseChange { _, phase, context in
            pull.configure(identity)
            let geometry = ActivityContinuationPull.Geometry(context.geometry)
            let advance = pull.changePhase(to: phase, geometry: geometry)
            if advance, let successor, successor.isEnabled, successor.currentID == activityID {
                successor.advance()
            }
        }
        .onChange(of: identity) { _, identity in pull.configure(identity) }
        .onChange(of: activityID) { _, _ in
            pull.configure(identity)
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { position.scrollTo(edge: .top) }
        }
        .onDisappear { pull.cancel() }
        .sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: pull.hapticGeneration)
    }

    private func cue(_ successor: ActivityDetailContinuation) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().stroke(.secondary.opacity(0.2), lineWidth: 2)
                Circle().trim(from: 0, to: pull.progress)
                    .stroke(AppTheme.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: pull.isArmed ? "checkmark" : "arrow.up")
                    .font(.system(size: 12, weight: .semibold))
            }
            .frame(width: 28, height: 28)
            .foregroundStyle(pull.isArmed ? AppTheme.accent : .secondary)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                // All states occupy the same height, so arming cannot move the
                // bottom boundary and accidentally disarm its own gesture.
                ZStack(alignment: .leading) {
                    Text("Pull up for next activity").opacity(pull.isArmed ? 0 : 1)
                    Text("Release for next activity").opacity(pull.isArmed ? 1 : 0)
                }
                .font(.caption.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                Text(successor.nextName).font(.caption).foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, AppTheme.Spacing.large)
        .padding(.vertical, 16)
        .opacity(successor.isEnabled ? 1 : 0.5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Next activity: \(successor.nextName)"))
        .accessibilityValue(successor.isEnabled
            ? (pull.isArmed ? Text("Release to open") : Text("Pull up to continue"))
            : Text("Unavailable"))
        .accessibilityHint("Pull past the bottom and release, or use Next activity")
        .accessibilityIdentifier("activity-continuation-cue")
        .accessibilityActions {
            if successor.isEnabled { Button("Next activity", action: successor.advance) }
        }
    }
}

/// Release intent is independent of animation frames. A fling that bounces
/// past the boundary cannot arm this state machine after the finger lifts.
struct ActivityContinuationPull {
    struct Identity: Equatable {
        let currentID: Int
        let nextID: Int
    }

    struct Geometry: Equatable {
        let offset: CGFloat
        let contentSize: CGSize
        let containerSize: CGSize
        let topInset: CGFloat
        let bottomInset: CGFloat

        init(_ geometry: ScrollGeometry) {
            offset = geometry.contentOffset.y
            contentSize = geometry.contentSize
            containerSize = geometry.containerSize
            topInset = geometry.contentInsets.top
            bottomInset = geometry.contentInsets.bottom
        }

        init(offset: CGFloat, contentHeight: CGFloat, width: CGFloat = 390,
             height: CGFloat = 600, topInset: CGFloat = 0, bottomInset: CGFloat = 0) {
            self.offset = offset
            contentSize = CGSize(width: width, height: contentHeight)
            containerSize = CGSize(width: width, height: height)
            self.topInset = topInset
            self.bottomInset = bottomInset
        }

        var overscroll: CGFloat {
            // SwiftUI reports the drawable viewport after subtracting its
            // content insets, but keeps the native content-offset origin.
            // Adding bottomInset here would count that safe area twice.
            let bottom = max(-topInset, contentSize.height - containerSize.height - topInset)
            return max(0, offset - bottom)
        }

        func sameLayout(as other: Self) -> Bool {
            abs(contentSize.width - other.contentSize.width) <= 1
                && abs(contentSize.height - other.contentSize.height) <= 1
                && abs(containerSize.width - other.containerSize.width) <= 1
                && abs(containerSize.height - other.containerSize.height) <= 1
                && abs(topInset - other.topInset) <= 1 && abs(bottomInset - other.bottomInset) <= 1
        }
    }

    static let threshold: CGFloat = 64
    private(set) var hapticGeneration = 0
    private(set) var distance: CGFloat = 0
    private(set) var phase = ScrollPhase.idle
    private var identity: Identity?
    private var geometry: Geometry?
    private var eligibleDrag = false
    private var startingOverscroll: CGFloat = 0
    private var gaveFeedback = false

    var progress: CGFloat { min(1, max(0, distance / Self.threshold)) }
    var isArmed: Bool { eligibleDrag && distance >= Self.threshold }

    mutating func configure(_ identity: Identity?) {
        guard self.identity != identity else { return }
        self.identity = identity
        cancel()
    }

    mutating func cancel() {
        eligibleDrag = false
        distance = 0
    }

    mutating func updateGeometry(_ next: Geometry) {
        if let geometry, !geometry.sameLayout(as: next) { cancel() }
        geometry = next
        guard phase == .interacting, eligibleDrag else { distance = 0; return }
        distance = max(0, next.overscroll - startingOverscroll)
        if isArmed && !gaveFeedback {
            hapticGeneration += 1
            gaveFeedback = true
        }
    }

    /// Returns true at most once, on finger release. Layout or target changes
    /// cancel the whole drag and require a new touch before it can arm again.
    mutating func changePhase(to next: ScrollPhase, geometry nextGeometry: Geometry) -> Bool {
        let previous = phase
        if next == .tracking || (next == .interacting && previous != .tracking && previous != .interacting) {
            eligibleDrag = identity != nil
            gaveFeedback = false
            startingOverscroll = nextGeometry.overscroll
            geometry = nextGeometry
            distance = 0
        }
        if next == .interacting {
            phase = next
            updateGeometry(nextGeometry)
            return false
        }
        let released = previous == .interacting && (next == .idle || next == .decelerating)
        if released { updateGeometry(nextGeometry) }
        let advance = released && isArmed
        phase = next
        if next != .tracking { cancel() }
        return advance
    }
}

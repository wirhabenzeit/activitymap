import SwiftUI
import UIKit

enum ActivityContinuationDirection: CaseIterable, Equatable, Sendable {
    case previous, next
}

/// The host owns the order and availability. Missing neighbours are boundaries;
/// neither gesture wraps around to the other end of the sequence.
struct ActivityDetailContinuation {
    struct Destination {
        let id: Int
        let name: String
    }
    let currentID: Int
    let previous: Destination?
    let next: Destination?
    let isEnabled: Bool
    let navigate: (ActivityContinuationDirection) -> Void

    func destination(for direction: ActivityContinuationDirection) -> Destination? {
        let destination = direction == .previous ? previous : next
        return destination?.id == currentID ? nil : destination
    }
}

private struct ActivityContinuationIndicatorState: Equatable {
    var distance: CGFloat = 0
    var isArmed = false
    var progress: CGFloat { min(1, max(0, distance / ActivityContinuationPull.threshold)) }

    init() {}
    init(_ pull: ActivityContinuationPull) {
        distance = pull.distance
        isArmed = pull.isArmed
    }
}

extension EnvironmentValues {
    @Entry var activityDetailContinuation: ActivityDetailContinuation? = nil
}

/// UIKit owns bouncing, sheet resizing, and gesture arbitration. Indicators
/// occupy only the rubber-band gap; they add no rows or scrollable height.
struct ActivityContinuationScrollView<Content: View>: View {
    let activityID: Int
    var bottomContentInset: CGFloat = 0
    @ViewBuilder var content: () -> Content
    @Environment(\.activityDetailContinuation) private var continuation
    @State private var pull = ActivityContinuationPull()
    @State private var position = ScrollPosition(edge: .top)
    @State private var previousIndicator = ActivityContinuationIndicatorState()
    @State private var previousCueHeight: CGFloat?
    @State private var nextCueHeight: CGFloat?

    private var navigation: ActivityDetailContinuation? {
        guard let continuation, continuation.currentID == activityID else { return nil }
        return continuation
    }
    private var identity: ActivityContinuationPull.Identity? {
        guard let navigation, navigation.isEnabled else { return nil }
        let next = navigation.destination(for: .next)?.id
        guard next != nil else { return nil }
        return .init(currentID: activityID, previousID: nil, nextID: next)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) { content() }
                .padding(.bottom, bottomContentInset)
                .background(ActivityPreviousRefresh(currentID: activityID, destination: navigation?.isEnabled == true ? navigation?.destination(for: .previous) : nil,
                    updateIndicator: { previousIndicator = $0 }) {
                    guard let navigation, navigation.isEnabled, navigation.destination(for: .previous) != nil else { return }
                    navigation.navigate(.previous)
                })
        }
        .scrollPosition($position)
        .scrollBounceBehavior(navigation?.isEnabled == true ? .always : .basedOnSize, axes: .vertical)
        .overlay(alignment: .top) {
            indicator(for: .previous, state: previousIndicator)
        }
        .overlay(alignment: .bottom) {
            indicator(for: .next, state: .init(pull)).padding(.bottom, bottomContentInset)
        }
        .onScrollGeometryChange(for: ActivityContinuationPull.Geometry.self) {
            .init($0)
        } action: { _, geometry in
            #if DEBUG
            ActivityContinuationScrollProbe.geometryChanged(geometry.offset)
            #endif
            pull.configure(identity)
            pull.updateGeometry(geometry)
        }
        .onScrollPhaseChange { _, phase, context in
            #if DEBUG
            ActivityContinuationScrollProbe.phaseChanged(phase, offset: context.geometry.contentOffset.y)
            #endif
            pull.configure(identity)
            if let direction = pull.changePhase(to: phase, geometry: .init(context.geometry)), direction == .next,
               let navigation, navigation.isEnabled, navigation.destination(for: direction) != nil {
                navigation.navigate(direction)
            }
        }
        .onChange(of: identity) { _, identity in pull.configure(identity) }
        .onChange(of: navigation?.destination(for: .previous)?.id) { _, _ in previousIndicator = .init() }
        .onChange(of: navigation?.isEnabled) { _, enabled in
            if enabled != true { previousIndicator = .init() }
        }
        .onChange(of: activityID) { _, _ in
            previousIndicator = .init()
            pull.configure(identity)
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { position.scrollTo(edge: .top) }
        }
        .onDisappear { pull.cancel(); previousIndicator = .init() }
        .sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: pull.hapticGeneration)
    }

    @ViewBuilder private func indicator(for direction: ActivityContinuationDirection,
                                        state: ActivityContinuationIndicatorState) -> some View {
        if navigation?.isEnabled == true, state.distance > 0,
           let destination = navigation?.destination(for: direction) {
            cue(direction: direction, destination: destination, state: state)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                    if direction == .previous { previousCueHeight = height }
                    else { nextCueHeight = height }
                }
                .frame(height: state.distance, alignment: .center)
                .clipped()
                .opacity(min(1, state.distance / 24))
                .allowsHitTesting(false)
        }
    }

    private func cue(direction: ActivityContinuationDirection,
                     destination: ActivityDetailContinuation.Destination,
                     state: ActivityContinuationIndicatorState) -> some View {
        let previous = direction == .previous
        let labelOpacity = (previous ? previousCueHeight : nextCueHeight)
            .map { min(1, max(0, (state.distance - $0) / 8)) } ?? 0
        return HStack(spacing: 12) {
            ZStack {
                Circle().stroke(.secondary.opacity(0.2), lineWidth: 2)
                Circle().trim(from: 0, to: state.progress)
                    .stroke(AppTheme.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: state.isArmed ? "checkmark" : previous ? "arrow.down" : "arrow.up")
                    .font(.system(size: 12, weight: .semibold))
            }
            .frame(width: 28, height: 28)
            .scaleEffect(min(1, state.distance / 32))
            .foregroundStyle(state.isArmed ? AppTheme.accent : .secondary)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                ZStack(alignment: .leading) {
                    (previous ? Text("Pull down for previous activity") : Text("Pull up for next activity"))
                        .opacity(state.isArmed ? 0 : 1)
                    (previous ? Text("Release for previous activity") : Text("Release for next activity"))
                        .opacity(state.isArmed ? 1 : 0)
                }
                .font(.caption.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                Text(destination.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(labelOpacity)
        }
        .padding(.horizontal, AppTheme.Spacing.large)
        .padding(.vertical, 12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(previous ? Text("Previous activity: \(destination.name)") : Text("Next activity: \(destination.name)"))
        .accessibilityValue(state.isArmed ? Text("Release to open") : Text("Keep pulling"))
        .accessibilityIdentifier(previous ? "activity-continuation-previous-cue" : "activity-continuation-cue")
    }
}

/// A real refresh control reserves top pulls for scrolling inside native sheets.
/// Its system spinner is hidden; both edges render the shared SwiftUI cue.
/// The shared pull policy applies before a completed native pan can navigate.
private struct ActivityPreviousRefresh: UIViewRepresentable {
    let currentID: Int
    let destination: ActivityDetailContinuation.Destination?
    let updateIndicator: (ActivityContinuationIndicatorState) -> Void
    let action: () -> Void

    func makeUIView(context: Context) -> Attachment { Attachment() }
    func updateUIView(_ view: Attachment, context: Context) {
        view.currentID = currentID
        view.destination = destination
        view.action = action
        view.updateIndicator = updateIndicator
        view.attach()
    }
    static func dismantleUIView(_ view: Attachment, coordinator: ()) { view.detach() }

    final class Attachment: UIView {
        var currentID = 0
        var destination: ActivityDetailContinuation.Destination?
        var action: (() -> Void)?
        var updateIndicator: ((ActivityContinuationIndicatorState) -> Void)?
        private var lastIndicator = ActivityContinuationIndicatorState()
        private let control = UIRefreshControl()
        private weak var scroll: UIScrollView?
        private var startingInset: CGFloat = 0
        private var pull = ActivityContinuationPull()
        private var identity: ActivityContinuationPull.Identity? {
            destination.map { .init(currentID: currentID, previousID: $0.id, nextID: nil) }
        }

        init() {
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            control.tintColor = .clear
            control.accessibilityElementsHidden = true
        }
        @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
        override func didMoveToWindow() { super.didMoveToWindow(); attach() }
        override func layoutSubviews() { super.layoutSubviews(); attach() }

        func attach() {
            pull.configure(identity)
            var ancestor = superview
            while let view = ancestor, !(view is UIScrollView) { ancestor = view.superview }
            guard let parent = ancestor as? UIScrollView else { return }
            if scroll !== parent {
                detach()
                scroll = parent
                parent.panGestureRecognizer.addTarget(self, action: #selector(panChanged))
            }
            if destination != nil {
                if parent.refreshControl !== control { parent.refreshControl = control }
            } else if parent.refreshControl === control {
                if control.isRefreshing { control.endRefreshing() }
                parent.refreshControl = nil
            }
        }
        func detach() {
            pull.cancel()
            if control.isRefreshing { control.endRefreshing() }
            scroll?.panGestureRecognizer.removeTarget(self, action: #selector(panChanged))
            if scroll?.refreshControl === control { scroll?.refreshControl = nil }
            scroll = nil
        }
        private func publishIndicator(_ state: ActivityContinuationIndicatorState) {
            // Normal scrolling publishes no updates and never touches refresh
            // presentation, preserving native momentum after finger lift.
            guard state != lastIndicator else { return }
            lastIndicator = state
            updateIndicator?(state)
        }
        @objc private func panChanged(_ pan: UIPanGestureRecognizer) {
            guard let scroll else { return }
            if pan.state == .began { startingInset = scroll.adjustedContentInset.top }
            // Refresh can insert its own inset after arming. Keep the touch's
            // original origin, so that system animation does not change progress.
            let geometry = ActivityContinuationPull.Geometry(offset: scroll.contentOffset.y,
                contentHeight: scroll.contentSize.height, width: scroll.bounds.width,
                height: scroll.bounds.height, topInset: startingInset)
            pull.configure(identity)
            switch pan.state {
            case .began:
                _ = pull.changePhase(to: .tracking, geometry: geometry)
            case .changed:
                let feedback = pull.hapticGeneration
                _ = pull.changePhase(to: .interacting, geometry: geometry)
                if pull.hapticGeneration != feedback {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.6)
                }
                publishIndicator(.init(pull))
            case .ended, .cancelled, .failed:
                let expected = identity
                let navigate = pan.state == .ended
                    && pull.changePhase(to: .idle, geometry: geometry) == .previous
                pull.cancel()
                // Finish UIKit's touch dispatch before replacing content. A
                // sheet must not take over while the finger is still down.
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    // Ending an idle refresh resets native scroll motion too.
                    // Ordinary flicks must leave the scroll view untouched.
                    if self.control.isRefreshing { self.control.endRefreshing() }
                    self.publishIndicator(.init())
                    if navigate, self.identity == expected { self.action?() }
                }
            default: break
            }
        }
    }
}

/// A pull locks to one edge until the finger lifts. Inertia can never arm it,
/// and resizing or changing the activity sequence cancels the entire gesture.
struct ActivityContinuationPull {
    struct Identity: Equatable {
        let currentID: Int
        let previousID: Int?
        let nextID: Int?

        func supports(_ direction: ActivityContinuationDirection) -> Bool {
            let destination = direction == .previous ? previousID : nextID
            return destination != nil && destination != currentID
        }
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

        func overscroll(for direction: ActivityContinuationDirection) -> CGFloat {
            if direction == .previous { return max(0, -topInset - offset) }
            // SwiftUI's drawable viewport already excludes content insets,
            // while its content offset keeps the native coordinate origin.
            // Clamp short content to that origin rather than a mid-page edge.
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

    static let threshold: CGFloat = 80
    private(set) var hapticGeneration = 0
    private(set) var distance: CGFloat = 0
    private(set) var phase = ScrollPhase.idle
    private(set) var direction: ActivityContinuationDirection?
    private var identity: Identity?
    private var geometry: Geometry?
    private var startingGeometry: Geometry?
    private var eligibleDrag = false
    private var gaveFeedback = false

    var progress: CGFloat { min(1, max(0, distance / Self.threshold)) }
    var isArmed: Bool { eligibleDrag && direction != nil && distance >= Self.threshold }

    mutating func configure(_ identity: Identity?) {
        guard self.identity != identity else { return }
        self.identity = identity
        cancel()
    }

    mutating func cancel() {
        eligibleDrag = false
        distance = 0
        direction = nil
    }

    mutating func updateGeometry(_ next: Geometry) {
        if let geometry, !geometry.sameLayout(as: next) { cancel() }
        geometry = next
        guard phase == .interacting, eligibleDrag else { distance = 0; return }
        if direction == nil {
            direction = ActivityContinuationDirection.allCases.first {
                next.overscroll(for: $0) - (startingGeometry?.overscroll(for: $0) ?? 0) > 2
            }
        }
        guard let direction, identity?.supports(direction) == true else { distance = 0; return }
        distance = max(0, next.overscroll(for: direction) - (startingGeometry?.overscroll(for: direction) ?? 0))
        if isArmed && !gaveFeedback {
            hapticGeneration += 1
            gaveFeedback = true
        }
    }

    /// Returns one direction on release, never during settling or animation.
    mutating func changePhase(to next: ScrollPhase, geometry nextGeometry: Geometry) -> ActivityContinuationDirection? {
        let previous = phase
        if next == .tracking || (next == .interacting && previous != .tracking && previous != .interacting) {
            eligibleDrag = identity != nil
            gaveFeedback = false
            startingGeometry = nextGeometry
            geometry = nextGeometry
            distance = 0
            direction = nil
        }
        if next == .interacting {
            phase = next
            updateGeometry(nextGeometry)
            return nil
        }
        let released = previous == .interacting && (next == .idle || next == .decelerating)
        if released { updateGeometry(nextGeometry) }
        let destination = released && isArmed ? direction : nil
        phase = next
        if next != .tracking { cancel() }
        return destination
    }
}

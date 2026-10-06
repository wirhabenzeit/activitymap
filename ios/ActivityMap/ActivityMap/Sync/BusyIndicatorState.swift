import SwiftUI

/// The account avatar's quiet loading indicator (#309), mirroring the web's
/// `src/lib/activity-loading.ts`. It appears only after a short busy period, so
/// cache-only work never flashes, and then stays for a minimum time.
struct BusyIndicatorState: Equatable {
    static let showAfter: TimeInterval = 0.25
    static let minimumVisible: TimeInterval = 0.6

    private(set) var visible = false
    private var busySince: Date?
    private var shownAt: Date?

    /// Returns when to re-evaluate, if at all.
    mutating func update(busy: Bool, now: Date) -> Date? {
        if busy {
            guard !visible else { return nil }
            let since = busySince ?? now
            busySince = since
            let showAt = since.addingTimeInterval(Self.showAfter)
            guard now >= showAt else { return showAt }
            visible = true
            shownAt = now
            return nil
        }
        busySince = nil
        if visible, let shownAt {
            let hideAt = shownAt.addingTimeInterval(Self.minimumVisible)
            if now < hideAt { return hideAt }
        }
        visible = false
        shownAt = nil
        return nil
    }
}

extension SyncController.Status {
    /// Downloading only: a rate-limit or retry wait, pause or failure is not.
    var showsLoadingIndicator: Bool { self == .syncing }
}

/// A thin arc circling the avatar while activities sync. Driven by the clock,
/// so it never restarts while the interval continues.
struct AvatarSyncIndicator: View {
    let busy: Bool
    @State private var state = BusyIndicatorState()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if state.visible {
                TimelineView(.animation(paused: reduceMotion)) { context in
                    Circle().trim(from: 0, to: 0.3)
                        .stroke(.white, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(reduceMotion ? -90
                            : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1) * 360))
                }
                .background { Circle().stroke(.white.opacity(0.25), lineWidth: 2) }
                .frame(width: 38, height: 38)
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: state.visible)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .task(id: busy) {
            while !Task.isCancelled, let wake = state.update(busy: busy, now: .now) {
                try? await Task.sleep(for: .seconds(max(0, wake.timeIntervalSinceNow)))
            }
        }
    }
}

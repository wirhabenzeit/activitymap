import Foundation
import Testing
@testable import ActivityMap

/// Same cases as src/lib/activity-loading.test.ts, so both avatars agree (#309).
struct BusyIndicatorStateTests {
    private let start = Date(timeIntervalSinceReferenceDate: 1_000)
    private func at(_ seconds: TimeInterval) -> Date { start.addingTimeInterval(seconds) }

    @Test func shortWorkNeverShows() {
        var state = BusyIndicatorState()
        #expect(state.update(busy: true, now: at(0)) == at(BusyIndicatorState.showAfter))
        #expect(!state.visible)
        #expect(state.update(busy: false, now: at(0.2)) == nil)
        #expect(state == BusyIndicatorState())
    }

    @Test func continuousSyncShowsOneUninterruptedIndicator() {
        var state = BusyIndicatorState()
        _ = state.update(busy: true, now: at(0))
        #expect(state.update(busy: true, now: at(BusyIndicatorState.showAfter)) == nil)
        #expect(state.visible)
        let shown = state
        _ = state.update(busy: true, now: at(2))
        #expect(state == shown)
    }

    @Test func minimumVisibleTimeThenAlwaysEnds() {
        var state = BusyIndicatorState()
        _ = state.update(busy: true, now: at(0))
        _ = state.update(busy: true, now: at(BusyIndicatorState.showAfter))
        let hideAt = at(BusyIndicatorState.showAfter + BusyIndicatorState.minimumVisible)
        #expect(state.update(busy: false, now: at(BusyIndicatorState.showAfter + 0.1)) == hideAt)
        #expect(state.visible)
        #expect(state.update(busy: false, now: hideAt) == nil)
        #expect(state == BusyIndicatorState())
    }

    @Test func resumingWithinMinimumContinuesTheInterval() {
        var state = BusyIndicatorState()
        _ = state.update(busy: true, now: at(0))
        _ = state.update(busy: true, now: at(BusyIndicatorState.showAfter))
        _ = state.update(busy: false, now: at(BusyIndicatorState.showAfter + 0.05))
        _ = state.update(busy: true, now: at(BusyIndicatorState.showAfter + 0.1))
        #expect(state.visible)
        // The minimum still counts from the original appearance.
        #expect(state.update(busy: false, now: at(BusyIndicatorState.showAfter + 0.3))
                == at(BusyIndicatorState.showAfter + BusyIndicatorState.minimumVisible))
    }

    @Test func onlyActiveDownloadingShowsTheIndicator() {
        #expect(SyncController.Status.syncing.showsLoadingIndicator)
        for status: SyncController.Status in [.ready, .paused, .offline, .expired, .signedOut, .disconnected,
                                              .failed("x"), .rateLimited(.now), .retryAfter(.now)] {
            #expect(!status.showsLoadingIndicator)
        }
    }
}

import SwiftUI
import Testing
@testable import ActivityMap

@MainActor
struct ActivityContinuationTests {
    private let identity = ActivityContinuationPull.Identity(currentID: 2, previousID: 3, nextID: 1)
    private func geometry(_ direction: ActivityContinuationDirection, _ distance: CGFloat,
                          width: CGFloat = 390, height: CGFloat = 600) -> ActivityContinuationPull.Geometry {
        .init(offset: direction == .previous ? -distance : 1000 - height + distance,
              contentHeight: 1000, width: width, height: height)
    }
    private func begin(_ pull: inout ActivityContinuationPull, at direction: ActivityContinuationDirection) {
        pull.configure(identity)
        let tracking = pull.changePhase(to: .tracking, geometry: geometry(direction, 0))
        let interacting = pull.changePhase(to: .interacting, geometry: geometry(direction, 0))
        #expect(tracking == nil && interacting == nil)
    }

    @Test(arguments: ActivityContinuationDirection.allCases)
    func deliberatePullArmsAndCommitsOnlyOnRelease(direction: ActivityContinuationDirection) {
        var pull = ActivityContinuationPull()
        begin(&pull, at: direction)
        #expect(pull.distance == 0 && pull.direction == nil, "Resting content has no indicator")
        pull.updateGeometry(geometry(direction, 40))
        #expect(pull.direction == direction && pull.progress > 0 && !pull.isArmed)
        pull.updateGeometry(geometry(direction, 70))
        #expect(!pull.isArmed && pull.hapticGeneration == 0, "A pull that armed at the old sensitivity must now cancel")
        pull.updateGeometry(geometry(direction, 90))
        #expect(pull.isArmed && pull.hapticGeneration == 1)
        let released = pull.changePhase(to: .decelerating, geometry: geometry(direction, 90))
        #expect(released == direction)
        pull.updateGeometry(geometry(direction, 100))
        let settled = pull.changePhase(to: .idle, geometry: geometry(direction, 0))
        #expect(settled == nil, "One drag must never navigate twice")
        #expect(pull.direction == nil && pull.distance == 0, "Settling must remove the indicator")
    }

    @Test(arguments: ActivityContinuationDirection.allCases)
    func reversingCancelsAndRearmingDoesNotRepeatHaptic(direction: ActivityContinuationDirection) {
        var pull = ActivityContinuationPull()
        begin(&pull, at: direction)
        pull.updateGeometry(geometry(direction, 80))
        pull.updateGeometry(geometry(direction, 30))
        #expect(!pull.isArmed)
        let cancelled = pull.changePhase(to: .idle, geometry: geometry(direction, 30))
        #expect(cancelled == nil)
        begin(&pull, at: direction)
        pull.updateGeometry(geometry(direction, 80))
        pull.updateGeometry(geometry(direction, 30))
        pull.updateGeometry(geometry(direction, 80))
        #expect(pull.hapticGeneration == 2, "At most one threshold haptic per drag")
        let released = pull.changePhase(to: .idle, geometry: geometry(direction, 80))
        #expect(released == direction)
    }

    @Test(arguments: ActivityContinuationDirection.allCases)
    func aSinglePullCannotChangeDirection(direction: ActivityContinuationDirection) {
        let opposite: ActivityContinuationDirection = direction == .previous ? .next : .previous
        var pull = ActivityContinuationPull()
        begin(&pull, at: direction)
        pull.updateGeometry(geometry(direction, 20))
        pull.updateGeometry(geometry(opposite, 100))
        #expect(pull.direction == direction && pull.distance == 0)
        let released = pull.changePhase(to: .idle, geometry: geometry(opposite, 100))
        #expect(released == nil)
    }

    @Test(arguments: ActivityContinuationDirection.allCases)
    func momentumAndProgrammaticScrollingCannotNavigate(direction: ActivityContinuationDirection) {
        var pull = ActivityContinuationPull()
        begin(&pull, at: direction)
        let flung = pull.changePhase(to: .decelerating, geometry: geometry(direction, -30))
        pull.updateGeometry(geometry(direction, 120))
        #expect(flung == nil && pull.direction == nil && pull.hapticGeneration == 0)
        let settled = pull.changePhase(to: .idle, geometry: geometry(direction, 0))
        let animated = pull.changePhase(to: .animating, geometry: geometry(direction, 0))
        pull.updateGeometry(geometry(direction, 100))
        let finished = pull.changePhase(to: .idle, geometry: geometry(direction, 100))
        #expect(settled == nil && animated == nil && finished == nil)
        #expect(pull.distance == 0, "Inertial overscroll must not display a gesture cue")
    }

    @Test(arguments: ActivityContinuationDirection.allCases)
    func missingNeighbourNeverArmsOrWraps(direction: ActivityContinuationDirection) {
        var pull = ActivityContinuationPull()
        pull.configure(.init(currentID: 2, previousID: direction == .previous ? nil : 3,
                             nextID: direction == .next ? nil : 1))
        _ = pull.changePhase(to: .tracking, geometry: geometry(direction, 0))
        _ = pull.changePhase(to: .interacting, geometry: geometry(direction, 0))
        pull.updateGeometry(geometry(direction, 120))
        #expect(pull.distance == 0 && !pull.isArmed && pull.hapticGeneration == 0)
        let released = pull.changePhase(to: .idle, geometry: geometry(direction, 120))
        #expect(released == nil)
    }

    @Test func changingEitherNeighbourOrDisablingCancelsTheCurrentDrag() {
        let changes: [ActivityContinuationPull.Identity?] = [
            .init(currentID: 2, previousID: 4, nextID: 1),
            .init(currentID: 2, previousID: 3, nextID: 5),
            .init(currentID: 1, previousID: 2, nextID: nil), nil,
        ]
        for replacement in changes {
            var pull = ActivityContinuationPull()
            begin(&pull, at: .previous)
            pull.updateGeometry(geometry(.previous, 80))
            pull.configure(replacement)
            pull.updateGeometry(geometry(.previous, 120))
            let released = pull.changePhase(to: .idle, geometry: geometry(.previous, 120))
            #expect(released == nil && pull.direction == nil)
        }
    }

    @Test(arguments: ActivityContinuationDirection.allCases)
    func resizingCancelsUntilANewTouch(direction: ActivityContinuationDirection) {
        var pull = ActivityContinuationPull()
        begin(&pull, at: direction)
        pull.updateGeometry(geometry(direction, 80))
        pull.updateGeometry(geometry(direction, 80, width: 700, height: 320))
        let cancelled = pull.changePhase(to: .idle, geometry: geometry(direction, 100, width: 700, height: 320))
        #expect(cancelled == nil)
        begin(&pull, at: direction)
        pull.updateGeometry(geometry(direction, 80))
        let released = pull.changePhase(to: .idle, geometry: geometry(direction, 80))
        #expect(released == direction)
    }

    @Test(arguments: ActivityContinuationDirection.allCases)
    func catchingAnExistingBounceRequiresAnAdditionalPull(direction: ActivityContinuationDirection) {
        var pull = ActivityContinuationPull()
        pull.configure(identity)
        _ = pull.changePhase(to: .tracking, geometry: geometry(direction, 90))
        _ = pull.changePhase(to: .interacting, geometry: geometry(direction, 92))
        let released = pull.changePhase(to: .idle, geometry: geometry(direction, 92))
        #expect(released == nil && pull.hapticGeneration == 0)
    }

    @Test func boundariesUseTheInsetAdjustedViewportAndClampShortContent() {
        // The recorded iPhone's native viewport is 874pt; SwiftUI reports 724pt
        // after its 116pt top and 34pt bottom insets, retaining native offsets.
        let phoneRest = ActivityContinuationPull.Geometry(offset: 568 + 2.0 / 3,
            contentHeight: 1408 + 2.0 / 3, height: 724, topInset: 116, bottomInset: 34)
        #expect(abs(phoneRest.overscroll(for: .next)) < 0.01)
        let phonePull = ActivityContinuationPull.Geometry(offset: 675,
            contentHeight: 1408 + 2.0 / 3, height: 724, topInset: 116, bottomInset: 34)
        #expect(abs(phonePull.overscroll(for: .next) - (106 + 1.0 / 3)) < 0.01)
        let phoneTop = ActivityContinuationPull.Geometry(offset: -196,
            contentHeight: 1408 + 2.0 / 3, height: 724, topInset: 116, bottomInset: 34)
        #expect(phoneTop.overscroll(for: .previous) == 80)
        let pad = ActivityContinuationPull.Geometry(offset: 335.5,
            contentHeight: 1525.5, width: 411, height: 1270, bottomInset: 20)
        #expect(pad.overscroll(for: .next) == 80)
        let map = ActivityContinuationPull.Geometry(offset: 480, contentHeight: 1000, height: 600)
        #expect(map.overscroll(for: .next) == 80)
        let shortRest = ActivityContinuationPull.Geometry(offset: -20, contentHeight: 300, topInset: 20)
        #expect(shortRest.overscroll(for: .previous) == 0 && shortRest.overscroll(for: .next) == 0)
    }

    @Test(arguments: ActivityContinuationDirection.allCases)
    func insetListPullArmsAndReleases(direction: ActivityContinuationDirection) {
        var pull = ActivityContinuationPull()
        pull.configure(identity)
        let restingOffset: CGFloat = direction == .previous ? -116 : 568 + 2.0 / 3
        let resting = ActivityContinuationPull.Geometry(offset: restingOffset,
            contentHeight: 1408 + 2.0 / 3, height: 724, topInset: 116, bottomInset: 34)
        _ = pull.changePhase(to: .tracking, geometry: resting)
        _ = pull.changePhase(to: .interacting, geometry: resting)
        let released = ActivityContinuationPull.Geometry(offset: restingOffset + (direction == .previous ? -90 : 90),
            contentHeight: 1408 + 2.0 / 3, height: 724, topInset: 116, bottomInset: 34)
        pull.updateGeometry(released)
        #expect(pull.isArmed && pull.hapticGeneration == 1)
        let destination = pull.changePhase(to: .decelerating, geometry: released)
        #expect(destination == direction)
    }

    @Test func refusedPullCleanupCannotReleaseANewerCommittedGap() {
        var lifetime = ActivityContinuationCommitLifetime()
        var releases = 0
        func armCleanup() -> () -> Void {
            let attempt = lifetime.begin()
            return { if lifetime.finish(attempt) { releases += 1 } }
        }
        let refusedPullTimeout = armCleanup()
        let newerPullTimeout = armCleanup()
        refusedPullTimeout()
        #expect(releases == 0, "An older refused pull must not clear the newer cue or release its gap")
        newerPullTimeout()
        #expect(releases == 1, "The current refused pull still releases its held gap")
        newerPullTimeout()
        #expect(releases == 1, "Cleanup can run only once for each committed gap")
    }

    @Test func leavingThePageInvalidatesOutstandingPullCleanup() {
        var lifetime = ActivityContinuationCommitLifetime()
        var releases = 0
        func armCleanup() -> () -> Void {
            let attempt = lifetime.begin()
            return { if lifetime.finish(attempt) { releases += 1 } }
        }
        let departedPageTimeout = armCleanup()
        lifetime.cancel()
        departedPageTimeout()
        #expect(releases == 0, "A departed page must not release scroll state later")
        let returnedPageTimeout = armCleanup()
        departedPageTimeout()
        #expect(releases == 0, "Returning to the page must not revive a retired timeout")
        returnedPageTimeout()
        #expect(releases == 1, "A new attempt after returning keeps its own cleanup")
    }

}

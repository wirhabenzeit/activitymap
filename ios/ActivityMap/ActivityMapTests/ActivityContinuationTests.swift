import SwiftUI
import Testing
@testable import ActivityMap

@MainActor
struct ActivityContinuationTests {
    private let identity = ActivityContinuationPull.Identity(currentID: 1, nextID: 2)
    private func geometry(_ distance: CGFloat, width: CGFloat = 390, height: CGFloat = 600) -> ActivityContinuationPull.Geometry {
        .init(offset: 1000 - height + distance, contentHeight: 1000, width: width, height: height)
    }
    private func begin(_ pull: inout ActivityContinuationPull) {
        pull.configure(identity)
        let didAdvance1 = pull.changePhase(to: .tracking, geometry: geometry(0))
        #expect(!didAdvance1)
        let didAdvance2 = pull.changePhase(to: .interacting, geometry: geometry(0))
        #expect(!didAdvance2)
    }

    @Test func deliberatePullArmsAndCommitsOnlyOnRelease() {
        var pull = ActivityContinuationPull()
        begin(&pull)
        pull.updateGeometry(geometry(40))
        #expect(pull.progress > 0 && !pull.isArmed)
        pull.updateGeometry(geometry(70))
        #expect(pull.isArmed && pull.hapticGeneration == 1)
        let didAdvance3 = pull.changePhase(to: .decelerating, geometry: geometry(70))
        #expect(didAdvance3)
        pull.updateGeometry(geometry(100))
        let didAdvance4 = pull.changePhase(to: .idle, geometry: geometry(0))
        #expect(!didAdvance4, "One drag must never advance twice")
        #expect(!pull.isArmed && pull.progress == 0)
    }

    @Test func pullBackCancelsAndRearmingDoesNotRepeatHaptic() {
        var pull = ActivityContinuationPull()
        begin(&pull)
        pull.updateGeometry(geometry(80))
        pull.updateGeometry(geometry(30))
        #expect(!pull.isArmed)
        let didAdvance5 = pull.changePhase(to: .idle, geometry: geometry(30))
        #expect(!didAdvance5)
        begin(&pull)
        pull.updateGeometry(geometry(80))
        pull.updateGeometry(geometry(30))
        pull.updateGeometry(geometry(80))
        #expect(pull.hapticGeneration == 2, "At most one threshold haptic per drag")
        let didAdvance6 = pull.changePhase(to: .idle, geometry: geometry(80))
        #expect(didAdvance6)
    }

    @Test func momentumAndProgrammaticScrollingCannotAdvance() {
        var pull = ActivityContinuationPull()
        begin(&pull)
        let didAdvance7 = pull.changePhase(to: .decelerating, geometry: geometry(-30))
        #expect(!didAdvance7)
        pull.updateGeometry(geometry(120))
        #expect(!pull.isArmed && pull.hapticGeneration == 0)
        let didAdvance8 = pull.changePhase(to: .idle, geometry: geometry(0))
        #expect(!didAdvance8)
        let didAdvance9 = pull.changePhase(to: .animating, geometry: geometry(0))
        #expect(!didAdvance9)
        pull.updateGeometry(geometry(100))
        let didAdvance10 = pull.changePhase(to: .idle, geometry: geometry(100))
        #expect(!didAdvance10)
    }

    @Test func changingTargetOrDisablingCancelsTheCurrentDrag() {
        for replacement in [ActivityContinuationPull.Identity(currentID: 2, nextID: 3), nil] {
            var pull = ActivityContinuationPull()
            begin(&pull)
            pull.updateGeometry(geometry(80))
            pull.configure(replacement)
            pull.updateGeometry(geometry(120))
            let didAdvance11 = pull.changePhase(to: .idle, geometry: geometry(120))
            #expect(!didAdvance11)
        }
    }

    @Test func resizingOrContentReflowCancelsTheCurrentDrag() {
        var pull = ActivityContinuationPull()
        begin(&pull)
        pull.updateGeometry(geometry(80))
        pull.updateGeometry(geometry(80, width: 700, height: 320))
        let didAdvance12 = pull.changePhase(to: .idle, geometry: geometry(100, width: 700, height: 320))
        #expect(!didAdvance12)
        begin(&pull)
        pull.updateGeometry(geometry(80))
        pull.updateGeometry(.init(offset: 500, contentHeight: 1100))
        let didAdvance13 = pull.changePhase(to: .idle, geometry: .init(offset: 650, contentHeight: 1100))
        #expect(!didAdvance13)
    }

    @Test func catchingAnExistingBounceRequiresAnAdditionalPull() {
        var pull = ActivityContinuationPull()
        pull.configure(identity)
        let didAdvance14 = pull.changePhase(to: .tracking, geometry: geometry(90))
        #expect(!didAdvance14)
        let didAdvance15 = pull.changePhase(to: .interacting, geometry: geometry(92))
        #expect(!didAdvance15)
        let didAdvance16 = pull.changePhase(to: .idle, geometry: geometry(92))
        #expect(!didAdvance16)
    }

    @Test func boundaryUsesSwiftUIViewportWithoutCountingSafeAreasTwice() {
        // Recorded on iPhone: UIKit viewport is 874pt, while SwiftUI reports
        // 724pt after its 116pt top and 34pt bottom insets. Both offsets share
        // the native origin, so the resting bottom is 568 2/3pt.
        let phoneRest = ActivityContinuationPull.Geometry(offset: 568 + 2.0 / 3,
            contentHeight: 1408 + 2.0 / 3, height: 724, topInset: 116, bottomInset: 34)
        #expect(abs(phoneRest.overscroll) < 0.01)
        let phonePull = ActivityContinuationPull.Geometry(offset: 675,
            contentHeight: 1408 + 2.0 / 3, height: 724, topInset: 116, bottomInset: 34)
        #expect(abs(phonePull.overscroll - (106 + 1.0 / 3)) < 0.01)
        // The iPad's 1290pt native viewport similarly becomes 1270pt with its
        // bottom inset. Map's inset-free hosting keeps the ordinary formula.
        let pad = ActivityContinuationPull.Geometry(offset: 335.5,
            contentHeight: 1525.5, width: 411, height: 1270, bottomInset: 20)
        #expect(pad.overscroll == 80)
        let map = ActivityContinuationPull.Geometry(offset: 480, contentHeight: 1000, height: 600)
        #expect(map.overscroll == 80)
        let short = ActivityContinuationPull.Geometry(offset: -10, contentHeight: 300, topInset: 20)
        #expect(short.overscroll == 10)
    }

    @Test func nativeInsetListPullArmsAndReleases() {
        var pull = ActivityContinuationPull()
        pull.configure(identity)
        let bottom = ActivityContinuationPull.Geometry(offset: 568 + 2.0 / 3,
            contentHeight: 1408 + 2.0 / 3, height: 724, topInset: 116, bottomInset: 34)
        _ = pull.changePhase(to: .tracking, geometry: bottom)
        _ = pull.changePhase(to: .interacting, geometry: bottom)
        let released = ActivityContinuationPull.Geometry(offset: 675,
            contentHeight: 1408 + 2.0 / 3, height: 724, topInset: 116, bottomInset: 34)
        pull.updateGeometry(released)
        #expect(pull.isArmed && pull.hapticGeneration == 1)
        let advanced = pull.changePhase(to: .decelerating, geometry: released)
        #expect(advanced)
    }
}

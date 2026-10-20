import Observation
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

@MainActor @Suite(.serialized) struct StatsCalendarScrollRenderingTests {
    @Test func timelineScrollingDoesNotRebuildPreparedHistoryAndRestoresInspectionPosition() async throws {
        try await wait("window scene") { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.keyWindow
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 400)
        let state = TimelineState()
        let host = UIHostingController(rootView: TimelineRoot(state: state))
        host.safeAreaRegions = []
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; previous?.makeKeyAndVisible() }
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
        func scroller(_ view: UIView) -> UIScrollView? {
            if let scroll = view as? UIScrollView, scroll.contentSize.width > scroll.bounds.width * 2 { return scroll }
            return view.subviews.lazy.compactMap(scroller).first
        }
        try await wait("horizontal scroll materialization") { scroller(host.view) != nil }
        let scroll = try #require(scroller(host.view))
        try await wait("initial trailing viewport", diagnostics: "offset=\(scroll.contentOffset.x), anchor=\(String(describing: state.inspection.calendarWeek))") { scroll.contentOffset.x > 1000 }
        try await Task.sleep(for: .milliseconds(100))
        let initialBuilds = state.contentBuilds
        let initialAnchor = state.inspection.calendarWeek
        #expect(initialAnchor != nil, "The initial viewport is retained before any pan or day selection")
        let initialOffset = scroll.contentOffset.x
        state.inspection.calendarDay = 790
        try await Task.sleep(for: .milliseconds(50))
        #expect(abs(scroll.contentOffset.x - initialOffset) < 1, "The first visible-day selection must not become a new scroll anchor")
        // Each display interval crosses week IDs. These layout-driven position
        // updates must stay inside the scrolling leaf, independent of history size.
        for offset in stride(from: 1200.0, through: 3000, by: 90) {
            scroll.setContentOffset(CGPoint(x: offset, y: 0), animated: false)
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(abs(scroll.contentOffset.x - 3000) < 1)
        #expect(state.contentBuilds == initialBuilds, "Scrolling must not rebuild all prepared calendar columns")
        #expect(state.inspection.calendarWeek == initialAnchor, "Intermediate week positions do not invalidate shared inspection")

        let offset = scroll.contentOffset.x
        state.metricRevision += 1
        try await wait("metric content refresh", diagnostics: "builds=\(state.contentBuilds), initial=\(initialBuilds)") { state.contentBuilds > initialBuilds }
        #expect(abs(scroll.contentOffset.x - offset) < 1, "Metric changes preserve the timeline position")

        state.inspection.calendarWeek = 140
        try await wait("restore week 140", diagnostics: "offset=\(scroll.contentOffset.x), expected=3080, anchor=\(String(describing: state.inspection.calendarWeek))") { abs(scroll.contentOffset.x - 140 * 22) < 2 }
        #expect(scroll.contentOffset.x > 0, "A restored inspection anchor still positions the timeline")

        // Explicit inspection state is the public restoration contract. Direct
        // UIKit offset setters measure invalidation above; they do not publish
        // SwiftUI's scroll-position identity. Real XCUI covers native pan saves.
        state.inspection.calendarWeek = 100
        try await wait("restore week 100", diagnostics: "offset=\(scroll.contentOffset.x), anchor=\(String(describing: state.inspection.calendarWeek))") {
            abs(scroll.contentOffset.x - 2200) < 2
        }
        state.showsTimeline = false
        try await wait("timeline disappearance", diagnostics: "anchor=\(String(describing: state.inspection.calendarWeek))") {
            state.disappearances == 1
        }
        #expect(state.inspection.calendarWeek == 100, "Leaving preserves the declared inspection viewport")
        state.showsTimeline = true
        try await wait("reopened week 100", diagnostics: "anchor=\(String(describing: state.inspection.calendarWeek))") {
            guard let reopened = scroller(host.view) else { return false }
            return abs(reopened.contentOffset.x - 2200) < 2
        }
    }

    private func wait(_ stage: String, diagnostics: @autoclosure () -> String = "", _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(10)
        while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(25)) }
        try #require(condition(), "Calendar timeline did not settle at \(stage): \(diagnostics())")
    }
}

@MainActor @Observable private final class TimelineState {
    let inspection = StatsTileInspection()
    var metricRevision = 0
    var showsTimeline = true
    @ObservationIgnored var contentBuilds = 0
    @ObservationIgnored var disappearances = 0
}

private struct TimelineRoot: View {
    let state: TimelineState
    var body: some View {
        let revision = state.metricRevision
        if state.showsTimeline {
            StatsCalendarHistoryScroll(restoredWeek: state.inspection.calendarWeek ?? state.inspection.calendarDay,
                initialWeek: 799,
                saveWeek: { state.inspection.calendarWeek = $0 }) {
                let _ = state.contentBuilds += 1
                LazyHStack(spacing: 2) {
                    ForEach(0..<800, id: \.self) { week in
                        Text("\(week + revision)").frame(width: 20, height: 160).id(week)
                    }
                }
                .scrollTargetLayout()
            }
            .frame(height: 200)
            .onDisappear { state.disappearances += 1 }
        }
    }
}

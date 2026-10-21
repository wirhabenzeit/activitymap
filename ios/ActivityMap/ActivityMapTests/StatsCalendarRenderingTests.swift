import SwiftUI
import UIKit
import Observation
import Testing
@testable import ActivityMap

// Native viewport/state checks stay hosted; day AX geometry and real taps
// are exercised by StatsUITests (including StatsAccessibilityUITests.swift).
@MainActor @Suite(.serialized) struct StatsCalendarRenderingTests {
    private func fixture() async throws -> (StatsCalendarSnapshot, [Int: StatsCalendarSnapshot], Int) {
        try await calendarWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let library = try GalleryLibrary.load()
        let store = ActivityStore(activities: library.activities, listPresentation: ActivityListPresentation(defaults: nil))
        let today = StatsDates.day("2026-09-22")
        store.stats.refreshToday(now: StatsDates.date(today), timeZone: .gmt)
        guard case .dashboard(.calendar(let rolling, let years)) = await store.stats.result(.dashboard(.activityCalendar, .sport), for: store) else {
            throw CalendarRenderError.missingCalendar
        }
        return (rolling, years, today)
    }

    @Test(arguments: ["phone", "tablet", "large-text", "dark"])
    func compactCalendarFitsViewportAcrossSizes(variant: String) async throws {
        let (rolling, years, today) = try await fixture()
        let state = CalendarRenderState(), inspection = StatsTileInspection()
        let size = variant == "tablet" ? CGSize(width: 834, height: 1112) : CGSize(width: 375, height: 1000)
        let host = try CalendarRenderHost(root: CalendarRenderRoot(rolling: rolling, years: years, today: today,
            state: state, inspection: inspection, expanded: false)
            .environment(\.dynamicTypeSize, variant == "large-text" ? .accessibility3 : .large)
            .environment(\.colorScheme, variant == "dark" ? .dark : .light), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(150))
        try host.capture("compact-\(variant)")
        let outer = try #require(host.scrolls.first)
        #expect(outer.contentSize.width <= outer.bounds.width + 1)
        try host.capture("compact-\(variant)")
    }

    @Test func expandedHistoryRetainsNativeOffsetAcrossInspectionAndMetricChanges() async throws {
        let (rolling, years, today) = try await fixture()
        let state = CalendarRenderState(), inspection = StatsTileInspection()
        let host = try CalendarRenderHost(root: CalendarRenderRoot(rolling: rolling, years: years, today: today,
            state: state, inspection: inspection, expanded: true), size: CGSize(width: 402, height: 1000))
        defer { host.close() }
        try await calendarWait { host.horizontal != nil }
        let scroll = try #require(host.horizontal)
        try await calendarWait { scroll.contentOffset.x > 0 }
        #expect(scroll.contentSize.width > scroll.bounds.width * 3, "All years share one horizontal timeline")
        inspection.calendarDay = today
        try await calendarWait { inspection.calendarDay == today }
        let endOffset = scroll.contentOffset.x
        inspection.calendarDay = nil
        try await Task.sleep(for: .milliseconds(100))
        #expect(abs(scroll.contentOffset.x - endOffset) < 1)
        scroll.setContentOffset(CGPoint(x: 1200, y: scroll.contentOffset.y), animated: false)
        try await Task.sleep(for: .milliseconds(200))
        let before = scroll.contentOffset.x
        inspection.calendarDay = today - 365
        try await calendarWait { inspection.calendarDay != nil && inspection.calendarDay != today }
        let chosenDay = try #require(inspection.calendarDay)
        #expect(abs(scroll.contentOffset.x - before) < 1, "Clicking a day must not reposition the timeline")
        for option in [StatsToggleOption.distance, .time, .elevation, .sport] {
            state.option = option
            try await Task.sleep(for: .milliseconds(100))
            #expect(abs(scroll.contentOffset.x - before) < 1)
            #expect(inspection.calendarDay == chosenDay)
        }
        try host.capture("expanded-selected-history")
        scroll.setContentOffset(CGPoint(x: scroll.contentSize.width - scroll.bounds.width,
                                       y: scroll.contentOffset.y), animated: false)
        inspection.calendarDay = today
        try await calendarWait { inspection.calendarDay == today }
        // Calendar activity activation and native Back are checked by StatsUITests.
        try host.capture("expanded-latest-selection")
    }
}

private enum CalendarRenderError: Error { case missingCalendar }
@MainActor @Observable private final class CalendarRenderState {
    var option: StatsToggleOption? = .sport
    var openedActivity: Int?
}
private struct CalendarRenderRoot: View {
    let rolling: StatsCalendarSnapshot
    let years: [Int: StatsCalendarSnapshot]
    let today: Int
    let state: CalendarRenderState
    let inspection: StatsTileInspection
    let expanded: Bool
    var body: some View {
        ScrollView {
            StatsDashboardTile(tile: StatsDashboard.tiles.first { $0.id == .activityCalendar }!,
                option: Binding(get: { state.option }, set: { state.option = $0 }),
                displayed: .init(option: state.option, result: .calendar(rolling: rolling, years: years)),
                today: today, expanded: expanded, filtered: false, toggleExpansion: {},
                openActivity: { state.openedActivity = $0 }, inspection: inspection)
                .padding(16)
        }.background(AppTheme.contentBackground)
    }
}
@MainActor private func calendarWait(_ condition: () -> Bool) async throws {
    let until = Date().addingTimeInterval(10)
    while !condition(), Date() < until { try await Task.sleep(for: .milliseconds(40)) }
    try #require(condition(), "Calendar layout did not settle")
}
@MainActor private final class CalendarRenderHost<Content: View> {
    let window: UIWindow
    let previous: UIWindow?
    let host: UIHostingController<Content>
    init(root: Content, size: CGSize) throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        previous = scene.keyWindow
        window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        host = UIHostingController(rootView: root)
        host.safeAreaRegions = []
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
    }
    var scrolls: [UIScrollView] {
        func visit(_ view: UIView) -> [UIScrollView] { ((view as? UIScrollView).map { [$0] } ?? []) + view.subviews.flatMap(visit) }
        return visit(host.view)
    }
    var horizontal: UIScrollView? { scrolls.first { $0.contentSize.width > $0.bounds.width + 100 } }
    func capture(_ name: String) throws {
        let output = URL(fileURLWithPath: "/tmp/activitymap-native-calendar-preview")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true) }
        try image.pngData()?.write(to: output.appendingPathComponent(name + ".png"))
    }
    func close() { window.isHidden = true; previous?.makeKeyAndVisible() }
}

import UIKit
import XCTest

/// Real production-shell regressions for compact/focused Stats presentation
/// and competing native Back versus calendar scroll gestures.
@MainActor
final class StatsUITests: XCTestCase {
    func testCompactComparisonsConcealDetailControlsUntilExplicitExpansion() throws {
        continueAfterFailure = false
        let app = launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let dashboard = app.scrollViews["stats-dashboard"]
        XCTAssertTrue(dashboard.waitForExistence(timeout: 15), app.debugDescription)
        for (id, title, rhythmTitle, historyTitle) in [
            ("monthVsLastMonth", "This month", "Daily rhythm", "Month comparisons"),
            ("yearToDate", "Year to date", "Monthly rhythm", "Year comparisons"),
        ] {
            let expand = app.buttons["Expand \(title)"]
            reveal(expand, in: dashboard, app: app)
            let compact = dashboard.otherElements.matching(identifier: "stats-tile-\(id)").firstMatch
            XCTAssertTrue(compact.waitForExistence(timeout: 10), app.debugDescription)
            capture("Compact comparison \(title)")
            print("Compact comparison accessibility subtree (\(title)): \(compact.debugDescription)")
            XCTAssertFalse(compact.staticTexts[rhythmTitle].exists, "Compact \(title) must conceal its detail rhythm")
            XCTAssertFalse(compact.staticTexts[historyTitle].exists, "Compact \(title) must conceal its detail history")
            XCTAssertFalse(compact.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "stats-month-day-")).firstMatch.exists,
                           "Compact comparison must not expose detail-only day controls")
            XCTAssertFalse(compact.descendants(matching: .any)["stats-year-rhythm-month"].exists,
                           "Compact comparison must not expose the detail month picker")
            expand.tap()
            let detail = app.scrollViews["stats-detail-\(id)"]
            XCTAssertTrue(detail.waitForExistence(timeout: 10), app.debugDescription)
            let rhythm = detail.staticTexts[rhythmTitle]
            reveal(rhythm, in: detail, app: app)
            XCTAssertTrue(rhythm.isHittable)
            let control = id == "monthVsLastMonth"
                ? detail.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "stats-month-day-")).firstMatch
                : detail.descendants(matching: .any).matching(identifier: "stats-year-rhythm-month").firstMatch
            reveal(control, in: detail, app: app)
            XCTAssertTrue(control.isHittable, "Explicit expansion must expose the rhythm control")
            let history = detail.staticTexts[historyTitle]
            reveal(history, in: detail, app: app)
            XCTAssertTrue(history.isHittable, "Explicit expansion must expose period history")
            capture("Expanded comparison \(title)")
            let back = app.buttons["stats-detail-back"]
            reveal(back, in: detail, app: app)
            back.tap()
            XCTAssertTrue(detail.waitForNonExistence(timeout: 10), app.debugDescription)
        }
    }

    func testCompactSportMixRequiresExplicitExpansionAndFocusedSettingsRemainReachable() throws {
        try assertCompactSportMix(scenario: "standard")
    }

    func testLargeTextSportMixRequiresExplicitExpansionAndFocusedSettingsRemainReachable() throws {
        try assertCompactSportMix(scenario: "large-text")
    }

    private func assertCompactSportMix(scenario: String) throws {
        continueAfterFailure = false
        let app = launch(scenario)
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let dashboard = app.scrollViews["stats-dashboard"]
        XCTAssertTrue(dashboard.waitForExistence(timeout: 15), app.debugDescription)
        let expand = app.buttons["Expand Sport mix"]
        reveal(expand, in: dashboard, app: app)
        XCTAssertGreaterThanOrEqual(expand.frame.height, 44)
        let compactTile = dashboard.otherElements.matching(identifier: "stats-tile-sportMix").firstMatch
        XCTAssertTrue(compactTile.waitForExistence(timeout: 10), app.debugDescription)
        if scenario == "large-text" {
            let lastShare = try XCTUnwrap(compactTile.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "%")).allElementsBoundByIndex.last)
            reveal(lastShare, in: dashboard, app: app)
        } else { reveal(compactTile, in: dashboard, app: app) }
        capture("Compact Sport mix \(scenario)")
        print("Compact Sport mix accessibility subtree (\(scenario)): \(compactTile.debugDescription)")
        XCTAssertFalse(compactTile.descendants(matching: .any)["stats-sport-mix-extra-totals"].exists,
                       "The compact tile must not expose expanded totals")
        XCTAssertTrue(compactTile.buttons["Expand Sport mix"].exists,
                      "The tile group must retain its explicit expansion action")
        XCTAssertFalse(activityTotals(in: compactTile).exists, "Compact Sport mix must not expose activity totals")
        XCTAssertFalse(compactTile.buttons["Distance and climb"].exists)
        reveal(expand, in: dashboard, app: app)
        expand.tap()
        let detail = app.scrollViews["stats-detail-sportMix"]
        XCTAssertTrue(detail.waitForExistence(timeout: 10), app.debugDescription)
        assertSingleHeadingAndReachableSettings(app: app, detail: detail, title: "Sport mix")
        let totals = activityTotals(in: detail)
        reveal(totals, in: detail, app: app)
        XCTAssertTrue(totals.isHittable, "Expanded activity totals must remain reachable")
        // Wide focus uses the full table; compact focus discloses its
        // secondary distance/climb values below the activity totals.
        let extraTotals = detail.buttons["Distance and climb"]
        if extraTotals.exists { reveal(extraTotals, in: detail, app: app) }
        capture("Expanded Sport mix \(scenario)")
    }

    func testCalendarMultiYearPansAndVerticalScrollStayInDetail() throws {
        continueAfterFailure = false
        let app = launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let detail = openCalendar(app)
        let history = calendarHistory(app)
        reveal(history, in: detail, app: app)
        let latest = visibleDays(history, app: app)
        XCTAssertFalse(latest.isEmpty, app.debugDescription)
        let ordered = latest.sorted()
        let firstSelectedDay = try XCTUnwrap(ordered.isEmpty ? nil : ordered[ordered.count / 2])
        let firstSelection = app.buttons["stats-calendar-day-\(firstSelectedDay)"]
        XCTAssertTrue(firstSelection.isHittable)
        firstSelection.tap()
        XCTAssertEqual(visibleDays(history, app: app), latest,
                       "The first calendar-day selection must not reposition history")
        let lastDay = try XCTUnwrap(latest.max())
        var earliest = lastDay
        for _ in 0..<14 {
            pan(history, app: app, toEarlier: true)
            XCTAssertTrue(detail.exists && detail.isHittable,
                          "A rightward calendar pan must not invoke content Back")
            earliest = min(earliest, visibleDays(history, app: app).min() ?? earliest)
            if lastDay - earliest >= 370 { break }
        }
        XCTAssertGreaterThanOrEqual(lastDay - earliest, 370, "The timeline must pan across more than one year")
        let beforeForward = visibleDays(history, app: app)
        pan(history, app: app, toEarlier: false)
        XCTAssertTrue(detail.exists && detail.isHittable)
        XCTAssertNotEqual(beforeForward, visibleDays(history, app: app), "Leftward pans must also move visible dates")
        let retainedDays = visibleDays(history, app: app)
        XCTAssertFalse(retainedDays.isEmpty)
        capture("Multi-year calendar after horizontal panning")

        // Return via Back and reopen, preserving the production inspection's
        // calendar position before moving back to the latest history.
        app.buttons["stats-detail-back"].tap()
        XCTAssertTrue(detail.waitForNonExistence(timeout: 10))
        let reopened = openCalendar(app)
        reveal(history, in: reopened, app: app)
        XCTAssertFalse(visibleDays(history, app: app).isDisjoint(with: retainedDays),
                       "Reopening detail must restore the settled historical anchor")
        // Inspection intentionally retains the horizontal position. Scroll to
        // the trailing end using real leftward pans before selecting today.
        let today = app.buttons["stats-calendar-day-\(fixtureToday())"]
        for _ in 0..<16 {
            if today.exists && today.isHittable { break }
            pan(history, app: app, toEarlier: false)
        }
        XCTAssertTrue(today.isHittable, app.debugDescription)
        today.tap()
        let finalActivity = reopened.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Stats activity 9024")).firstMatch
        reveal(finalActivity, in: reopened, app: app)
        XCTAssertTrue(finalActivity.isHittable, "Vertical scrolling must reach the final real activity")
        XCTAssertTrue(reopened.exists && reopened.isHittable, "Vertical scrolling must keep calendar detail open")
        capture("Calendar selected day after vertical scrolling")
    }

    func testCalendarRetainsIntentionalContentAndNativeEdgeBack() throws {
        continueAfterFailure = false
        let app = launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        for edge in [false, true] {
            let detail = openCalendar(app)
            let history = calendarHistory(app)
            reveal(history, in: detail, app: app)
            let viewport = detail.frame.intersection(app.frame)
            // Content Back begins in the date/summary area above the timeline;
            // edge Back deliberately begins at the navigation column's edge,
            // including iPad's persistent filter rail beside that column.
            let y = edge ? history.frame.midY : max(viewport.minY + 80, history.frame.minY - 18)
            let startX = edge ? viewport.minX + 2 : viewport.minX + viewport.width * 0.24
            let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: startX, dy: y))
            let end = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: viewport.maxX - 20, dy: y))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)
            XCTAssertTrue(detail.waitForNonExistence(timeout: 10),
                          "Intentional \(edge ? "edge" : "content") Back must return to the dashboard\n\(app.debugDescription)")
            XCTAssertTrue(app.scrollViews["stats-dashboard"].isHittable)
        }
        capture("Stats dashboard after intentional Back")
    }

    private func launch(_ scenario: String = "standard") -> XCUIApplication {
        XCUIDevice.shared.orientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeLeft : .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--stats-ui-testing", "--stats-ui-scenario=\(scenario)",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    private func openCalendar(_ app: XCUIApplication) -> XCUIElement {
        let dashboard = app.scrollViews["stats-dashboard"]
        XCTAssertTrue(dashboard.waitForExistence(timeout: 15), app.debugDescription)
        let expand = app.buttons["Expand Activity calendar"]
        reveal(expand, in: dashboard, app: app)
        expand.tap()
        let detail = app.scrollViews["stats-detail-activityCalendar"]
        XCTAssertTrue(detail.waitForExistence(timeout: 10), app.debugDescription)
        return detail
    }

    private func assertSingleHeadingAndReachableSettings(app: XCUIApplication, detail: XCUIElement, title: String) {
        let headings = app.staticTexts.matching(identifier: "stats-detail-title")
        XCTAssertTrue(headings.firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(headings.allElementsBoundByIndex.filter(\.isHittable).count, 1,
                       "The focused tile has exactly one visible page heading")
        XCTAssertEqual(headings.firstMatch.label, title)
        if UIDevice.current.userInterfaceIdiom == .pad {
            XCTAssertTrue(app.navigationBars.allElementsBoundByIndex.filter(\.isHittable).isEmpty,
                          "The stationary iPad workspace header must not acquire a second native navigation bar")
            let settings = app.buttons["open-settings"]
            XCTAssertTrue(settings.exists && settings.isHittable, "Settings remains reachable from focused Stats")
            XCTAssertGreaterThanOrEqual(headings.firstMatch.frame.minY, detail.frame.minY,
                                        "The regular-width heading belongs to content rather than another blue bar")
            XCTAssertGreaterThan(headings.firstMatch.frame.minY, settings.frame.minY)
            settings.tap()
            let done = app.buttons["Done"]
            XCTAssertTrue(done.waitForExistence(timeout: 10), app.debugDescription)
            XCTAssertTrue(app.navigationBars["Settings"].exists, app.debugDescription)
            done.tap()
            XCTAssertTrue(detail.waitForExistence(timeout: 10))
            XCTAssertTrue(settings.isHittable)
        }
    }

    private func visibleDays(_ history: XCUIElement, app: XCUIApplication) -> Set<Int> {
        // Read one real AX snapshot per pan. Resolving every day as a separate
        // live element adds minutes of automation overhead to a short swipe.
        guard let snapshot = try? history.snapshot() else {
            XCTFail("The calendar accessibility snapshot was unavailable")
            return []
        }
        let viewport = snapshot.frame.intersection(app.frame).insetBy(dx: 3, dy: 3)
        var days = Set<Int>()
        func visit(_ element: any XCUIElementSnapshot) {
            let prefix = "stats-calendar-day-"
            if element.elementType == .button, element.identifier.hasPrefix(prefix), viewport.contains(element.frame),
               let day = Int(element.identifier.dropFirst(prefix.count)) { days.insert(day) }
            element.children.forEach(visit)
        }
        visit(snapshot)
        return days
    }

    private func calendarHistory(_ app: XCUIApplication) -> XCUIElement {
        // SwiftUI forwards the tile's ancestor identifier to nested scrollers
        // on iOS 27. The actual calendar's semantic name remains stable.
        app.scrollViews.matching(NSPredicate(format: "label == %@", "Activity calendar history")).firstMatch
    }

    private func fixtureToday() -> Int {
        // Match the offline fixture's launch-day Gregorian wall-clock key.
        let local = Calendar(identifier: .gregorian)
        let components = local.dateComponents([.year, .month, .day], from: Date())
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = .gmt
        return Int(utc.date(from: components)!.timeIntervalSince1970 / 86_400)
    }

    private func activityTotals(in element: XCUIElement) -> XCUIElement {
        element.descendants(matching: .any).matching(NSPredicate(
            format: "label == %@ OR label BEGINSWITH %@", "Activities", "Activities, ")).firstMatch
    }

    private func pan(_ history: XCUIElement, app: XCUIApplication, toEarlier: Bool) {
        let viewport = history.frame.intersection(app.frame)
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
            dx: viewport.minX + viewport.width * (toEarlier ? 0.2 : 0.8), dy: viewport.midY))
        let end = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
            dx: viewport.minX + viewport.width * (toEarlier ? 0.8 : 0.2), dy: viewport.midY))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .fast, thenHoldForDuration: 0.1)
    }

    private func reveal(_ element: XCUIElement, in scroll: XCUIElement, app: XCUIApplication) {
        let visibility = scrollVisibility(in: scroll, app: app)
        let viewport = visibility.viewport.insetBy(dx: -1, dy: -1)
        for _ in 0..<18 {
            if element.exists {
                let frame = element.frame
                if element.isHittable,
                   viewport.contains(frame) || visibility.chrome.contains(where: { $0.contains(frame) }) { return }
                if !frame.isEmpty, frame.minY < viewport.minY { scroll.swipeDown(); continue }
            }
            scroll.swipeUp()
        }
        XCTFail("Stats content was not reachable in visible viewport \(viewport): \(app.debugDescription)")
    }

    private func scrollVisibility(in scroll: XCUIElement, app: XCUIApplication) -> (viewport: CGRect, chrome: [CGRect]) {
        var viewport = scroll.frame.intersection(app.frame)
        var chrome: [CGRect] = []
        // SwiftUI's scroll AX frame includes the area behind stationary chrome.
        // A control hidden there needs a downward swipe, even if its y is positive.
        let topBars = app.navigationBars.allElementsBoundByIndex
            + app.otherElements.matching(identifier: "app-toolbar").allElementsBoundByIndex
        for bar in topBars where bar.isHittable {
            let frame = bar.frame
            chrome.append(frame)
            if frame.intersects(viewport), frame.midY < viewport.midY {
                let top = max(viewport.minY, frame.maxY)
                viewport = CGRect(x: viewport.minX, y: top, width: viewport.width,
                                  height: max(0, viewport.maxY - top))
            }
        }
        for bar in app.tabBars.allElementsBoundByIndex where bar.isHittable {
            let frame = bar.frame
            chrome.append(frame)
            if frame.intersects(viewport), frame.midY > viewport.midY {
                viewport.size.height = max(0, min(viewport.maxY, frame.minY) - viewport.minY)
            }
        }
        // Fixed toolbar actions such as native Back are already reachable in
        // chrome, while scroll content must fit below/above those same bars.
        return (viewport, chrome)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

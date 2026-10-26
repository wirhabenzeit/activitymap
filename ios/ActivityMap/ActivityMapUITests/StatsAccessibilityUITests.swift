import UIKit
import XCTest

/// Accessibility assertions migrated from hosted SwiftUI traversal. Each test
/// owns a real automation session; missing controls are failures, never skips.
@MainActor
extension StatsUITests {
    func testCompactMetricChoicesKeepTouchTargetsAndAccessibleSelection() {
        let app = axLaunch("metric-picker")
        defer { app.terminate() }
        let distance = app.buttons["Distance"], time = app.buttons["Moving time"]
        XCTAssertTrue(distance.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(distance.isSelected)
        XCTAssertFalse(time.isSelected)
        for label in ["Distance", "Moving time", "Elevation"] {
            let choice = app.buttons[label]
            XCTAssertTrue(choice.isHittable)
            XCTAssertGreaterThanOrEqual(choice.frame.width, 44)
            XCTAssertGreaterThanOrEqual(choice.frame.height, 44)
        }
        time.tap()
        XCTAssertTrue(time.isSelected)
        XCTAssertFalse(distance.isSelected)
    }

    func testMonthRhythmKeepsZeroAndMissingActivityDaysVisible() {
        let app = axLaunch("month-rhythm")
        defer { app.terminate() }
        let note = app.staticTexts["Dots mark activities with zero or no recorded value."]
        XCTAssertTrue(note.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Run"].exists, "Zero/missing values must retain the sport legend")
    }

    func testLargeTextMonthRhythmListsDaysInsteadOfDotExplanation() {
        let app = axLaunch("month-rhythm-large-text")
        defer { app.terminate() }
        XCTAssertTrue(app.staticTexts["Daily rhythm"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Dots mark activities with zero or no recorded value."].exists)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Oct 8")).firstMatch.exists,
                      "Accessibility text must expose the real day rows")
    }

    func testYearRhythmReadsExactMonthTotalsAndRetainsSelection() {
        let app = axLaunch("year-rhythm")
        defer { app.terminate() }
        let totals = app.descendants(matching: .any)["stats-year-rhythm-totals"].firstMatch
        XCTAssertTrue(totals.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(totals.label, "Oct 2026: 2025, 10 km; 2026, 20 km")
        let picker = app.buttons["stats-year-rhythm-month"]
        axReveal(picker, app: app)
        picker.tap()
        app.buttons["Aug 2026"].tap()
        XCTAssertEqual(totals.label, "Aug 2026: 2025, 30 km; 2026, 45 km")
        app.buttons["Moving time"].tap()
        XCTAssertEqual(totals.label, "Aug 2026: 2025, 2.0 h; 2026, 3.0 h")
        picker.tap()
        app.buttons["Oct 2026"].tap()
        XCTAssertEqual(totals.label, "Oct 2026: 2025, 2.0 h; 2026, 3.0 h")
    }

    func testPhoneHeadersKeepFiltersAndRestoreSettings() throws { try axHeaders("standard") }
    func testLandscapeHeadersKeepFiltersAndRestoreSettings() throws { try axHeaders("landscape") }
    func testLargeTextHeadersKeepFiltersAndRestoreSettings() throws { try axHeaders("large-text") }

    func testFocusedEmptyHistoryIsCompletedRatherThanCalculating() {
        let app = axLaunch("empty-history")
        defer { app.terminate() }
        let detail = app.scrollViews["stats-detail-weeklyVolume"]
        XCTAssertTrue(detail.waitForExistence(timeout: 15), app.debugDescription)
        app.buttons["Remove fixture history"].tap()
        XCTAssertTrue(detail.staticTexts["No activity history"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(detail.staticTexts["Calculating…"].exists)
    }

    func testActivityInspectionExposesRealBackAndCloseControls() { axInspection("standard") }
    func testLargeTextActivityInspectionExposesRealBackAndCloseControls() { axInspection("large-text") }

    private func axInspection(_ scenario: String) {
        let app = axLaunch(scenario)
        defer { app.terminate() }
        for (title, tileID, activityPrefix) in [
            ("Records", "records", "stats-record-currentYear-distance-"),
            ("This month", "monthVsLastMonth", "stats-month-activity-"),
        ] {
            let expand = app.buttons["stats-expand-\(tileID)"]
            XCTAssertTrue(app.scrollViews["stats-dashboard"].waitForExistence(timeout: 15))
            axReveal(expand, in: app.scrollViews["stats-dashboard"], app: app)
            expand.tap()
            let detail = app.scrollViews["stats-detail-\(tileID)"]
            XCTAssertTrue(detail.waitForExistence(timeout: 10), app.debugDescription)
            let record = detail.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", activityPrefix)).firstMatch
            axReveal(record, in: detail, app: app)
            record.tap()
            let back = app.buttons["stats-activity-back"]
            let close = app.buttons["Close activity details"]
            if UIDevice.current.userInterfaceIdiom == .pad && scenario != "large-text" {
                XCTAssertTrue(close.waitForExistence(timeout: 10), app.debugDescription)
                XCTAssertEqual(close.label, "Close activity details")
                XCTAssertGreaterThanOrEqual(close.frame.width, 44)
                XCTAssertGreaterThanOrEqual(close.frame.height, 44)
                close.tap()
                XCTAssertTrue(close.waitForNonExistence(timeout: 10))
            } else {
                XCTAssertTrue(back.waitForExistence(timeout: 10), app.debugDescription)
                XCTAssertEqual(back.label, "Back to \(title)")
                XCTAssertTrue(back.isHittable)
                back.tap()
                XCTAssertTrue(back.waitForNonExistence(timeout: 10))
            }
            XCTAssertTrue(detail.isHittable)
            app.buttons["stats-detail-back"].tap()
            XCTAssertTrue(detail.waitForNonExistence(timeout: 10))
            XCTAssertTrue(app.scrollViews["stats-dashboard"].isHittable)
        }
    }

    func testCompactCalendarCellsAreSquareAndControlsAreShared() throws { try axCompactCalendar("standard") }
    func testDarkCompactCalendarCellsAreSquareAndControlsAreShared() throws { try axCompactCalendar("dark") }
    func testLargeTextCompactCalendarCellsAreSquareAndControlsAreShared() throws { try axCompactCalendar("large-text") }

    private func axCompactCalendar(_ scenario: String) throws {
        let app = axLaunch(scenario)
        defer { app.terminate() }
        let dashboard = app.scrollViews["stats-dashboard"]
        XCTAssertTrue(dashboard.waitForExistence(timeout: 15))
        axReveal(app.buttons["stats-expand-activityCalendar"], in: dashboard, app: app)
        let tile = dashboard.otherElements.matching(identifier: "stats-tile-activityCalendar").firstMatch
        let snapshot = try tile.snapshot()
        var cells: [any XCUIElementSnapshot] = []
        func visit(_ node: any XCUIElementSnapshot) {
            // iOS 27 can forward the grid's ancestor identifier to its day
            // buttons; the real semantic date/value label is retained.
            if node.elementType == .button && (node.identifier.hasPrefix("stats-calendar-day-")
                || (node.identifier == "stats-calendar-summary-grid" && node.label.contains(": "))) { cells.append(node) }
            node.children.forEach(visit)
        }
        visit(snapshot)
        XCTAssertFalse(cells.isEmpty, tile.debugDescription)
        for day in cells where !day.frame.isEmpty { XCTAssertEqual(day.frame.width, day.frame.height, accuracy: 0.5) }
        XCTAssertFalse(tile.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Last 12 months")).firstMatch.exists)
        XCTAssertFalse(tile.descendants(matching: .any)["Calendar period"].exists)
    }

    private func axHeaders(_ scenario: String) throws {
        let app = axLaunch(scenario)
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let dashboard = app.scrollViews["stats-dashboard"]
        XCTAssertTrue(dashboard.waitForExistence(timeout: 15), app.debugDescription)
        let settings = try XCTUnwrap(app.buttons.matching(identifier: "open-settings").allElementsBoundByIndex.first(where: \.isHittable), app.debugDescription)
        let initial = settings.frame
        let expand = app.buttons["stats-expand-weeklyVolume"]
        axReveal(expand, in: app.scrollViews["stats-dashboard"], app: app)
        expand.tap()
        let detail = app.scrollViews["stats-detail-weeklyVolume"]
        XCTAssertTrue(detail.waitForExistence(timeout: 10), app.debugDescription)
        let filters = app.buttons["browse-filters"].firstMatch
        XCTAssertTrue(filters.isHittable)
        if UIDevice.current.userInterfaceIdiom == .phone { XCTAssertFalse(settings.isHittable) }
        filters.tap()
        let launcher = app.buttons["activity-search-open"]
        XCTAssertTrue(launcher.waitForExistence(timeout: 10), app.debugDescription)
        launcher.tap()
        let search = app.textFields["activity-name-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5), app.debugDescription)
        search.typeText("No matching activity")
        app.buttons["place-search-done"].tap()
        XCTAssertTrue(search.waitForNonExistence(timeout: 5))
        axCloseFilters(app, filters: filters, scenario: scenario)
        XCTAssertTrue(detail.staticTexts["No matching activities"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(detail.staticTexts["Calculating…"].exists)
        filters.tap()
        let reset = app.buttons["Reset Stats activity filters"]
        XCTAssertTrue(reset.waitForExistence(timeout: 5), app.debugDescription)
        reset.tap()
        axCloseFilters(app, filters: filters, scenario: scenario)
        XCTAssertTrue(detail.staticTexts["No matching activities"].waitForNonExistence(timeout: 10))
        let back = app.buttons["stats-detail-back"]
        XCTAssertTrue(back.isHittable)
        back.tap()
        XCTAssertTrue(detail.waitForNonExistence(timeout: 10))
        XCTAssertTrue(settings.isHittable, app.debugDescription)
        XCTAssertEqual(settings.frame.midX, initial.midX, accuracy: 1)
        XCTAssertEqual(settings.frame.midY, initial.midY, accuracy: 1)
        settings.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        app.buttons["Done"].tap()
        XCTAssertTrue(settings.isHittable, app.debugDescription)
    }

    private func axCloseFilters(_ app: XCUIApplication, filters: XCUIElement, scenario: String) {
        if UIDevice.current.userInterfaceIdiom == .pad && scenario != "large-text" { filters.tap() }
        else { app.buttons["filters-done"].tap() }
    }

    private func axLaunch(_ scenario: String) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--stats-ui-testing", "--stats-ui-scenario=\(scenario)",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        if scenario == "landscape" { XCUIDevice.shared.orientation = .landscapeLeft }
        return app
    }

    private func axReveal(_ element: XCUIElement, in requestedScroll: XCUIElement? = nil, app: XCUIApplication) {
        let scroll = requestedScroll ?? app.scrollViews.allElementsBoundByIndex.first(where: \.isHittable) ?? app.scrollViews.firstMatch
        var viewport = scroll.frame.intersection(app.frame)
        let bars = app.navigationBars.allElementsBoundByIndex
            + app.otherElements.matching(identifier: "browse-header").allElementsBoundByIndex
            + app.otherElements.matching(identifier: "app-toolbar").allElementsBoundByIndex
        for bar in bars where bar.isHittable && bar.frame.intersects(viewport) && bar.frame.midY < viewport.midY {
            let top = max(viewport.minY, bar.frame.maxY)
            viewport = CGRect(x: viewport.minX, y: top, width: viewport.width, height: max(0, viewport.maxY - top))
        }
        for _ in 0..<18 {
            var delta = -viewport.height * 0.6
            if element.exists {
                let frame = element.frame
                if !frame.isEmpty && viewport.insetBy(dx: -1, dy: -1).contains(frame) && element.isHittable { return }
                if !frame.isEmpty {
                    if frame.minY < viewport.minY { delta = min(viewport.height * 0.6, viewport.minY - frame.minY + 12) }
                    else { delta = -min(viewport.height * 0.6, max(24, frame.maxY - viewport.maxY + 12)) }
                }
            }
            // Tall viewports need ordinary paging to reach distant sections
            // with accessibility text. Keep precision dragging for short windows.
            if viewport.height >= 480 {
                if delta > 0 { scroll.swipeDown() } else { scroll.swipeUp() }
                continue
            }
            // A full fling can leap over a 44pt target in short landscape
            // viewports and oscillate forever. Drag only the measured gap and
            // hold at the endpoint so inertia cannot undo the reveal.
            let startY = delta < 0 ? viewport.maxY - viewport.height * 0.15 : viewport.minY + viewport.height * 0.15
            let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: viewport.midX, dy: startY))
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: delta)),
                        withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTFail("Control was not reachable in \(viewport): frame=\(element.frame), hittable=\(element.isHittable), scroll=\(scroll.frame)\n\(app.debugDescription)")
    }
}

import XCTest

@MainActor
final class FilterPanelUITests: XCTestCase {
    func testSearchUsesSystemPlaceSuggestionsAndKeepsFilters() {
        let app = launchSheet(orientation: .portrait)
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        let restingY = done.frame.minY
        let count = app.filterResultCount
        XCTAssertEqual(count.label, "3 of 3 activities")

        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons[Self.pilatus].exists, "An empty search has no place suggestions")
        field.typeText("Morning")
        app.cancelSearch()
        XCTAssertEqual(count.label, "1 of 3 activities · 1 active", "Cancel keeps the name filter")
        XCTAssertEqual(field.value as? String, "Morning", "The field shows the kept text")
        XCTAssertEqual(done.frame.minY, restingY, accuracy: 2, "Ending search restores the sheet height")

        field.buttons["Clear text"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        field.typeText("Pilatus")
        let first = app.buttons[Self.pilatus]
        let second = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000002"]
        let third = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000003"]
        XCTAssertTrue(first.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(second.exists && third.exists)
        XCTAssertLessThan(first.frame.maxY, second.frame.minY + 1, "Suggestions form a vertical list")
        XCTAssertLessThanOrEqual(third.frame.maxY, app.keyboards.firstMatch.frame.minY, "Suggestions sit above the keyboard")
        let suggestions = XCTAttachment(screenshot: app.screenshot())
        suggestions.name = "Place search suggestions"; suggestions.lifetime = .keepAlways; add(suggestions)

        first.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "Choosing a place ends search")
        XCTAssertTrue(app.buttons["Place: Pilátus. View details"].waitForExistence(timeout: 5))
        XCTAssertTrue(field.buttons["Pilátus"].exists || field.staticTexts["Pilátus"].exists || (field.value as? String ?? "").contains("Pilátus"),
                      "The place is a token in the search field: \(field.debugDescription)")
        XCTAssertEqual(count.label, "2 of 3 activities · 1 active")
        XCTAssertEqual(done.frame.minY, restingY, accuracy: 2, "Choosing a place restores the sheet height")
        let selected = XCTAttachment(screenshot: app.screenshot())
        selected.name = "Selected place token"; selected.lifetime = .keepAlways; add(selected)

        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        field.typeText("Evening\n")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "Search hides the keyboard")
        app.cancelSearch()
        let kept = field.value as? String ?? ""
        XCTAssertTrue(kept.hasPrefix("Pilátus") && kept.hasSuffix("Evening"), "The field keeps the token and text: \(kept)")
        XCTAssertEqual(count.label, "1 of 3 activities · 2 active", "Place and name filters combine")

        field.buttons["Clear text"].tap()
        app.cancelSearch()
        XCTAssertTrue(app.buttons["Place: Pilátus. View details"].waitForNonExistence(timeout: 5))
        XCTAssertEqual(count.label, "3 of 3 activities", "Clearing the field removes the token and text")
    }

    func testLandscapeFiltersUseTheStandardSheetAndSearchAboveTheKeyboard() {
        let app = launchSheet(orientation: .landscapeLeft)
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let close = app.buttons["filters-done"]
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertGreaterThan(close.frame.minX, app.frame.width * 0.6, "Filters use the full-height standard sheet")
        let sheet = XCTAttachment(screenshot: app.screenshot())
        sheet.name = "Landscape filter sheet"; sheet.lifetime = .keepAlways; add(sheet)

        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        field.typeText("Pilatus")
        let first = app.buttons[Self.pilatus]
        XCTAssertTrue(first.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertLessThan(field.frame.maxY, keyboard.frame.minY)
        XCTAssertLessThanOrEqual(first.frame.maxY, keyboard.frame.minY, "The first suggestion stays above the keyboard")
        XCTAssertTrue(first.isHittable)
        let search = XCTAttachment(screenshot: app.screenshot())
        search.name = "Landscape search suggestions"; search.lifetime = .keepAlways; add(search)
        first.tap()
        let place = app.buttons["Place: Pilátus. View details"]
        XCTAssertTrue(place.waitForExistence(timeout: 5))
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        app.buttons["browse-filters"].firstMatch.tap()
        XCTAssertTrue(place.waitForExistence(timeout: 5), "Closing preserves the place filter")
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        XCUIDevice.shared.orientation = .portrait
        app.buttons["browse-filters"].firstMatch.tap()
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(close.frame.minY, app.frame.height * 0.35, "Portrait still opens at half height")
    }

    func testExpandedFilterSheetIsRestoredAfterSearch() {
        let app = launchSheet(orientation: .portrait)
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), app.debugDescription)
        let grabber = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.midX, dy: done.frame.minY - 10))
        grabber.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)))
        XCTAssertLessThan(done.frame.minY, app.frame.height * 0.2)
        let expandedY = done.frame.minY
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        field.typeText("Morning\n")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        app.cancelSearch()
        XCTAssertEqual(done.frame.minY, expandedY, accuracy: 2)
        XCTAssertEqual(field.value as? String, "Morning")
    }

    func testCompactSheetScrollsToLastFilterAndKeepsResetInHeader() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--stats-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }

        let filters = app.buttons["browse-filters"].firstMatch
        XCTAssertTrue(filters.waitForExistence(timeout: 15), app.debugDescription)
        filters.tap()
        let count = app.filterResultCount
        let reset = app.buttons["filter-reset"]
        let done = app.buttons["filters-done"]
        XCTAssertTrue(count.waitForExistence(timeout: 10), app.debugDescription)
        let initialCount = count.label
        let sheetY = done.frame.minY
        XCTAssertGreaterThan(sheetY, app.frame.height * 0.4, "Filters should open compact")
        XCTAssertEqual(count.frame.midY, reset.frame.midY, accuracy: 20, "Count and Reset share the navigation bar")
        XCTAssertEqual(count.frame.midY, done.frame.midY, accuracy: 20, "Close shares the navigation bar")
        let initial = XCTAttachment(screenshot: app.screenshot())
        initial.name = "Compact filter header"
        initial.lifetime = .keepAlways
        add(initial)

        app.buttons["Deselect all sports"].tap()
        XCTAssertTrue(count.label.hasPrefix("0 of ") && count.label.hasSuffix(" · 1 active"), count.label)
        let headerY = count.frame.minY

        let form = app.collectionViews.firstMatch
        XCTAssertTrue(form.exists, app.debugDescription)
        let lastFooter = app.staticTexts["Any includes unknown values. Yes and No match only recorded true or false values."]
        for _ in 0..<12 {
            if lastFooter.exists && lastFooter.isHittable && form.frame.contains(lastFooter.frame) { break }
            // Drag inside the form; the grabber remains available to resize.
            form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
                .press(forDuration: 0.05, thenDragTo: form.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)))
        }
        XCTAssertTrue(lastFooter.exists && lastFooter.isHittable && form.frame.contains(lastFooter.frame), app.debugDescription)
        XCTAssertEqual(done.frame.minY, sheetY, accuracy: 1, "Scrolling must keep the sheet compact")
        XCTAssertEqual(count.frame.minY, headerY, accuracy: 1, "The result count stays pinned")
        XCTAssertTrue(reset.isEnabled, "Reset stays enabled at the bottom of the form")
        let scrolled = XCTAttachment(screenshot: app.screenshot())
        scrolled.name = "Compact filters scrolled to the bottom"
        scrolled.lifetime = .keepAlways
        add(scrolled)

        reset.tap()
        XCTAssertEqual(count.label, initialCount, "Reset updates the pinned count")
        done.tap()
        XCTAssertTrue(done.waitForNonExistence(timeout: 5))
    }

    private static let pilatus = "place-suggestion-00000000-0000-4000-8000-000000000001"

    private func launchSheet(orientation: UIDeviceOrientation) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = orientation
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing", "--place-search-ui-testing", "--place-search-sheet-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }
}

extension XCUIApplication {
    /// The filter sheet's subtitle: "N of M activities", plus active filters.
    var filterResultCount: XCUIElement {
        navigationBars.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", " activities")).firstMatch
    }

    /// Phone filter sheets search in their navigation bar; the iPad sidebar
    /// and rail open the same system search from a launcher row, whose sheet
    /// Search closes. Leaves search with the text applied either way.
    func searchActivities(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let launcher = buttons["activity-search-open"]
        let field = searchFields.firstMatch
        let deadline = Date().addingTimeInterval(10)
        while !launcher.exists && !field.exists && Date() < deadline { _ = field.waitForExistence(timeout: 0.5) }
        let inSheet = launcher.exists
        if inSheet { launcher.tap() } else { field.tap() }
        XCTAssertTrue(field.waitForExistence(timeout: 5), debugDescription, file: file, line: line)
        field.typeText(text + "\n")
        if !inSheet { cancelSearch(file: file, line: line) }
    }

    /// System search's Cancel, which keeps the filter it was editing.
    func cancelSearch(file: StaticString = #filePath, line: UInt = #line) {
        let cancel = navigationBars.buttons.matching(NSPredicate(format: "label IN %@", ["Cancel", "Close"])).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 5), debugDescription, file: file, line: line)
        // A tap during the sheet's growth to full height can miss.
        for _ in 0..<3 where cancel.exists {
            cancel.tap()
            _ = cancel.waitForNonExistence(timeout: 2)
        }
        XCTAssertFalse(cancel.exists, debugDescription, file: file, line: line)
        XCTAssertTrue(keyboards.firstMatch.waitForNonExistence(timeout: 5), file: file, line: line)
    }
}

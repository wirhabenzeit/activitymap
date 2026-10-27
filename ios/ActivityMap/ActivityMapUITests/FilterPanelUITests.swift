import XCTest

@MainActor
final class FilterPanelUITests: XCTestCase {
    func testSearchRowRidesOnTheKeyboardAndKeepsFilters() {
        let app = launchSheet(orientation: .portrait)
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        let field = app.activitySearchField
        XCTAssertTrue(field.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        let restingY = done.frame.minY
        let count = app.filterResultCount
        XCTAssertEqual(count.label, "3 of 3 activities")

        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons[Self.pilatus].exists, "An empty search has no place matches")
        field.typeText("Morning")
        // A short sheet rides on the keyboard; the filtered list stays visible above it.
        let row = app.staticTexts["Morning ridge"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertLessThan(row.frame.maxY, field.frame.minY, "The list shows above the search sheet")
        XCTAssertFalse(app.staticTexts["Evening outing"].exists, "The list filters while typing")
        XCTAssertLessThan(field.frame.maxY, keyboard.frame.minY)
        let typing = XCTAttachment(screenshot: app.screenshot())
        typing.name = "Search above the keyboard"; typing.lifetime = .keepAlways; add(typing)
        field.typeText("\n")
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), "Search hides the keyboard")
        XCTAssertEqual(count.label, "1 of 3 activities · 1 active", "The name filter stays")
        XCTAssertEqual(field.value as? String, "Morning", "The field shows the kept text")
        XCTAssertEqual(done.frame.minY, restingY, accuracy: 2, "The sheet returns with the keyboard")

        app.clearActivitySearch()
        XCTAssertEqual(count.label, "3 of 3 activities")
        field.tap()
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        field.typeText("Pilatus")
        let first = app.buttons[Self.pilatus]
        let second = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000002"]
        XCTAssertTrue(first.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(second.exists)
        XCTAssertEqual(first.frame.midY, second.frame.midY, accuracy: 2, "Place matches share one row")
        XCTAssertLessThanOrEqual(first.frame.maxY, keyboard.frame.minY, "Place matches sit above the keyboard")
        let matches = XCTAttachment(screenshot: app.screenshot())
        matches.name = "Place matches"; matches.lifetime = .keepAlways; add(matches)

        first.tap()
        let place = app.buttons["Place: Pilátus. View details"]
        XCTAssertTrue(place.waitForExistence(timeout: 5))
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), "Choosing a place hides the keyboard")
        XCTAssertEqual(done.frame.minY, restingY, accuracy: 2, "The sheet returns with the keyboard")
        XCTAssertEqual(place.frame.midY, field.frame.midY, accuracy: 4, "The place is a pill in the field")
        XCTAssertEqual(field.value as? String, "Activity name", "Choosing a place clears the text")
        XCTAssertEqual(count.label, "2 of 3 activities · 1 active")
        let selected = XCTAttachment(screenshot: app.screenshot())
        selected.name = "Selected place"; selected.lifetime = .keepAlways; add(selected)

        field.tap()
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        field.typeText("Evening\n")
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5))
        XCTAssertEqual(done.frame.minY, restingY, accuracy: 2, "The sheet returns with the keyboard")
        XCTAssertEqual(field.value as? String, "Evening")
        XCTAssertEqual(count.label, "1 of 3 activities · 2 active", "Place and name filters combine")

        app.buttons["remove-place-filter"].tap()
        XCTAssertTrue(place.waitForNonExistence(timeout: 5))
        XCTAssertEqual(count.label, "2 of 3 activities · 1 active", "Removing the place keeps the name filter")
        app.clearActivitySearch()
        XCTAssertEqual(count.label, "3 of 3 activities", "Clearing the field removes the text")
    }

    func testLandscapeFiltersUseTheStandardSheetAndSearchAboveTheKeyboard() {
        let app = launchSheet(orientation: .landscapeLeft)
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let close = app.buttons["filters-done"]
        let field = app.activitySearchField
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
        XCTAssertLessThanOrEqual(first.frame.maxY, keyboard.frame.minY, "Place matches stay above the keyboard")
        XCTAssertTrue(first.isHittable)
        let search = XCTAttachment(screenshot: app.screenshot())
        search.name = "Landscape place matches"; search.lifetime = .keepAlways; add(search)
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

    func testFilterSheetKeepsOneHeightWhileSearching() {
        let app = launchSheet(orientation: .portrait)
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        let field = app.activitySearchField
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), app.debugDescription)
        let restingY = done.frame.minY
        XCTAssertGreaterThan(restingY, app.frame.height * 0.5, "The sheet leaves the screen above it visible")
        func waitForSheet(_ settled: @escaping () -> Bool) {
            let deadline = Date().addingTimeInterval(3)
            while done.exists, !settled(), Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
        }

        // Dragging up keeps the one height.
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.midX, dy: restingY - 10))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)))
        waitForSheet { abs(done.frame.minY - restingY) < 2 }
        XCTAssertEqual(done.frame.minY, restingY, accuracy: 2, "The sheet has one height")

        // The keyboard lifts the sheet without resizing it, and it returns afterwards.
        let height = app.frame.maxY - restingY
        field.tap()
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        waitForSheet { abs(keyboard.frame.minY - done.frame.minY - height) < 20 }
        XCTAssertEqual(keyboard.frame.minY - done.frame.minY, height, accuracy: 60, "The keyboard lifts the whole sheet")
        field.typeText("Morning\n")
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5))
        waitForSheet { abs(done.frame.minY - restingY) < 2 }
        XCTAssertEqual(done.frame.minY, restingY, accuracy: 2, "The sheet returns to its height")
        XCTAssertEqual(field.value as? String, "Morning")
    }

    func testListBehindTheFilterSheetStaysUsable() {
        let app = launchSheet(orientation: .portrait)
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10), app.debugDescription)
        let row = app.staticTexts["Morning ridge"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(row.isHittable, "The list is not covered by a modal backdrop")

        // Opening an activity behind the sheet closes it, so the detail has the screen.
        row.tap()
        XCTAssertTrue(done.waitForNonExistence(timeout: 5), "Opening an activity closes the filters")
        XCTAssertTrue(app.staticTexts["Elevation by distance is unavailable."].waitForExistence(timeout: 5), app.debugDescription)
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

    func testChosenPlaceFliesTheMapAboveTheSheetWithAPin() {
        let app = launchSheet(orientation: .portrait, map: true)
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        let field = app.activitySearchField
        XCTAssertTrue(field.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        let pin = app.otherElements["place-filter-pin"]
        XCTAssertFalse(pin.exists, "Only a place filter has a pin")

        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        field.typeText("Pilatus")
        let first = app.buttons[Self.pilatus]
        XCTAssertTrue(first.waitForExistence(timeout: 5), app.debugDescription)
        first.tap()
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), "Choosing a place hides the keyboard")
        XCTAssertTrue(pin.waitForExistence(timeout: 5), app.debugDescription)
        // The camera flies there: the pin settles centred above the sheet.
        let window = app.windows.firstMatch.frame
        let settled = NSPredicate { _, _ in
            abs(pin.frame.midX - window.midX) < 8 && pin.frame.maxY < done.frame.minY - 24 && pin.frame.minY > window.minY + 60
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 10), .completed,
                       "\(pin.frame) in \(window), sheet at \(done.frame.minY)")
        let flown = XCTAttachment(screenshot: app.screenshot())
        flown.name = "Place pin above the sheet"; flown.lifetime = .keepAlways; add(flown)

        // The map behind the sheet pans while the filters stay open.
        let before = pin.frame
        let map = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
        // Slow, with a hold at the end, so the map does not fling on.
        map.press(forDuration: 0.05, thenDragTo: map.withOffset(CGVector(dx: -80, dy: -40)),
                  withVelocity: .slow, thenHoldForDuration: 0.3)
        XCTAssertTrue(done.exists, "Panning keeps the filters")
        let panned = NSPredicate { _, _ in
            pin.exists && pin.frame.midX < before.midX - 40 && pin.frame.midY < before.midY - 20
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: panned, object: nil)], timeout: 5), .completed,
                       "The map pans behind the sheet: \(before) → \(pin.frame)")

        app.buttons["remove-place-filter"].tap()
        XCTAssertTrue(pin.waitForNonExistence(timeout: 5), "Removing the place removes its pin")
    }

    private func launchSheet(orientation: UIDeviceOrientation, map: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = orientation
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing", "--place-search-ui-testing", "--place-search-sheet-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            + (map ? ["--place-search-map-ui-testing"] : [])
        app.launch()
        return app
    }
}

extension XCUIApplication {
    /// The filter sheet's subtitle: "N of M activities", plus active filters.
    var filterResultCount: XCUIElement {
        navigationBars.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", " activities")).firstMatch
    }

    /// The search row of the filter form, or of the iPad search sheet.
    var activitySearchField: XCUIElement { textFields["activity-search"] }

    /// Phone filter sheets search in a row of the form; the iPad sidebar and
    /// rail open the same row in a sheet, which Search closes. Leaves the
    /// text applied and the keyboard hidden either way.
    func searchActivities(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let launcher = buttons["activity-search-open"]
        let field = activitySearchField
        let deadline = Date().addingTimeInterval(10)
        while !launcher.exists && !field.exists && Date() < deadline { _ = field.waitForExistence(timeout: 0.5) }
        if launcher.exists { launcher.tap() } else { field.tap() }
        XCTAssertTrue(field.waitForExistence(timeout: 5), debugDescription, file: file, line: line)
        field.typeText(text + "\n")
        XCTAssertTrue(keyboards.firstMatch.waitForNonExistence(timeout: 5), file: file, line: line)
    }

    func clearActivitySearch(file: StaticString = #filePath, line: UInt = #line) {
        let clear = buttons["clear-activity-search"]
        XCTAssertTrue(clear.waitForExistence(timeout: 5), debugDescription, file: file, line: line)
        clear.tap()
    }
}

import XCTest

@MainActor
final class FilterPanelUITests: XCTestCase {
    func testListSearchNarrowsRowsAndBecomesAFilterChip() {
        let app = launchSheet(orientation: .portrait)
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10), app.debugDescription)
        let count = app.filterResultCount
        XCTAssertEqual(count.label, "3 of 3 activities")
        XCTAssertFalse(app.otherElements["active-text-filters"].exists, "Filters has no search field")

        // Search closes the filter sheet and narrows the list as you type.
        app.openHeaderSearch()
        XCTAssertTrue(done.waitForNonExistence(timeout: 5), "Search closes the filter sheet")
        app.typeText("Morning")
        let narrowed = app.staticTexts["list-search-count"]
        XCTAssertTrue(narrowed.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(narrowed.label, "1 of 3 match “Morning”")
        XCTAssertTrue(app.staticTexts["Morning ridge"].firstMatch.exists)
        XCTAssertFalse(app.staticTexts["Evening outing"].exists, "The rows narrow while typing")
        let typing = XCTAttachment(screenshot: app.screenshot())
        typing.name = "List narrowed by header search"; typing.lifetime = .keepAlways; add(typing)

        // A visited place matches too: every fixture activity passed Pilátus.
        app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 7) + "pilatus")
        XCTAssertEqual(narrowed.label, "3 of 3 match “pilatus”", "Places and accents match")

        app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 7) + "Morning")
        app.buttons["list-search-apply-filter"].tap()
        XCTAssertTrue(app.textFields["header-search-field"].waitForNonExistence(timeout: 5), "Filter closes search")
        XCTAssertFalse(app.staticTexts["Evening outing"].exists, "The narrowing is now a filter")

        app.buttons["browse-filters"].firstMatch.tap()
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        XCTAssertEqual(count.label, "1 of 3 activities · 1 active")
        let chip = app.buttons["Remove text filter: Morning"]
        XCTAssertTrue(chip.waitForExistence(timeout: 5), app.debugDescription)
        chip.tap()
        XCTAssertEqual(count.label, "3 of 3 activities", "The chip removes the text filter")
    }

    func testLandscapeFiltersUseTheStandardSheet() {
        let app = launchSheet(orientation: .landscapeLeft)
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let close = app.buttons["filters-done"]
        XCTAssertTrue(close.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertGreaterThan(close.frame.minX, app.frame.width * 0.6, "Filters use the full-height standard sheet")
        let sheet = XCTAttachment(screenshot: app.screenshot())
        sheet.name = "Landscape filter sheet"; sheet.lifetime = .keepAlways; add(sheet)
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        XCUIDevice.shared.orientation = .portrait
        app.buttons["browse-filters"].firstMatch.tap()
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(close.frame.minY, app.frame.height * 0.35, "Portrait still opens at half height")
    }

    func testFilterSheetKeepsOneHeight() {
        let app = launchSheet(orientation: .portrait)
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        XCTAssertTrue(done.waitForExistence(timeout: 10), app.debugDescription)
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

    func testListSearchSurvivesADetailButEndsWithShowOnMap() {
        let app = launchSheet(orientation: .portrait, header: true)
        defer { app.terminate() }
        let menu = app.buttons.matching(identifier: "browse-destination-menu").allElementsBoundByIndex.first { $0.frame.width > 0 }
        XCTAssertNotNil(menu, app.debugDescription)
        menu?.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let listItem = app.buttons["browse-destination-menu-list"].firstMatch
        XCTAssertTrue(listItem.waitForExistence(timeout: 5), app.debugDescription)
        listItem.tap()

        app.openHeaderSearch()
        app.typeText("Morning")
        let narrowed = app.staticTexts["list-search-count"]
        XCTAssertTrue(narrowed.waitForExistence(timeout: 5), app.debugDescription)

        // A detail and Back keep the search, without the keyboard.
        let row = app.buttons["activity-list-row-1"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        let back = app.buttons["list-detail-back"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 10), app.debugDescription)
        back.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(narrowed.waitForExistence(timeout: 10), "Back returns to the narrowed list")
        XCTAssertEqual(narrowed.label, "1 of 3 match “Morning”")
        XCTAssertTrue(app.textFields["header-search-field"].exists)
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Back does not bring the keyboard back")

        // Show on map acts on the result: search ends and the map is clear.
        row.press(forDuration: 1)
        let showOnMap = app.buttons["Show on map"].firstMatch
        XCTAssertTrue(showOnMap.waitForExistence(timeout: 5), app.debugDescription)
        showOnMap.tap()
        XCTAssertTrue(app.textFields["header-search-field"].waitForNonExistence(timeout: 5), "Leaving the List ends search")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label == 'View: Map'")).firstMatch.waitForExistence(timeout: 5),
                      app.debugDescription)
        let shown = XCTAttachment(screenshot: app.screenshot())
        shown.name = "Show on map ends search"; shown.lifetime = .keepAlways; add(shown)
    }

    private static let pilatus = "header-search-place-00000000-0000-4000-8000-000000000001"

    func testHeaderSearchSelectsAPlaceAndFiltersOnlyOnRequest() {
        let app = launchSheet(orientation: .portrait, header: true)
        defer { app.terminate() }
        let pin = app.otherElements["place-filter-pin"]
        app.openHeaderSearch()
        app.typeText("Pil")
        let place = app.buttons[Self.pilatus]
        XCTAssertTrue(place.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.buttons["header-search-activity-1"].exists, "Activities that visited the place match")
        let panel = XCTAttachment(screenshot: app.screenshot())
        panel.name = "Header search results"; panel.lifetime = .keepAlways; add(panel)

        // Picking a place selects its activities and pins it; the filters stay.
        place.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertTrue(pin.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.buttons["browse-filters"].firstMatch.label.contains("active"), "Picking does not filter")
        // The selected routes open the results sheet (its rows are not exposed
        // to UI tests in this fixture; the rendered tests cover them).
        XCTAssertTrue(app.buttons["Sheet Grabber"].waitForExistence(timeout: 10), "The place's routes are selected")
        let picked = XCTAttachment(screenshot: app.screenshot())
        picked.name = "Place picked from search"; picked.lifetime = .keepAlways; add(picked)

        // Long-press offers the place filter instead.
        filterToPilatus(app)
        app.buttons["browse-filters"].firstMatch.tap()
        let count = app.filterResultCount
        XCTAssertTrue(count.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(count.label, "2 of 3 activities · 1 active")
        XCTAssertTrue(app.buttons["Place: Pilátus. View details"].exists)
    }

    // Keep selection/context-menu and filter editing in separate launches.
    // The former combined case reached XCTest's two-minute deadline during
    // teardown on slow hosted runners even when every assertion passed.
    func testHeaderSearchCombinesPlaceAndTextFiltersAndClearsThemIndependently() {
        let app = launchSheet(orientation: .portrait, header: true)
        defer { app.terminate() }
        filterToPilatus(app)

        // The last row applies the text filter and offers to clear it.
        app.openHeaderSearch()
        app.typeText("Morning")
        let apply = app.buttons["header-search-apply-filter"]
        XCTAssertTrue(apply.waitForExistence(timeout: 5), app.debugDescription)
        apply.tap()
        app.buttons["browse-filters"].firstMatch.tap()
        let count = app.filterResultCount
        XCTAssertTrue(count.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(count.label, "1 of 3 activities · 2 active", "Place and text filters combine")
        XCTAssertTrue(app.buttons["Place: Pilátus. View details"].exists, "The place filter shows as a chip")
        app.buttons["remove-place-filter"].tap()
        XCTAssertEqual(count.label, "1 of 3 activities · 1 active", "Removing the place keeps the text filter")
        app.buttons["filters-done"].tap()

        app.openHeaderSearch()
        app.typeText("Morning")
        let clear = app.buttons["header-search-clear-filter"]
        XCTAssertTrue(clear.waitForExistence(timeout: 5), app.debugDescription)
        clear.tap()
        app.buttons["browse-filters"].firstMatch.tap()
        XCTAssertTrue(app.filterResultCount.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(app.filterResultCount.label, "3 of 3 activities", "Search clears the text filter")
    }

    private func filterToPilatus(_ app: XCUIApplication) {
        app.openHeaderSearch()
        app.typeText("Pil")
        let place = app.buttons[Self.pilatus]
        XCTAssertTrue(place.waitForExistence(timeout: 5), app.debugDescription)
        place.press(forDuration: 1.2)
        let filterToPlace = app.buttons["Filter to this place"]
        XCTAssertTrue(filterToPlace.waitForExistence(timeout: 5), app.debugDescription)
        filterToPlace.tap()
    }

    private func launchSheet(orientation: UIDeviceOrientation, header: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = orientation
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing", "--place-search-ui-testing", "--place-search-sheet-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            + (header ? ["--place-search-header-ui-testing"] : [])
        app.launch()
        return app
    }
}

extension XCUIApplication {
    /// The filter sheet's subtitle: "N of M activities", plus active filters.
    var filterResultCount: XCUIElement {
        navigationBars.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", " activities")).firstMatch
    }

    /// Opens header search from the browsing header, focused.
    func openHeaderSearch(file: StaticString = #filePath, line: UInt = #line) {
        let deadline = Date().addingTimeInterval(10)
        var button: XCUIElement?
        while button == nil && Date() < deadline {
            button = buttons.matching(identifier: "browse-search").allElementsBoundByIndex.first { $0.exists && $0.frame.width > 0 }
            if button == nil { RunLoop.current.run(until: Date().addingTimeInterval(0.3)) }
        }
        guard let button else { return XCTFail("No search button: \(debugDescription)", file: file, line: line) }
        // Header controls report not hittable while their transitions settle.
        button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(textFields["header-search-field"].waitForExistence(timeout: 5), debugDescription, file: file, line: line)
        XCTAssertTrue(keyboards.firstMatch.waitForExistence(timeout: 5), file: file, line: line)
    }

    /// Applies a text filter through header search from Map or Stats.
    func applyTextFilter(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        openHeaderSearch(file: file, line: line)
        typeText(text + "\n")
        XCTAssertTrue(textFields["header-search-field"].waitForNonExistence(timeout: 5), file: file, line: line)
    }
}

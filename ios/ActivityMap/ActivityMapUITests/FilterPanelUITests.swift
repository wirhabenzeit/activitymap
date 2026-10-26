import Vision
import XCTest

@MainActor
final class FilterPanelUITests: XCTestCase {
    func testSearchUsesKeyboardPlaceHintsAndRestoresFilterHeight() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing", "--place-search-ui-testing", "--place-search-sheet-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        let launcher = app.buttons["activity-search-open"]
        XCTAssertTrue(launcher.waitForExistence(timeout: 10), app.debugDescription)
        let restingY = done.frame.minY
        launcher.tap()
        let field = app.textFields["activity-name-search"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Search focuses automatically")
        XCTAssertFalse(app.scrollViews["place-search-suggestions"].exists, "An empty search has no keyboard hints")
        field.typeText("Morning")
        var background = try backgroundText(in: app, above: field)
        XCTAssertTrue(background.contains("morning ridge"), background)
        XCTAssertFalse(background.contains("evening outing"), "Nonmatching rows disappear before submitting: \(background)")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        let live = XCTAttachment(screenshot: app.screenshot())
        live.name = "Background list filters while typing"; live.lifetime = .keepAlways; add(live)
        app.buttons["Clear Search"].tap()
        background = try backgroundText(in: app, above: field)
        XCTAssertTrue(background.contains("morning ridge") && background.contains("evening outing"),
                      "Clearing restores rows while search stays open: \(background)")
        field.typeText("Evening")
        background = try backgroundText(in: app, above: field)
        XCTAssertTrue(background.contains("evening outing"), background)
        XCTAssertFalse(background.contains("morning ridge"), background)
        app.buttons["Clear Search"].tap()
        field.typeText("Pilatus")
        let first = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000001"]
        let second = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000002"]
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        XCTAssertTrue(second.exists)
        XCTAssertEqual(first.frame.midY, second.frame.midY, accuracy: 2, "Suggestions stay in one horizontal row")
        XCTAssertGreaterThan(field.frame.minY, app.frame.height * 0.35, "Search uses a small separate sheet")
        let firstKey = app.keyboards.keys["q"]
        XCTAssertTrue(firstKey.exists)
        XCTAssertLessThanOrEqual(first.frame.maxY, firstKey.frame.minY)
        XCTAssertLessThan(firstKey.frame.minY - first.frame.maxY, 44,
                          "Place hints sit directly above the keys, without a second predictive-text row")
        let inputY = field.frame.minY
        field.typeText("zzzz")
        XCTAssertTrue(app.staticTexts["No places found."].waitForExistence(timeout: 5))
        XCTAssertEqual(field.frame.minY, inputY, accuracy: 1, "Changing hints does not resize the search sheet")
        app.buttons["Clear Search"].tap()
        XCTAssertTrue(app.scrollViews["place-search-suggestions"].waitForNonExistence(timeout: 5))
        field.typeText("Pilatus")
        let hints = app.scrollViews["place-search-suggestions"]
        hints.swipeLeft()
        let third = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000003"]
        XCTAssertTrue(third.isHittable, "More hints are available by scrolling horizontally")
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Scrolling hints keeps the keyboard open")
        hints.swipeRight()
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Keyboard attached place hints"; capture.lifetime = .keepAlways; add(capture)
        first.tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertEqual(done.frame.minY, restingY, accuracy: 2, "Selecting a hint returns to the original filter height")
        XCTAssertTrue(app.buttons["Place: Pilátus. View details"].exists)
        XCTAssertEqual(app.staticTexts["filter-result-count"].label, "2 of 3 activities")

        let place = app.buttons["Place: Pilátus. View details"]
        let remove = app.buttons["Remove place filter: Pilátus"]
        XCTAssertEqual(place.frame.midY, launcher.frame.midY, accuracy: 2, "The place token shares the search row")
        XCTAssertEqual(remove.frame.midY, launcher.frame.midY, accuracy: 2)
        XCTAssertTrue(remove.isHittable)
        let selected = XCTAttachment(screenshot: app.screenshot())
        selected.name = "Selected place inside search field"; selected.lifetime = .keepAlways; add(selected)

        launcher.tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertFalse(app.scrollViews["place-search-suggestions"].exists)
        field.typeText("Pilatus")
        let longHints = app.scrollViews["place-search-suggestions"]
        longHints.swipeLeft()
        third.tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 5))
        let longName = "Pilatus West with a very long mountain name"
        let longPlace = app.buttons["Place: \(longName). View details"]
        let longRemove = app.buttons["Remove place filter: \(longName)"]
        let mainField = app.otherElements["activity-search-field"]
        XCTAssertTrue(longPlace.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(longPlace.frame.maxX, mainField.frame.maxX, "A long place stays within the field")
        XCTAssertEqual(longPlace.frame.midY, launcher.frame.midY, accuracy: 2)
        XCTAssertTrue(longRemove.isHittable)
        let longCapture = XCTAttachment(screenshot: app.screenshot())
        longCapture.name = "Long place token stays inside the field"; longCapture.lifetime = .keepAlways; add(longCapture)
        longRemove.tap()
        XCTAssertTrue(longPlace.waitForNonExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["filter-result-count"].label, "3 of 3 activities")
    }

    func testLandscapeFiltersSlideOverAndSearchStaysAboveKeyboard() {
        landscapeSearch(dark: false)
    }

    func testDarkLandscapeKeyboardHintsHaveAContinuousSurface() {
        landscapeSearch(dark: true)
    }

    private func landscapeSearch(dark: Bool) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing", "--place-search-ui-testing", "--place-search-sheet-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if dark { app.launchArguments.append("--place-search-dark-ui-testing") }
        app.launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let launcher = app.buttons["activity-search-open"]
        let close = app.buttons["filters-done"]
        XCTAssertTrue(launcher.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertLessThan(close.frame.maxX, app.frame.width * 0.6, "Filters occupy a panel on the left")
        let drawer = XCTAttachment(screenshot: app.screenshot())
        drawer.name = "Landscape filter slide-over"; drawer.lifetime = .keepAlways; add(drawer)
        launcher.tap()
        let field = app.textFields["activity-name-search"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let firstKey = app.keyboards.keys["q"]
        XCTAssertTrue(firstKey.exists)
        XCTAssertLessThan(firstKey.frame.minY - field.frame.maxY, 60, "The field sits just above the keyboard")
        XCTAssertFalse(app.scrollViews["place-search-suggestions"].exists)
        field.typeText("Pilatus")
        let hint = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000001"]
        XCTAssertTrue(hint.waitForExistence(timeout: 5))
        let hints = app.scrollViews["place-search-suggestions"]
        XCTAssertGreaterThanOrEqual(hints.frame.minX, app.keyboards.firstMatch.frame.minX)
        XCTAssertLessThanOrEqual(hints.frame.maxX, app.keyboards.firstMatch.frame.maxX)
        XCTAssertLessThan(firstKey.frame.minY - hint.frame.maxY, 44)
        XCTAssertLessThan(hint.frame.minY - field.frame.maxY, 60, "No blank full-screen search area")
        let search = XCTAttachment(screenshot: app.screenshot())
        search.name = "Landscape compact search and keyboard hints"; search.lifetime = .keepAlways; add(search)
        hint.tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Place: Pilátus. View details"].waitForExistence(timeout: 5))
        XCTAssertLessThan(close.frame.maxX, app.frame.width * 0.6)
        close.tap()
        XCTAssertTrue(launcher.waitForNonExistence(timeout: 5))
        app.buttons["browse-filters"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Place: Pilátus. View details"].waitForExistence(timeout: 5), "Closing preserves the place filter")
        close.tap()
        XCUIDevice.shared.orientation = .portrait
        app.buttons["browse-filters"].firstMatch.tap()
        XCTAssertTrue(launcher.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(close.frame.minY, app.frame.height * 0.35, "Portrait still uses its compact bottom sheet")
    }

    func testExpandedFilterSheetIsRestoredAfterSearch() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing", "--place-search-ui-testing", "--place-search-sheet-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        let done = app.buttons["filters-done"]
        let launcher = app.buttons["activity-search-open"]
        XCTAssertTrue(launcher.waitForExistence(timeout: 10), app.debugDescription)
        let grabber = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.midX, dy: done.frame.minY - 10))
        grabber.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)))
        XCTAssertLessThan(done.frame.minY, app.frame.height * 0.2)
        let expandedY = done.frame.minY
        launcher.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.keyboards.buttons["Search"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["place-search-done"].waitForNonExistence(timeout: 5))
        XCTAssertEqual(done.frame.minY, expandedY, accuracy: 2)
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
        let count = app.staticTexts["filter-result-count"]
        let reset = app.buttons["filter-reset"]
        let done = app.buttons["filters-done"]
        XCTAssertTrue(count.waitForExistence(timeout: 10), app.debugDescription)
        let initialCount = count.label
        let sheetY = done.frame.minY
        XCTAssertGreaterThan(sheetY, app.frame.height * 0.4, "Filters should open compact")
        XCTAssertEqual(count.frame.midY, reset.frame.midY, accuracy: 2, "Count and Reset share one row")
        XCTAssertEqual(count.frame.midY, done.frame.midY, accuracy: 2, "Dismiss shares the count row")
        let initial = XCTAttachment(screenshot: app.screenshot())
        initial.name = "Compact filter header"
        initial.lifetime = .keepAlways
        add(initial)

        app.buttons["Deselect all sports"].tap()
        XCTAssertTrue(count.label.hasPrefix("0 of "), count.label)
        XCTAssertEqual(count.value as? String, "1 active filters")
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
        XCTAssertEqual(count.value as? String, "0 active filters")
        done.tap()
        XCTAssertTrue(done.waitForNonExistence(timeout: 5))
    }

    // The search sheet owns accessibility focus; inspect the rendered list
    // behind it, excluding the text input so its query cannot satisfy the check.
    private func backgroundText(in app: XCUIApplication, above field: XCUIElement) throws -> String {
        let image = try XCTUnwrap(app.screenshot().image.cgImage)
        let height = (field.frame.minY - app.frame.minY) / app.frame.height
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        request.regionOfInterest = CGRect(x: 0, y: 1 - height, width: 1, height: height)
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: " ").lowercased()
    }

}

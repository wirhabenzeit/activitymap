import XCTest

@MainActor final class PlaceSearchUITests: XCTestCase {
    func testPlaceAutocompleteFilteringDetailsAndStatsHistory() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing", "--place-search-ui-testing"]
        app.launch()
        defer { app.terminate() }
        let search = app.activitySearchField
        XCTAssertTrue(search.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.staticTexts["place-search-visible"].waitForExistence(timeout: 5))
        app.buttons["2026 only"].tap()
        app.searchActivities("Pilatus")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["place-search-visible"].label, "Visible: ", "Typing remains name search")
        search.tap()
        let first = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000001"]
        let second = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000002"]
        XCTAssertTrue(first.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(second.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(first.frame.midY, second.frame.midY, accuracy: 2, "Place matches share one row")
        first.tap()
        XCTAssertEqual(app.staticTexts["place-search-visible"].label, "Visible: 2")
        XCTAssertEqual(app.staticTexts["place-search-stats"].label, "Stats: 1,2")
        let detail = app.buttons["Place: Pilátus. View details"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        detail.tap()
        XCTAssertTrue(app.staticTexts["2 activities"].waitForExistence(timeout: 5), app.debugDescription)
        let capture = XCTAttachment(screenshot: app.screenshot()); capture.name = "Place detail"; capture.lifetime = .keepAlways; add(capture)
        app.navigationBars["Place"].buttons.firstMatch.tap()
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        app.searchActivities("Morning")
        XCTAssertEqual(app.staticTexts["place-search-visible"].label, "Visible: ")
        XCTAssertEqual(app.staticTexts["place-search-stats"].label, "Stats: 1")
        app.clearActivitySearch()
        app.buttons["remove-place-filter"].tap()
        XCTAssertTrue(detail.waitForNonExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["place-search-visible"].label, "Visible: 2,3")
    }
}

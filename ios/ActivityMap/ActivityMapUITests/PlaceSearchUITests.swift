import XCTest

@MainActor final class PlaceSearchUITests: XCTestCase {
    func testPlaceAutocompleteFilteringDetailsAndStatsHistory() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing", "--place-search-ui-testing"]
        app.launch()
        defer { app.terminate() }
        let search = app.textFields["activity-name-search"]
        let launcher = app.buttons["activity-search-open"]
        XCTAssertTrue(launcher.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.staticTexts["place-search-visible"].waitForExistence(timeout: 5))
        app.buttons["2026 only"].tap()
        launcher.tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5), app.debugDescription)
        search.typeText("Pilatus")
        app.keyboards.buttons["Search"].tap()
        XCTAssertTrue(search.waitForNonExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["place-search-visible"].label, "Visible: ", "Typing remains name search")
        launcher.tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        let first = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000001"]
        let second = app.buttons["place-suggestion-00000000-0000-4000-8000-000000000002"]
        XCTAssertTrue(first.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(second.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(first.frame.midY, second.frame.midY, accuracy: 2, "Place hints share a horizontal row")
        first.tap()
        XCTAssertEqual(app.staticTexts["place-search-visible"].label, "Visible: 2")
        XCTAssertEqual(app.staticTexts["place-search-stats"].label, "Stats: 1,2")
        let detail = app.buttons["Place: Pilátus. View details"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        detail.tap()
        XCTAssertTrue(app.staticTexts["2 activities"].waitForExistence(timeout: 5), app.debugDescription)
        let capture = XCTAttachment(screenshot: app.screenshot()); capture.name = "Place detail"; capture.lifetime = .keepAlways; add(capture)
        app.buttons["Done"].tap()
        launcher.tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.typeText("Morning")
        app.buttons["place-search-done"].tap()
        XCTAssertTrue(search.waitForNonExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["place-search-visible"].label, "Visible: ")
        XCTAssertEqual(app.staticTexts["place-search-stats"].label, "Stats: 1")
        app.buttons["Clear Search"].tap()
        let remove = app.buttons["Remove place filter: Pilátus"]
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        remove.tap()
        XCTAssertEqual(app.staticTexts["place-search-visible"].label, "Visible: 2,3")
    }
}

import XCTest

@MainActor final class ActivityPlacesUITests: XCTestCase {
    func testOfflineMapProfileStyleAndSelection() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing"]
        app.launch()
        defer { app.terminate() }
        let hut = app.buttons["matched-place-hut"]
        XCTAssertTrue(hut.waitForExistence(timeout: 20), app.debugDescription)
        let original = hut.frame
        let pass = app.buttons["matched-place-pass"]
        XCTAssertTrue(pass.waitForExistence(timeout: 5), app.debugDescription)
        let passPosition = pass.frame
        hut.tap()
        XCTAssertTrue(app.staticTexts["Alpine hut"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(hut.frame.midX, original.midX, accuracy: 1.5, "Opening a card must not move its marker")
        XCTAssertEqual(hut.frame.midY, original.midY, accuracy: 1.5, "Opening a card must not change the marker anchor")
        XCTAssertEqual(pass.frame.midX, passPosition.midX, accuracy: 1.5, "A map-marker tap must not pan the camera")
        XCTAssertEqual(pass.frame.midY, passPosition.midY, accuracy: 1.5, "A map-marker tap must not pan the camera")
        hut.tap()
        XCTAssertFalse(app.staticTexts["Alpine hut"].exists)
        XCTAssertEqual(hut.frame.midY, original.midY, accuracy: 1.5)
        pass.tap()
        XCTAssertTrue(app.staticTexts["Test pass"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(pass.frame.midY, passPosition.midY, accuracy: 1.5)
        pass.tap()
        // After map interaction iOS excludes inactive sheet content from its
        // accessibility snapshot. Use physical touches on this fixed synthetic
        // medium sheet, anchored to its native grabber, as in the phone video.
        let grabber = app.buttons["Sheet Grabber"]
        let profileY = grabber.frame.midY + 145
        let summit = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.midX + 12, dy: profileY))
        summit.tap()
        XCTAssertTrue(app.staticTexts["Test summit"].waitForExistence(timeout: 5), "A profile icon must open its place directly, without a menu")
        summit.tap()
        XCTAssertTrue(app.staticTexts["Test summit"].exists, "Repeated icon taps must not open a menu")
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.width * 0.325, dy: profileY + 31)).tap()
        XCTAssertTrue(app.staticTexts["Alpine hut"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["places-selection-count"].label, "Selected routes: 1")
        let light = XCTAttachment(screenshot: app.screenshot())
        light.name = "Places map and profile light"; light.lifetime = .keepAlways
        add(light)
        app.buttons["places-change-style"].tap()
        XCTAssertTrue(hut.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.buttons["profile-places"].exists)
        // Repeated visits remain directly tappable without a separate list.
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.width * 0.738, dy: profileY + 31)).tap()
        XCTAssertTrue(app.staticTexts["Alpine hut"].waitForExistence(timeout: 5))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Places map and profile dark"; attachment.lifetime = .keepAlways
        add(attachment)
        let scope = app.buttons["places-route-scope"]
        scope.tap()
        XCTAssertFalse(hut.waitForExistence(timeout: 1), "Inactive chooser results must not display places")
        scope.tap()
        XCTAssertTrue(hut.waitForExistence(timeout: 5), "Combine displays places from the selected group")
        scope.tap()
        XCTAssertFalse(hut.waitForExistence(timeout: 1), "Leaving Combine restores active-route scope")
        scope.tap()
        XCTAssertTrue(hut.waitForExistence(timeout: 5), "Opening a route restores its places")
        app.buttons["places-clear-selection"].tap()
        XCTAssertFalse(hut.waitForExistence(timeout: 1), app.debugDescription)
        XCTAssertEqual(app.staticTexts["places-selection-count"].label, "Selected routes: 0")
    }
}

import XCTest

@MainActor final class ActivityPlacesUITests: XCTestCase {
    override func setUpWithError() throws {
        XCUIDevice.shared.orientation = .portrait
    }
    override func tearDownWithError() throws {
        XCUIDevice.shared.orientation = .portrait
    }

    func testMapTapShowsPlacesFromOverlappingRoutesBeforeOpeningDetails() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing", "--places-chooser-ui-testing"]
        app.launch()
        defer { app.terminate() }
        XCTAssertTrue(app.buttons["Map layers"].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(app.buttons["matched-place-hut"].exists)
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "Overlapping routes before map tap"; before.lifetime = .keepAlways; add(before)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        XCTAssertTrue(app.buttons["matched-place-hut"].waitForExistence(timeout: 5), "First route places must appear in the chooser")
        XCTAssertTrue(app.buttons["matched-place-second-hut"].waitForExistence(timeout: 5), "Other route places must appear before opening details")
        XCTAssertEqual(app.buttons.matching(identifier: "matched-place-peak").count, 1, "Shared places must appear once")
        XCTAssertEqual(app.staticTexts["places-selection-count"].label, "Selected routes: 2")
        XCTAssertEqual(app.staticTexts["places-selection-count"].value as? String, "Active route: none", "No route has been activated")
        let after = XCTAttachment(screenshot: app.screenshot())
        after.name = "Overlapping route places in chooser"; after.lifetime = .keepAlways; add(after)
    }

    func testPlaceMarkersSurviveRotationAndStyleChanges() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--places-ui-testing"]
        app.launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let markers = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "matched-place-"))
        XCTAssertTrue(markers.firstMatch.waitForExistence(timeout: 20), app.debugDescription)
        for orientation in [UIDeviceOrientation.landscapeLeft, .landscapeRight, .portrait] {
            XCUIDevice.shared.orientation = orientation
            XCTAssertTrue(markers.firstMatch.waitForExistence(timeout: 10), "Place markers disappeared after rotation: \(app.debugDescription)")
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Places orientation \(orientation.rawValue)"; capture.lifetime = .keepAlways
            add(capture)
        }
        app.buttons["places-change-style"].tap()
        XCTAssertTrue(markers.firstMatch.waitForExistence(timeout: 10), app.debugDescription)
    }

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
        app.buttons["close-place"].tap()
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
        // A real horizontal scrub must preserve the place; a stationary tap
        // on the chart dismisses both its readout and the map card.
        let chartBlank = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.width * 0.4, dy: profileY + 90))
        let scrubEnd = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.width * 0.65, dy: profileY + 90))
        chartBlank.press(forDuration: 0.05, thenDragTo: scrubEnd)
        XCTAssertTrue(app.buttons["close-place"].exists, "Scrubbing must preserve the selected place")
        chartBlank.tap()
        XCTAssertFalse(app.buttons["close-place"].exists, "Tapping chart background must dismiss the place")
        hut.tap()
        XCTAssertTrue(app.staticTexts["Alpine hut"].waitForExistence(timeout: 5))
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
        XCTAssertTrue(hut.waitForExistence(timeout: 5), "Selected routes keep their places without an active route")
        scope.tap()
        XCTAssertTrue(hut.waitForExistence(timeout: 5), "Combine displays places from the selected group")
        scope.tap()
        XCTAssertTrue(hut.waitForExistence(timeout: 5), "Leaving Combine preserves places from selected routes")
        scope.tap()
        XCTAssertTrue(hut.waitForExistence(timeout: 5), "Opening a route restores its places")
        app.buttons["places-clear-selection"].tap()
        XCTAssertFalse(hut.waitForExistence(timeout: 1), app.debugDescription)
        XCTAssertEqual(app.staticTexts["places-selection-count"].label, "Selected routes: 0")
    }
}

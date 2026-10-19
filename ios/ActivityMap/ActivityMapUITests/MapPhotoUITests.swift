import XCTest

/// UI interaction belongs in an automation runner. A hosted test run can lack
/// SwiftUI's accessibility tree even while its controls visibly render.
@MainActor
final class MapPhotoUITests: XCTestCase {
    func testLayersMenuExposesPhotoControlFirstAndPreservesBrowsingState() async throws {
        let app = launch()
        defer { app.terminate() }
        let initial = try await state(in: app) { $0.ready }
        let layers = app.buttons["Map layers"]
        XCTAssertTrue(layers.waitForExistence(timeout: 15), app.debugDescription)
        layers.tap()
        let photos = app.buttons["Show photos on map"]
        XCTAssertTrue(photos.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(photos.isEnabled)
        let basemaps = app.buttons["Standard"]
        XCTAssertTrue(basemaps.exists, app.debugDescription)
        XCTAssertLessThan(photos.frame.minY, basemaps.frame.minY)
        photos.tap()
        let hidden = try await state(in: app) { !$0.showPhotos }
        XCTAssertEqual(hidden.selection, initial.selection)
        XCTAssertFalse(hidden.pendingCamera)
        XCTAssertEqual(hidden.zoom, initial.zoom, accuracy: 0.01)
        layers.tap()
        XCTAssertTrue(photos.waitForExistence(timeout: 5))
        photos.tap()
        let shown = try await state(in: app) { $0.showPhotos }
        XCTAssertEqual(shown.selection, initial.selection)
        XCTAssertFalse(shown.pendingCamera)
        XCTAssertEqual(shown.zoom, initial.zoom, accuracy: 0.01)
    }

    func testPinsZoomToThumbnailsAndViewerPreservesSelection() async throws {
        try await journey(resultsPresented: false)
    }

    func testViewerRetainsResultsPresentationAndReturnsToIt() async throws {
        try await journey(resultsPresented: true)
    }

    func testLandscapeViewerRetainsNativeResultsPresentation() async throws {
        try await journey(resultsPresented: true, orientation: .landscapeLeft)
    }

    private func journey(resultsPresented: Bool,
                         orientation: UIDeviceOrientation = .portrait) async throws {
        XCUIDevice.shared.orientation = orientation
        let app = launch(resultsPresented: resultsPresented)
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        let initial = try await state(in: app) { $0.ready }
        let pin = button(in: app, prefix: "Zoom into 2 photos")
        XCTAssertTrue(pin.waitForExistence(timeout: 15), app.debugDescription)
        let pinned = try await state(in: app) { $0.ready }
        XCTAssertEqual(pinned.fetchCount, 0, "Pins must not load image bytes")
        pin.tap()
        let thumbnail = button(in: app, prefix: "View 2 photos:")
        XCTAssertTrue(thumbnail.waitForExistence(timeout: 10), app.debugDescription)
        let zoomed = try await state(in: app) { $0.zoom >= 12 && $0.fetchCount > 0 && !$0.pendingCamera }
        XCTAssertEqual(zoomed.selection, initial.selection)
        XCTAssertTrue(zoomed.fetchPaths.allSatisfy { $0.hasPrefix("/thumb-") })
        thumbnail.tap()
        let close = app.buttons["photo-viewer-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts["1 of 3"].waitForExistence(timeout: 5))
        app.buttons["Next photo"].tap()
        XCTAssertTrue(app.staticTexts["Second photo of the same activity"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Second map photo"].exists,
                       "Horizontal paging must stay within the tapped activity")
        app.buttons["Photo activity"].tap()
        let nearbyActivity = app.buttons["Activity 2"]
        XCTAssertTrue(nearbyActivity.waitForExistence(timeout: 5), app.debugDescription)
        nearbyActivity.tap()
        XCTAssertTrue(app.staticTexts["Second map photo"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["1 of 1"].waitForExistence(timeout: 5))
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 10))
        let returned = try await state(in: app) { $0.lastViewerDepth > 0 }
        XCTAssertEqual(returned.selection, initial.selection)
        XCTAssertFalse(returned.selectionChangedDuringViewer,
                       "Opening photos or switching nearby activities must preserve route selection")
        XCTAssertEqual(returned.resultsPresented, resultsPresented)
        XCTAssertEqual(returned.resultsDetent, initial.resultsDetent)
        XCTAssertEqual(returned.lastViewerDepth, resultsPresented && returned.usesNativePresentation ? 2 : 1)
        XCTAssertTrue(returned.lastViewerHasTransition, "Photos must retain the native zoom transition")
        XCTAssertFalse(returned.lastViewerDragLocked, "Results must not disable photo swipe dismissal")

        app.buttons["map-photo-fixture-hide-ride"].tap()
        let survivor = button(in: app, prefix: "View photo:")
        XCTAssertTrue(survivor.waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["map-photo-fixture-delete-on-next-viewer"].tap()
        survivor.tap()
        // The fixture removes metadata only after a real viewer finished
        // presenting. This checks dismissal without racing a transient snapshot.
        let deleted = try await state(in: app) { $0.deletedAfterPresentation }
        XCTAssertFalse(deleted.photos.contains("a"))
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        XCTAssertTrue(survivor.waitForNonExistence(timeout: 5))
        XCTAssertEqual(deleted.selection, initial.selection)
        XCTAssertFalse(deleted.selectionChangedDuringViewer)

        app.buttons["Map layers"].tap()
        let toggle = app.buttons["Show photos on map"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        toggle.tap()
        let hidden = try await state(in: app) { !$0.showPhotos }
        XCTAssertEqual(hidden.zoom, deleted.zoom, accuracy: 0.01)
        XCTAssertFalse(hidden.pendingCamera)
        app.buttons["map-photo-fixture-restore"].tap()
        XCTAssertTrue(thumbnail.waitForExistence(timeout: 10), app.debugDescription)
        thumbnail.tap()
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        app.buttons["Next photo"].tap()
        XCTAssertTrue(app.staticTexts["Second photo of the same activity"].waitForExistence(timeout: 5))
        app.buttons["View activity"].tap()
        let handedOff = try await state(in: app) { $0.tab == "list" && $0.inspection == 1 }
        XCTAssertEqual(handedOff.selection, initial.selection)
        XCTAssertFalse(handedOff.selectionChangedDuringViewer)
    }

    private func launch(resultsPresented: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--map-photo-ui-testing"] + (resultsPresented ? ["--map-photo-results"] : [])
        app.launch()
        return app
    }

    private func button(in app: XCUIApplication, prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private struct FixtureState: Decodable {
        let ready: Bool
        let selection: [Int]
        let photos: [String]
        let tab: String
        let inspection: Int
        let showPhotos: Bool
        let pendingCamera: Bool
        let zoom: Double
        let resultsPresented: Bool
        let resultsDetent: Int
        let fetchPaths: [String]
        let fetchCount: Int
        let lastViewerDepth: Int
        let lastViewerHasTransition: Bool
        let lastViewerDragLocked: Bool
        let selectionChangedDuringViewer: Bool
        let usesNativePresentation: Bool
        let deletedAfterPresentation: Bool
    }

    private func state(in app: XCUIApplication, timeout: TimeInterval = 15,
                       file: StaticString = #filePath, line: UInt = #line,
                       matching condition: (FixtureState) -> Bool) async throws -> FixtureState {
        let deadline = Date().addingTimeInterval(timeout)
        let status = app.staticTexts["map-photo-fixture-state"]
        var latest = "Status hidden by presentation"
        repeat {
            if status.exists, let value = status.value as? String {
                latest = value
                let state = try JSONDecoder().decode(FixtureState.self, from: Data(value.utf8))
                if condition(state) { return state }
            }
            try await Task.sleep(for: .milliseconds(100))
        } while Date() < deadline
        XCTFail("Fixture state did not settle: \(latest)\n\(app.debugDescription)", file: file, line: line)
        throw NSError(domain: "MapPhotoUITests", code: 1)
    }
}

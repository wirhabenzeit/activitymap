import UIKit
import XCTest

/// Controller/scroll identity checks complement the retained orientation
/// screenshots. Accessibility cannot establish animation smoothness between frames.
@MainActor
final class MapRotationUITests: XCTestCase {
    func testResultsKeepNativeSheetAndScrollThroughRotationAndSettings() async throws {
        let app = launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let initial = try await state(in: app) { $0.ready }
        XCTAssertEqual(initial.selection, Array(1...30))
        XCTAssertEqual(initial.detent, 1, "Fixture starts at the production middle detent")
        let scroll = resultsScroll(in: app)
        XCTAssertTrue(scroll.waitForExistence(timeout: 10), app.debugDescription)
        scroll.swipeUp(velocity: .slow)
        let scrolled = try await state(in: app) { $0.ready && $0.offset[1] > initial.offset[1] + 80 }
        let anchor = try visibleAnchor(in: app)
        capture(app, name: "Results portrait scrolled")
        var previous = scrolled
        for orientation in [UIDeviceOrientation.landscapeLeft, .landscapeRight, .portrait] {
            let rotated = try await rotate(orientation, app: app, previous: previous)
            assertRetained(rotated, baseline: scrolled)
            XCTAssertEqual(rotated.detailID, -1)
            // Text reflows between portrait and trailing panel widths. Keep
            // the same visible row near its old relative offset, within one row.
            capture(app, name: "Results \(orientation.rawValue)")
            assertAnchor(anchor, in: app)
            if orientation == .landscapeLeft {
                let settingsButtons = app.buttons.matching(identifier: "open-settings")
                XCTAssertTrue(settingsButtons.firstMatch.waitForExistence(timeout: 5), app.debugDescription)
                let settings = try XCTUnwrap(settingsButtons.allElementsBoundByIndex.first(where: \.isHittable),
                                             "The visible Map toolbar must expose Settings")
                settings.tap()
                let done = app.navigationBars["Settings"].buttons["Done"]
                XCTAssertTrue(done.waitForExistence(timeout: 10), app.debugDescription)
                // Settings is modal and can hide the shell diagnostic from AX.
                // Verify its real UI now and the retained results after dismissal.
                capture(app, name: "Settings above landscape results")
                done.tap()
                XCTAssertTrue(done.waitForNonExistence(timeout: 10), app.debugDescription)
                let returned = try await state(in: app) { $0.ready && $0.presentationDepth == 1 }
                assertRetained(returned, baseline: scrolled)
                XCTAssertEqual(returned.offset[1], rotated.offset[1], accuracy: 2, "Settings must not move retained results")
                assertAnchor(anchor, in: app)
            }
            previous = rotated
        }
        let returned = try await state(in: app) { $0.ready }
        XCTAssertEqual(returned.offset[1], scrolled.offset[1], accuracy: Double(anchor.height),
                       "Round-trip rotation must retain the scrolled position within one row")
    }

    func testLandscapeFiltersReturnToTheMapSelection() async throws {
        let app = launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let initial = try await state(in: app) { $0.ready }
        let landscape = try await rotate(.landscapeLeft, app: app, previous: initial)
        let filters = try XCTUnwrap(app.buttons.matching(identifier: "browse-filters").allElementsBoundByIndex.first(where: \.isHittable))
        filters.tap()
        let close = app.buttons["filters-done"]
        XCTAssertTrue(close.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertLessThan(close.frame.maxX, app.frame.width * 0.6)
        capture(app, name: "Landscape filters over Map")
        app.buttons["activity-search-open"].tap()
        let search = app.textFields["activity-name-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        search.typeText("Rotation")
        app.buttons["place-search-done"].tap()
        XCTAssertTrue(search.waitForNonExistence(timeout: 5))
        app.buttons["Clear Search"].tap()
        close.tap()
        let returned = try await state(in: app) { $0.ready && $0.presentationDepth == 1 }
        XCTAssertEqual(returned.selection, landscape.selection)
        XCTAssertEqual(returned.candidates, landscape.candidates)
        XCTAssertEqual(returned.detent, landscape.detent)
        XCTAssertTrue(resultsScroll(in: app).isHittable, "Map results return after the drawer closes")
    }

    func testActivityDetailAndUnderlyingResultsSurviveRotation() async throws {
        let app = launch()
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        _ = try await state(in: app) { $0.ready }
        let scroll = resultsScroll(in: app)
        XCTAssertTrue(scroll.waitForExistence(timeout: 10), app.debugDescription)
        scroll.swipeUp(velocity: .slow)
        let before = try await state(in: app) { $0.ready && $0.offset[1] > 80 }
        let anchor = try visibleAnchor(in: app)
        resultButton(anchor.id, in: app).tap()
        let detail = try await state(in: app) { $0.ready && $0.detailID == anchor.id }
        assertRetained(detail, baseline: before)
        capture(app, name: "Detail portrait")
        var previous = detail
        for orientation in [UIDeviceOrientation.landscapeLeft, .landscapeRight, .portrait] {
            let rotated = try await rotate(orientation, app: app, previous: previous)
            assertRetained(rotated, baseline: before)
            XCTAssertEqual(rotated.detailID, anchor.id, "Rotation must preserve the current detail")
            XCTAssertTrue(resultsBack(in: app).exists, app.debugDescription)
            capture(app, name: "Detail \(orientation.rawValue)")
            previous = rotated
        }
        resultsBack(in: app).tap()
        let returned = try await state(in: app) { $0.ready && $0.detailID == -1 }
        assertRetained(returned, baseline: before)
        XCTAssertEqual(returned.offset[1], before.offset[1], accuracy: Double(anchor.height))
        assertAnchor(anchor, in: app)
        capture(app, name: "Results after rotated detail")
    }

    func testExpandedDetentRemainsFullHeightAfterRotation() async throws {
        let app = launch(expanded: true)
        defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
        let initial = try await state(in: app) { $0.ready && $0.detent == 2 }
        if initial.windowFrame[2] < 650 {
            XCTAssertEqual(initial.nativeDetent, UISheetPresentationController.Detent.Identifier.large.rawValue)
        }
        XCTAssertGreaterThan(initial.sheetFrame[3], initial.windowFrame[3] * 0.7,
                             "Preferred content height must not cap the expanded portrait detent")
        capture(app, name: "Expanded results portrait")
        let landscape = try await rotate(.landscapeLeft, app: app, previous: initial)
        assertRetained(landscape, baseline: initial)
        capture(app, name: "Expanded results landscape")
        let returned = try await rotate(.portrait, app: app, previous: landscape)
        assertRetained(returned, baseline: initial)
        if returned.windowFrame[2] < 650 {
            XCTAssertEqual(returned.nativeDetent, UISheetPresentationController.Detent.Identifier.large.rawValue)
        }
        XCTAssertGreaterThan(returned.sheetFrame[3], returned.windowFrame[3] * 0.7,
                             "Returning to portrait must restore the expanded full-height detent")
        capture(app, name: "Expanded results portrait returned")
    }

    private func launch(expanded: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--map-rotation-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            + (expanded ? ["--map-rotation-expanded"] : [])
        app.launch()
        return app
    }

    private func rotate(_ orientation: UIDeviceOrientation, app: XCUIApplication,
                        previous: FixtureState) async throws -> FixtureState {
        XCUIDevice.shared.orientation = orientation
        return try await state(in: app) {
            $0.ready && $0.orientation != previous.orientation
                && ($0.windowFrame[2] > $0.windowFrame[3]) == orientation.isLandscape
        }
    }

    private func assertRetained(_ state: FixtureState, baseline: FixtureState,
                                file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(state.sheetID.isEmpty, file: file, line: line)
        XCTAssertEqual(state.sheetID, baseline.sheetID, "Native sheet was replaced", file: file, line: line)
        XCTAssertEqual(state.controllerID, baseline.controllerID, file: file, line: line)
        XCTAssertEqual(state.presenterID, baseline.presenterID, file: file, line: line)
        XCTAssertEqual(state.presentationCount, 1, "Rotation must not present a replacement", file: file, line: line)
        XCTAssertEqual(state.scrollID, baseline.scrollID, "Results scroll view was replaced", file: file, line: line)
        XCTAssertTrue(state.resultsPresented, file: file, line: line)
        if state.detailID == -1 {
            XCTAssertTrue(state.scrollAttached, "Results must reattach after native Back", file: file, line: line)
        }
        XCTAssertEqual(state.selection, baseline.selection, file: file, line: line)
        XCTAssertEqual(state.candidates, baseline.candidates, file: file, line: line)
        XCTAssertEqual(state.detent, baseline.detent, "Logical detent must survive adaptation", file: file, line: line)
        XCTAssertGreaterThan(state.mapFrame[2], 0, file: file, line: line)
        XCTAssertGreaterThan(state.sheetFrame[2], 0, file: file, line: line)
    }

    private struct Anchor { let id: Int; let relativeY: CGFloat; let height: CGFloat }
    private func visibleAnchor(in app: XCUIApplication) throws -> Anchor {
        let viewport = resultsScroll(in: app).frame.intersection(app.frame)
        let rows = resultsScroll(in: app).buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Details for Rotation activity ")).allElementsBoundByIndex
        guard let row = rows.filter({ $0.isHittable && viewport.contains($0.frame) })
            .min(by: { $0.frame.minY < $1.frame.minY }),
              let id = Int(row.label.replacingOccurrences(of: "Details for Rotation activity ", with: "")) else {
            XCTFail("No fully visible results row to anchor\n\(app.debugDescription)")
            throw NSError(domain: "MapRotationUITests", code: 2)
        }
        return Anchor(id: id, relativeY: row.frame.minY - viewport.minY, height: row.frame.height + 9)
    }
    private func assertAnchor(_ anchor: Anchor, in app: XCUIApplication,
                              file: StaticString = #filePath, line: UInt = #line) {
        let row = resultButton(anchor.id, in: app)
        XCTAssertTrue(row.exists && row.isHittable, "The scrolled anchor must remain visible", file: file, line: line)
        let viewport = resultsScroll(in: app).frame.intersection(app.frame)
        XCTAssertEqual(row.frame.minY - viewport.minY, anchor.relativeY,
                       accuracy: max(anchor.height, row.frame.height + 9),
                       "Rotation should retain the visible anchor within one row", file: file, line: line)
    }

    private func resultsBack(in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@ AND identifier IN %@",
            "Back to selected activities", ["map-results-back", "map-results-panel"])).firstMatch
    }

    private func resultsScroll(in app: XCUIApplication) -> XCUIElement {
        // The real iOS 27 AX tree propagates the panel identifier onto the
        // scroll element; its contained row controls keep their own labels.
        app.scrollViews.matching(NSPredicate(format: "identifier IN %@",
            ["map-results-scroll", "map-results-panel"])).firstMatch
    }

    private func resultButton(_ id: Int, in app: XCUIApplication) -> XCUIElement {
        resultsScroll(in: app).buttons["Details for Rotation activity \(id)"]
    }

    private struct FixtureState: Decodable {
        let ready: Bool
        let orientation: Int
        let selection: [Int]
        let candidates: [Int]
        let detent: Int
        let nativeDetent: String
        let detailID: Int
        let resultsPresented: Bool
        let sheetID: String
        let controllerID: String
        let presenterID: String
        let presentationCount: Int
        let presentationDepth: Int
        let scrollID: String
        let scrollAttached: Bool
        let offset: [Double]
        let sheetFrame: [Double]
        let mapFrame: [Double]
        let windowFrame: [Double]
    }
    private func state(in app: XCUIApplication, timeout: TimeInterval = 15,
                       matching condition: (FixtureState) -> Bool) async throws -> FixtureState {
        let deadline = Date().addingTimeInterval(timeout)
        let status = app.staticTexts["map-rotation-fixture-state"]
        var latest = "Shell diagnostic not available"
        repeat {
            if status.exists, let value = status.value as? String {
                latest = value
                let decoded = try JSONDecoder().decode(FixtureState.self, from: Data(value.utf8))
                if condition(decoded) { return decoded }
            }
            try await Task.sleep(for: .milliseconds(100))
        } while Date() < deadline
        XCTFail("Rotation state did not settle: \(latest)\n\(app.debugDescription)")
        throw NSError(domain: "MapRotationUITests", code: 1)
    }
    private func capture(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let status = app.staticTexts["map-rotation-fixture-state"]
        let diagnostic = XCTAttachment(string: status.exists
            ? (status.value as? String ?? "Missing state") : "Shell diagnostic hidden by modal presentation")
        diagnostic.name = "\(name) UIKit geometry"
        diagnostic.lifetime = .keepAlways
        add(diagnostic)
    }
}

import UIKit
import XCTest

/// Hosted SwiftUI tests can expose an empty accessibility tree. Exercise the
/// production List and its controls through the real automation runner.
@MainActor
final class ListSelectionUITests: XCTestCase {
    func testShellControlsFollowVisibleListAcrossInspectionAndRotation() throws {
        try journey(standalone: false)
    }

    func testStandaloneControlsShareInspectionStateWithTheirList() throws {
        try journey(standalone: true)
    }

    func testSummaryOptionsAndShareFollowCombineMode() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--list-selection-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        defer { app.terminate() }
        let share = listControl(in: app, label: "Share selected activities", identifier: "share-selection")
        XCTAssertTrue(share.waitForExistence(timeout: 10), app.debugDescription)
        listControl(in: app, label: "Combine selections", identifier: "combine-selection").tap()
        XCTAssertTrue(share.waitForNonExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(listControl(in: app, label: "Clear selection", identifier: "clear-selection").exists)
        listControl(in: app, label: "Combine selections", identifier: "combine-selection").tap()
        XCTAssertTrue(share.waitForExistence(timeout: 5))
        app.buttons["List view options"].tap()
        app.buttons["Show summary"].tap()
        let filteredHeading = app.buttons.matching(NSPredicate(format: "label IN %@", ["Expand summary", "Collapse summary"])).firstMatch
        XCTAssertTrue(filteredHeading.waitForExistence(timeout: 5), app.debugDescription)
        let scope = app.buttons["activity-summary-scope-selected"]
        let filteredScope = app.buttons["activity-summary-scope-filtered"]
        XCTAssertTrue(scope.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(scope.label, "2 selected")
        XCTAssertTrue(filteredScope.isSelected)
        XCTAssertEqual(scope.frame.midY, filteredHeading.frame.midY, accuracy: 1, "Scope controls stay inline with the summary header")
        scope.tap()
        XCTAssertTrue(scope.isSelected)
        XCTAssertFalse(filteredScope.isSelected)
        filteredScope.tap()
        XCTAssertTrue(filteredScope.isSelected)
        XCTAssertFalse(scope.isSelected)
        scope.tap()
        XCTAssertTrue(scope.isSelected)
        XCTAssertTrue(filteredHeading.waitForExistence(timeout: 5), app.debugDescription)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Selected summary and Combine share"
        capture.lifetime = .keepAlways
        add(capture)
        let heading = filteredHeading
        let headingY = heading.frame.minY
        let disclosure = filteredHeading
        let detail = app.otherElements.matching(NSPredicate(format: "label == %@", "Moving time")).firstMatch
        for _ in 0..<3 {
            disclosure.tap()
            XCTAssertTrue(detail.waitForExistence(timeout: 5), app.debugDescription)
            XCTAssertEqual(heading.frame.minY, headingY, accuracy: 1, "Expansion keeps the summary header anchored")
            disclosure.tap()
            XCTAssertTrue(detail.waitForNonExistence(timeout: 5), app.debugDescription)
            XCTAssertEqual(heading.frame.minY, headingY, accuracy: 1, "Collapse keeps the summary header anchored")
        }
        listControl(in: app, label: "Clear selection", identifier: "clear-selection").tap()
        XCTAssertTrue(filteredHeading.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(scope.waitForNonExistence(timeout: 5), app.debugDescription)
        app.buttons["List view options"].tap()
        app.buttons["Show summary"].tap()
        XCTAssertTrue(filteredHeading.waitForNonExistence(timeout: 5))
        app.buttons["List view options"].tap()
        app.buttons["Show summary"].tap()
        XCTAssertTrue(filteredHeading.waitForExistence(timeout: 5))
        XCTAssertFalse(scope.exists)
        app.buttons["List view options"].tap()
        app.buttons["Show summary"].tap()
        XCTAssertTrue(filteredHeading.waitForNonExistence(timeout: 5))
    }

    func testDetailScrollReachesBottomAndKeepsLastActionVisible() throws {
        continueAfterFailure = false
        defer { XCUIDevice.shared.orientation = .portrait }
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            XCUIDevice.shared.orientation = orientation
            let app = XCUIApplication()
            app.launchArguments = ["--list-selection-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            app.launch()
            defer { app.terminate() }
            let activity = app.buttons["Details for Activity 2"]
            XCTAssertTrue(activity.waitForExistence(timeout: 10), app.debugDescription)
            activity.tap()
            // An adjacent inspector propagates its ID to the inner scroll view.
            let scroll = app.scrollViews.matching(NSPredicate(format: "identifier IN %@",
                ["activity-detail-scroll", "list-activity-panel"])).firstMatch
            XCTAssertTrue(scroll.waitForExistence(timeout: 10), app.debugDescription)
            let export = scroll.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Export GPX")).firstMatch
            // AX frames do not describe an outer drawing mask. Position the
            // action card across the bottom edge for a meaningful pixel capture.
            let share = scroll.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Share activity")).firstMatch
            let targetY = app.frame.maxY - 100
            for _ in 0..<8 {
                let delta = share.exists ? targetY - share.frame.minY : -250
                if abs(delta) < 15 { break }
                let limit = min(250, scroll.frame.intersection(app.frame).height * 0.35)
                let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: max(-limit, min(limit, delta)))),
                            withVelocity: .slow, thenHoldForDuration: 0.2)
            }
            XCTAssertTrue(share.exists, app.debugDescription)
            let crossing = XCTAttachment(screenshot: app.screenshot())
            crossing.name = "Detail card crossing bottom \(orientation.rawValue)"
            crossing.lifetime = .keepAlways
            add(crossing)
            print("Detail mid-scroll geometry: orientation=\(orientation.rawValue), targetY=\(targetY), share=\(share.frame), app=\(app.frame)")
            for _ in 0..<6 {
                scroll.swipeUp()
                if export.exists && scroll.frame.intersection(app.frame).contains(export.frame) { break }
            }
            let viewport = scroll.frame.intersection(app.frame)
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "Detail bottom \(orientation.rawValue)"
            capture.lifetime = .keepAlways
            add(capture)
            print("Detail bottom geometry: orientation=\(orientation.rawValue), app=\(app.frame), scroll=\(scroll.frame), export=\(export.frame)")
            XCTAssertTrue(export.exists && export.isHittable, app.debugDescription)
            XCTAssertTrue(viewport.insetBy(dx: -1, dy: -1).contains(export.frame),
                          "The complete final action must fit in the visible scroll viewport: \(viewport), \(export.frame)")
        }
    }

    private func journey(standalone: Bool) throws {
        continueAfterFailure = false
        let tablet = UIDevice.current.userInterfaceIdiom == .pad
        XCUIDevice.shared.orientation = tablet ? .landscapeLeft : .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--list-selection-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            + (standalone ? ["--list-standalone"] : [])
        app.launch()
        defer {
            app.terminate()
            XCUIDevice.shared.orientation = .portrait
        }
        assertListControls(in: app)
        let activity = app.buttons["Details for Activity 2"]
        XCTAssertTrue(activity.waitForExistence(timeout: 10), app.debugDescription)
        activity.tap()
        let exit = app.buttons[tablet ? "Close activity details" : "Back to activities"]
        XCTAssertTrue(exit.waitForExistence(timeout: 10), app.debugDescription)
        assertControls(in: app, visible: tablet)
        if !tablet {
            // The List footer belongs to the outgoing page, including when
            // an interactive Back is cancelled and then completed.
            let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5))
                .withOffset(CGVector(dx: 2, dy: 0))
            edge.press(forDuration: 0.05,
                       thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)),
                       withVelocity: .slow, thenHoldForDuration: 0.4)
            XCTAssertTrue(exit.exists && exit.isHittable, "A cancelled Back must keep the detail open")
            assertControls(in: app, visible: false)
            edge.press(forDuration: 0.05,
                       thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)),
                       withVelocity: .slow, thenHoldForDuration: 0.2)
            XCTAssertTrue(exit.waitForNonExistence(timeout: 10), app.debugDescription)
            assertListControls(in: app)
            activity.tap()
            XCTAssertTrue(exit.waitForExistence(timeout: 10), app.debugDescription)
            assertControls(in: app, visible: false)
        }
        if !tablet && !standalone {
            XCUIDevice.shared.orientation = .landscapeLeft
            XCTAssertTrue(exit.waitForExistence(timeout: 10), app.debugDescription)
            assertControls(in: app, visible: false)
        }
        let detailCapture = XCTAttachment(screenshot: app.screenshot())
        detailCapture.name = standalone ? "Standalone List detail" : "List detail"
        detailCapture.lifetime = .keepAlways
        add(detailCapture)
        exit.tap()
        XCTAssertTrue(exit.waitForNonExistence(timeout: 10), app.debugDescription)
        assertListControls(in: app)
        if !tablet && !standalone {
            XCUIDevice.shared.orientation = .portrait
            assertListControls(in: app)
        }
    }

    private func assertListControls(in app: XCUIApplication,
                                    file: StaticString = #filePath, line: UInt = #line) {
        assertControls(in: app, visible: true, file: file, line: line)
        let combineValue = listControl(in: app, label: "Combine selections", identifier: "combine-selection").value as? String ?? ""
        XCTAssertTrue(combineValue == "On" || combineValue.hasPrefix("On, "),
                      "Combine mode must remain On: \(combineValue)", file: file, line: line)
        let count = app.staticTexts.matching(NSPredicate(format: "label == %@ AND identifier != %@",
                                                        "2 selected", "map-results-panel")).firstMatch
        XCTAssertTrue(count.waitForExistence(timeout: 10), app.debugDescription,
                      file: file, line: line)
        for id in [2, 4] {
            XCTAssertTrue(app.buttons["Deselect Activity \(id)"].exists,
                          "Returning from inspection preserves selected activity \(id)", file: file, line: line)
        }
    }

    private func assertControls(in app: XCUIApplication, visible: Bool,
                                file: StaticString = #filePath, line: UInt = #line) {
        for (label, identifier) in [("Combine selections", "combine-selection"),
                                    ("Share selected activities", "share-selection"),
                                    ("Clear selection", "clear-selection")] {
            let control = listControl(in: app, label: label, identifier: identifier)
            if visible {
                XCTAssertTrue(control.waitForExistence(timeout: 10), app.debugDescription, file: file, line: line)
                XCTAssertTrue(control.isHittable, "List control must remain reachable: \(label)\n\(app.debugDescription)", file: file, line: line)
            } else {
                XCTAssertTrue(control.waitForNonExistence(timeout: 10),
                              "Full-page details must not show global selection controls: \(label)\n\(app.debugDescription)",
                              file: file, line: line)
            }
        }
    }
    private func listControl(in app: XCUIApplication, label: String, identifier: String) -> XCUIElement {
        // Map remains mounted across tabs and can expose similarly labelled
        // controls. The footer also propagates its container ID to children.
        app.buttons.matching(NSPredicate(format: "label == %@ AND (identifier == %@ OR identifier == %@)",
                                         label, identifier, "list-status-bar")).firstMatch
    }

}

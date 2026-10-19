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

import UIKit
import XCTest

/// Exercise the real native scroll and presentation hierarchy. Pure policy
/// tests cover reversal and event ordering; these journeys prove that physical
/// touches reach the shared interaction in Map and List.
@MainActor
final class ActivityContinuationUITests: XCTestCase {
    func testMapPushAndInteractiveBackRetainResultsAndSelection() async throws {
        let app = launch()
        defer { app.terminate() }
        let initial = try await state(in: app) { $0.ready }
        try await open(3, app: app)
        let detail = try await state(in: app) { $0.ready && $0.detailID == 3 }
        XCTAssertEqual(detail.navigationDepth, 2)
        XCTAssertEqual(detail.controllerID, initial.controllerID)
        XCTAssertEqual(detail.scrollID, initial.scrollID)
        let frame = rect(detail.detailFrame)
        let sheet = rect(detail.sheetFrame)
        // A floating native card's outer edge belongs to sheet gestures. Its
        // native content Back gesture starts inside the content; edge-to-edge
        // phone navigation also supports the standard screen-edge gesture.
        let inset: CGFloat = sheet.minX > app.frame.minX + 1 && sheet.width < app.frame.width - 2 ? 30 : 2
        let backStart = coordinate(app, x: frame.minX + inset, y: frame.midY)
        backStart.press(forDuration: 0.05,
                   thenDragTo: coordinate(app, x: frame.minX + frame.width * 0.2, y: frame.midY),
                   withVelocity: .slow, thenHoldForDuration: 0.4)
        let cancelled = try await state(in: app) { $0.ready }
        XCTAssertEqual(cancelled.detailID, 3, "An incomplete native Back keeps the current detail")
        XCTAssertEqual(cancelled.selection, initial.selection)
        backStart.press(forDuration: 0.05,
                   thenDragTo: coordinate(app, x: frame.minX + frame.width * 0.9, y: frame.midY),
                   withVelocity: .slow, thenHoldForDuration: 0.2)
        let returned = try await state(in: app) { $0.ready && $0.detailID == -1 }
        XCTAssertEqual(returned.navigationDepth, 1)
        XCTAssertEqual(returned.controllerID, initial.controllerID)
        XCTAssertEqual(returned.scrollID, initial.scrollID)
        XCTAssertTrue(returned.scrollAttached)
        XCTAssertEqual(returned.offset[1], initial.offset[1], accuracy: 2)
        XCTAssertEqual(returned.selection, initial.selection)
        capture(app, name: "Map native Back retains results")
    }

    func testMapBottomPullAdvancesOnceAndReturnsToTop() async throws {
        try await continuationJourney(list: false)
    }

    func testListUsesTheSameBottomPull() async throws {
        try await continuationJourney(list: true)
    }

    func testLastMapActivityDoesNotWrap() async throws {
        let app = launch()
        defer { app.terminate() }
        _ = try await state(in: app) { $0.ready }
        try await open(1, app: app)
        let bottom = try await scrollToBottom(app, expectedID: 1, list: false)
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "activity-continuation-cue").firstMatch.exists,
                       "The last activity must not advertise another activity")
        pull(app, frame: rect(bottom.detailContentFrame), distance: 230)
        let returned = try await state(in: app) { $0.ready }
        XCTAssertEqual(returned.detailID, 1, "Overscroll at the final activity must not wrap to the first")
        XCTAssertEqual(returned.selection, [1, 2, 3])
        capture(app, name: "Last Map activity remains final")
    }

    private func continuationJourney(list: Bool) async throws {
        let app = launch(list: list)
        defer { app.terminate() }
        let initial = try await state(in: app) { $0.ready }
        let ids = list ? initial.listedIDs : initial.candidates
        let first = try XCTUnwrap(ids.first)
        let next = try XCTUnwrap(ids.dropFirst().first)
        try await open(first, app: app, list: list)
        _ = try await state(in: app) { $0.ready && $0.currentID(list: list) == first && $0.detailMaximumOffset > 100 }
        // A fast fling can bounce at the end. Its inertial overscroll must not
        // count as the deliberate pull used by the following gesture.
        detailScroll(in: app).swipeUp(velocity: .fast)
        let flung = try await state(in: app) { $0.ready }
        XCTAssertEqual(flung.currentID(list: list), first, "Momentum must never select another activity")
        let bottom = try await scrollToBottom(app, expectedID: first, list: list)
        capture(app, name: "\(list ? "List" : "Map") pull cue at bottom")
        pull(app, frame: rect(bottom.detailContentFrame), distance: 45)
        let short = try await state(in: app) { $0.ready }
        XCTAssertEqual(short.currentID(list: list), first, "A small rubber-band bounce must cancel")
        pull(app, frame: rect(short.detailContentFrame), distance: 230)
        let advanced = try await state(in: app) { $0.ready && $0.currentID(list: list) == next }
        XCTAssertEqual(advanced.selection, initial.selection)
        XCTAssertEqual(advanced.detailOffset, advanced.detailTopOffset, accuracy: 2,
                       "The next activity must begin at its top")
        if !list {
            XCTAssertEqual(advanced.navigationDepth, 2, "Switching activities must replace one detail, not deepen the stack")
            XCTAssertEqual(advanced.controllerID, initial.controllerID, "Pull-to-next must keep the native Map sheet")
        }
        capture(app, name: "\(list ? "List" : "Map") next activity at top")
        // Settling the new page must not fire another continuation.
        try await Task.sleep(for: .milliseconds(500))
        let settled = try await state(in: app) { $0.ready }
        XCTAssertEqual(settled.currentID(list: list), next)
        if list {
            // Continuing changes the inspected activity; it must not add a
            // destination for each activity to the native navigation history.
            let back = app.buttons["list-detail-back"]
            let exit = back.exists ? back : app.buttons["Close activity details"]
            XCTAssertTrue(exit.isHittable, app.debugDescription)
            exit.tap()
            let returned = try await state(in: app) { $0.ready && $0.inspectedID == -1 }
            XCTAssertEqual(returned.selection, initial.selection)
            XCTAssertTrue(app.buttons["activity-list-row-\(first)"].isHittable,
                          "One Back must return directly to the original List")
            let footerControls = app.buttons.matching(NSPredicate(format: "label == %@ AND identifier IN %@",
                "Clear selection", ["clear-selection", "list-status-bar"])).allElementsBoundByIndex
            XCTAssertTrue(footerControls.contains(where: \.isHittable), "The List selection footer must return")
            capture(app, name: "List single Back after continuation")
        }
    }

    private func launch(list: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--map-rotation-ui-testing", "--map-rotation-expanded",
                               "--activity-continuation-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            + (list ? ["--activity-continuation-list"] : [])
        app.launch()
        return app
    }

    private func open(_ id: Int, app: XCUIApplication, list: Bool = false) async throws {
        let row = app.buttons[list ? "activity-list-row-\(id)" : "map-result-open-\(id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), app.debugDescription)
        row.tap()
        XCTAssertTrue(detailScroll(in: app).waitForExistence(timeout: 10), app.debugDescription)
    }

    private func scrollToBottom(_ app: XCUIApplication, expectedID: Int, list: Bool) async throws -> FixtureState {
        var current = try await state(in: app) { $0.ready }
        for _ in 0..<16 {
            XCTAssertEqual(current.currentID(list: list), expectedID, "Reaching the bottom should not switch activity")
            let remaining = current.detailMaximumOffset - current.detailOffset
            if remaining <= 2 { return current }
            // Native scroll views extend underneath navigation and the List
            // footer. Begin touches in the unobscured content viewport.
            let frame = rect(current.detailContentFrame)
            // A tiny final drag is swallowed by the native pan recognizer's
            // touch slop. A 40pt nudge reaches the boundary without arming the
            // continuation's 64pt *rubber-banded* overscroll threshold.
            pull(app, frame: frame, distance: min(max(40, CGFloat(remaining) + 12), frame.height * 0.5))
            current = try await state(in: app) { $0.ready }
        }
        XCTFail("Could not reach the detail bottom: \(current.detailOffset) / \(current.detailMaximumOffset)")
        return current
    }

    private func pull(_ app: XCUIApplication, frame: CGRect, distance: CGFloat) {
        let viewport = frame.intersection(app.frame)
        let start = coordinate(app, x: viewport.midX, y: viewport.maxY - 40)
        start.press(forDuration: 0.05,
                    thenDragTo: start.withOffset(CGVector(dx: 0, dy: -min(distance, viewport.height - 60))),
                    withVelocity: .slow, thenHoldForDuration: 0.25)
    }

    private func detailScroll(in app: XCUIApplication) -> XCUIElement {
        let marked = app.scrollViews["activity-detail-scroll"]
        if marked.exists { return marked }
        // SwiftUI may propagate the sheet/pane identifier to a contained scroll.
        return app.scrollViews.matching(NSPredicate(format: "identifier IN %@",
            ["map-results-panel", "list-activity-panel"])).allElementsBoundByIndex.first(where: \.isHittable)
            ?? marked
    }

    private func coordinate(_ app: XCUIApplication, x: CGFloat, y: CGFloat) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x - app.frame.minX, dy: y - app.frame.minY))
    }
    private func rect(_ numbers: [Double]) -> CGRect {
        CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
    }

    private struct FixtureState: Decodable {
        let ready: Bool
        let selection: [Int]
        let candidates: [Int]
        let listedIDs: [Int]
        let detailID: Int
        let inspectedID: Int
        let controllerID: String
        let scrollID: String
        let scrollAttached: Bool
        let offset: [Double]
        let sheetFrame: [Double]
        let detailFrame: [Double]
        let detailContentFrame: [Double]
        let detailOffset: Double
        let detailMaximumOffset: Double
        let detailTopOffset: Double
        let navigationDepth: Int
        func currentID(list: Bool) -> Int { list ? inspectedID : detailID }
    }

    private func state(in app: XCUIApplication, timeout: TimeInterval = 15,
                       matching condition: (FixtureState) -> Bool) async throws -> FixtureState {
        let deadline = Date().addingTimeInterval(timeout)
        let probe = app.staticTexts["map-rotation-fixture-state"]
        var latest = "Missing native fixture probe"
        repeat {
            if probe.exists, let value = probe.value as? String {
                latest = value
                let state = try JSONDecoder().decode(FixtureState.self, from: Data(value.utf8))
                if condition(state) { return state }
            }
            try await Task.sleep(for: .milliseconds(100))
        } while Date() < deadline
        XCTFail("Continuation did not reach the expected state: \(latest)\n\(app.debugDescription)")
        throw NSError(domain: "ActivityContinuationUITests", code: 1)
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
        let probe = app.staticTexts["map-rotation-fixture-state"]
        let diagnostic = XCTAttachment(string: probe.value as? String ?? "Missing state")
        diagnostic.name = "\(name) scroll state"
        diagnostic.lifetime = .keepAlways
        add(diagnostic)
    }
}

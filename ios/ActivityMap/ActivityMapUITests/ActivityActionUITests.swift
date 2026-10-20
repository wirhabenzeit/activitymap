import UIKit
import XCTest

/// Action accessibility is checked by the real automation runner. iOS 27 can
/// omit every SwiftUI accessibility node in a hosted test despite visible rows.
@MainActor
final class ActivityActionUITests: XCTestCase {
    private var diagnosticsURL: URL?

    func testActionRowsExposeNamesAvailabilityOrderingAndTouchTargets() async throws {
        continueAfterFailure = false
        for scenario in ["standard", "large-text", "no-gps", "summary", "dark", "landscape", "rtl"] {
            XCUIDevice.shared.orientation = scenario == "landscape" ? .landscapeLeft : .portrait
            let app = launch(scenario)
            defer { app.terminate(); XCUIDevice.shared.orientation = .portrait }
            _ = try await state { $0.ready }
            let scroll = app.scrollViews["activity-actions-detail-scroll"]
            XCTAssertTrue(scroll.waitForExistence(timeout: 10), app.debugDescription)
            let export = app.buttons["activity-export-gpx"]
            reveal(export, in: scroll, app: app)
            let strava = app.buttons["activity-open-in-strava"]
            XCTAssertTrue(strava.exists && export.exists, app.debugDescription)
            XCTAssertTrue(strava.label.hasPrefix("Open in Strava"), strava.label)
            XCTAssertTrue(export.label.hasPrefix("Export GPX"), export.label)
            XCTAssertGreaterThanOrEqual(strava.frame.height, 44)
            XCTAssertGreaterThanOrEqual(export.frame.height, 44)
            XCTAssertGreaterThanOrEqual(export.frame.width, 44)
            XCTAssertLessThanOrEqual(export.frame.width, app.frame.width)
            XCTAssertTrue(strava.isEnabled)
            XCTAssertEqual(export.isEnabled, scenario != "no-gps")
            XCTAssertTrue(export.label.contains(scenario == "no-gps" ? "No GPS route" : "Route only"), export.label)
            XCTAssertTrue(scroll.frame.intersection(app.frame).insetBy(dx: -1, dy: -1).contains(export.frame),
                          "The complete final action must be reachable: \(export.frame), \(scroll.frame)")
            XCTAssertFalse(app.staticTexts["ACTIVITY ACTIONS"].exists)
            XCTAssertFalse(app.staticTexts["Activity actions"].exists)
            if scenario != "large-text" && scenario != "landscape" {
                let geometry = app.descendants(matching: .any).matching(identifier: "activity-metric-geometry").firstMatch
                XCTAssertTrue(geometry.exists, app.debugDescription)
                XCTAssertTrue(geometry.label.contains("Activity, Geometry status"), geometry.label)
                XCTAssertLessThan(geometry.frame.maxY, strava.frame.minY,
                                  "Action rows must follow the final measurement group")
            }
            capture(app, "Activity actions \(scenario)")
        }
    }

    func testGPXSharePresentsNativelyAndCleansUpRepeatedCancellationAndDeparture() async throws {
        continueAfterFailure = false
        let app = launch("standard")
        defer { app.terminate() }
        _ = try await state { $0.ready && $0.exports == 0 }
        let scroll = app.scrollViews["activity-actions-detail-scroll"]
        let export = app.buttons["activity-export-gpx"]
        reveal(export, in: scroll, app: app)
        for pass in 0..<2 {
            XCTAssertTrue(export.isEnabled && export.isHittable)
            export.tap()
            let presented = try await state { $0.sharePresented && $0.exports == 1 && $0.hasFile }
            if UIDevice.current.userInterfaceIdiom == .pad {
                XCTAssertTrue(presented.popoverAnchoredToRow, "The iPad native popover must use the export row as its source")
            }
            capture(app, "Native GPX share \(pass)")
            dismissShare(app)
            _ = try await state { !$0.sharePresented && $0.exports == 0 }
            XCTAssertTrue(export.isEnabled)
        }
        app.buttons["activity-actions-arm-departure"].tap()
        export.tap()
        _ = try await state { !$0.detailVisible && !$0.sharePresented && $0.exports == 0 }
        XCTAssertFalse(export.exists, "Leaving detail removes the native share and its file")
    }

    func testOfflineSampledElevationExportInvalidatesWithoutFetchingStreams() async throws {
        continueAfterFailure = false
        let app = launch("elevation")
        defer { app.terminate() }
        _ = try await state { $0.ready && $0.exports == 0 }
        let scroll = app.scrollViews["activity-actions-detail-scroll"]
        let export = app.buttons["activity-export-gpx"]
        reveal(export, in: scroll, app: app)
        XCTAssertTrue(export.label.contains("Route with elevation"), export.label)
        export.tap()
        let presented = try await state { $0.sharePresented && $0.hasFile }
        XCTAssertTrue(presented.hasSampledElevation, "The shared GPX must contain the cached 400m/450m samples and identify averaged elevation")
        XCTAssertTrue(presented.hasNoTimestamps, "Sampled GPX must not invent recorded timestamps")
        XCTAssertEqual(presented.networkCalls, 0)
        dismissShare(app)
        _ = try await state { !$0.sharePresented && $0.exports == 0 }
        app.buttons["activity-actions-invalidate"].tap()
        for _ in 0..<50 {
            if export.label.contains("Route only") && !export.label.contains("with elevation") { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertTrue(export.isEnabled && export.label.contains("Route only"), export.label)
        let invalidated = try await state { $0.ready }
        XCTAssertEqual(invalidated.networkCalls, 0)
        capture(app, "Offline GPX after summary invalidation")
    }

    private func launch(_ scenario: String) -> XCUIApplication {
        let url = URL(fileURLWithPath: "/tmp/activitymap-actions-ui-\(UUID().uuidString).json")
        diagnosticsURL = url
        let app = XCUIApplication()
        app.launchArguments = ["--activity-actions-ui-testing", "--activity-actions-scenario=\(scenario)",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["ACTIVITYMAP_ACTION_DIAGNOSTICS_PATH"] = url.path
        app.launch()
        return app
    }

    private func reveal(_ element: XCUIElement, in scroll: XCUIElement, app: XCUIApplication) {
        for _ in 0..<12 {
            if element.exists && scroll.frame.intersection(app.frame).insetBy(dx: -1, dy: -1).contains(element.frame) { return }
            scroll.swipeUp()
        }
        XCTFail("The final action did not fit in the scrolling viewport: \(app.debugDescription)")
    }

    private func dismissShare(_ app: XCUIApplication) {
        let close = app.buttons.matching(NSPredicate(format: "label IN %@", ["Close", "Cancel"])).firstMatch
        if close.waitForExistence(timeout: 3) { close.tap() }
        else if UIDevice.current.userInterfaceIdiom == .pad {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.12)).tap()
        } else { app.swipeDown() }
    }

    private struct Diagnostics: Decodable {
        let ready: Bool
        let exports: Int
        let hasFile: Bool
        let hasSampledElevation: Bool
        let hasNoTimestamps: Bool
        let sharePresented: Bool
        let popoverAnchoredToRow: Bool
        let networkCalls: Int
        let detailVisible: Bool
    }

    /// Fixture telemetry reads the actual export bytes/native presenter. It
    /// remains available while UIKit correctly hides background AX in a modal.
    private func state(timeout: TimeInterval = 10, matching condition: (Diagnostics) -> Bool) async throws -> Diagnostics {
        let deadline = Date().addingTimeInterval(timeout)
        var latest = "Fixture diagnostic not available"
        repeat {
            if let diagnosticsURL, let data = try? Data(contentsOf: diagnosticsURL) {
                latest = String(decoding: data, as: UTF8.self)
                let decoded = try JSONDecoder().decode(Diagnostics.self, from: data)
                if condition(decoded) { return decoded }
            }
            try await Task.sleep(for: .milliseconds(100))
        } while Date() < deadline
        XCTFail("Activity action state did not settle: \(latest)")
        throw NSError(domain: "ActivityActionUITests", code: 1)
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

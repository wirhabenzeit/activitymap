import XCTest

/// Scripted gestures over the real shell, reporting main-thread cost from the
/// app's DEBUG PerfProbe. Simulator numbers are for before/after comparison
/// only: absolute frame rates are not representative of devices.
@MainActor
final class ResponsivenessUITests: XCTestCase {
    func testListDetailScroll() async throws {
        try await scrollJourney(list: true)
    }

    func testMapDetailScroll() async throws {
        try await scrollJourney(list: false)
    }

    func testListElevationScrub() async throws {
        try await scrubJourney(list: true)
    }

    func testMapElevationScrub() async throws {
        try await scrubJourney(list: false)
    }

    private func scrollJourney(list: Bool) async throws {
        let (app, report) = launch(list: list)
        defer { app.terminate() }
        let opened = try await openDetail(app, list: list)
        let frame = rect(opened["detailContentFrame"])
        let maximum = opened["detailMaximumOffset"] as? Double ?? 0
        let distance = min(220, maximum * 0.8)
        XCTAssertGreaterThan(distance, 100, "Detail must scroll: \(opened)")
        let x = frame.midX, low = frame.minY + frame.height * 0.85
        try await measure(app, report: report, name: "\(list ? "list" : "map")-detail-scroll") {
            drag(app, from: CGPoint(x: x, y: low), to: CGPoint(x: x, y: low - distance))
            for _ in 0..<4 {
                drag(app, from: CGPoint(x: x, y: low - distance), to: CGPoint(x: x, y: low - distance * 0.25))
                drag(app, from: CGPoint(x: x, y: low - distance * 0.25), to: CGPoint(x: x, y: low - distance))
            }
        }
        let after = try await state(in: app) { $0["ready"] as? Bool == true }
        XCTAssertEqual(after[list ? "inspectedID" : "detailID"] as? Int, 2, "Scrolling must not navigate")
    }

    private func scrubJourney(list: Bool) async throws {
        let (app, report) = launch(list: list)
        defer { app.terminate() }
        _ = try await openDetail(app, list: list)
        let chart = try await elevationChart(in: app)
        let frame = chart.frame.intersection(app.frame)
        let y = frame.minY + min(20, frame.height * 0.15)
        let left = CGPoint(x: frame.minX + frame.width * 0.15, y: y)
        let right = CGPoint(x: frame.minX + frame.width * 0.85, y: y)
        try await measure(app, report: report, name: "\(list ? "list" : "map")-elevation-scrub") {
            for _ in 0..<3 {
                drag(app, from: left, to: right, velocity: 400)
                drag(app, from: right, to: left, velocity: 400)
            }
        }
    }

    // MARK: - Harness

    private func launch(list: Bool) -> (XCUIApplication, URL) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let report = FileManager.default.temporaryDirectory.appendingPathComponent("perf-\(UUID().uuidString).json")
        let app = XCUIApplication()
        app.launchArguments = ["--map-rotation-ui-testing", "--activity-continuation-ui-testing",
                               "--activity-continuation-profile", "--perf-probe", "--perf-dense-profile",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
            + (list ? ["--activity-continuation-list"] : [])
        app.launchEnvironment["ACTIVITYMAP_PERF_PATH"] = report.path
        app.launch()
        return (app, report)
    }

    private func openDetail(_ app: XCUIApplication, list: Bool) async throws -> [String: Any] {
        _ = try await state(in: app) { $0["ready"] as? Bool == true }
        let row = app.buttons[list ? "activity-list-row-2" : "map-result-open-2"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), app.debugDescription)
        row.tap()
        return try await state(in: app) {
            $0["ready"] as? Bool == true && $0[list ? "inspectedID" : "detailID"] as? Int == 2
                && $0["profileReady"] as? Bool == true
        }
    }

    private func measure(_ app: XCUIApplication, report: URL, name: String, gestures: () -> Void) async throws {
        try await Task.sleep(for: .seconds(1))
        try? FileManager.default.removeItem(at: report)
        post("activitymap.perf.reset")
        try await Task.sleep(for: .milliseconds(300))
        gestures()
        try await Task.sleep(for: .milliseconds(500))
        post("activitymap.perf.dump")
        let deadline = Date().addingTimeInterval(5)
        while !FileManager.default.fileExists(atPath: report.path), Date() < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        let data = try Data(contentsOf: report)
        let json = String(decoding: data, as: UTF8.self)
        print("PERF_RESULT \(name) \(json)")
        let attachment = XCTAttachment(string: json)
        attachment.name = "perf \(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func post(_ name: String) {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
                                             CFNotificationName(name as CFString), nil, nil, true)
    }

    /// Holding before release removes inertia, so every run covers the same path.
    private func drag(_ app: XCUIApplication, from start: CGPoint, to end: CGPoint, velocity: CGFloat = 800) {
        coordinate(app, start).press(forDuration: 0.05, thenDragTo: coordinate(app, end),
                                     withVelocity: XCUIGestureVelocity(velocity), thenHoldForDuration: 0.05)
    }

    private func coordinate(_ app: XCUIApplication, _ point: CGPoint) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: point.x - app.frame.minX, dy: point.y - app.frame.minY))
    }

    private func rect(_ value: Any?) -> CGRect {
        let numbers = (value as? [Double]) ?? [0, 0, 0, 0]
        return CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
    }

    private func elevationChart(in app: XCUIApplication) async throws -> XCUIElement {
        let charts = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Elevation profile,"))
        let deadline = Date().addingTimeInterval(10)
        repeat {
            if let chart = charts.allElementsBoundByIndex.first(where: \.isHittable) { return chart }
            try await Task.sleep(for: .milliseconds(100))
        } while Date() < deadline
        XCTFail("A loaded elevation plot must be visible: \(app.debugDescription)")
        throw NSError(domain: "ResponsivenessUITests", code: 1)
    }

    private func state(in app: XCUIApplication, timeout: TimeInterval = 20,
                       matching condition: ([String: Any]) -> Bool) async throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(timeout)
        let probe = app.staticTexts["map-rotation-fixture-state"]
        var latest = "Missing fixture probe"
        repeat {
            if probe.exists, let value = probe.value as? String {
                latest = value
                if let state = try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any],
                   condition(state) { return state }
            }
            try await Task.sleep(for: .milliseconds(100))
        } while Date() < deadline
        XCTFail("Fixture did not reach the expected state: \(latest)")
        throw NSError(domain: "ResponsivenessUITests", code: 2)
    }
}

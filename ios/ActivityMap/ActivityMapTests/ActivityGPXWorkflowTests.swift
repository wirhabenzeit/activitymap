import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct ActivityGPXWorkflowTests {
    @Test func availabilitySharesSampledGPSWithoutPolylineAndFallbackRules() throws {
        let activity = ActivityStoreSelectionTests.activity(Int(StreamFixtures.activityID)!, route: false)
        let cached = try GPXFixtures.cached()
        let source = ActivityGPXExportSource(snapshot: ActivityGPX(activity: activity), summary: cached)
        let sampled = ActivityGPXExportAvailability.prepare(source)
        #expect(sampled.canExport)
        #expect(sampled.subtitle == "Route with elevation")
        #expect(sampled.snapshot?.hasSampledElevation == true)
        let missing = ActivityGPXExportAvailability.prepare(.init(snapshot: ActivityGPX(activity: activity), summary: nil))
        #expect(!missing.canExport && missing.subtitle == "No GPS route")
        #expect(missing.hint == "This activity has no GPS route to export")
        let routed = ActivityStoreSelectionTests.activity(Int(StreamFixtures.activityID)!)
        let malformed = try GPXFixtures.cached(ElevationFixtures.summary(altitude: nil))
        let fallback = ActivityGPXExportAvailability.prepare(.init(snapshot: ActivityGPX(activity: routed), summary: malformed))
        #expect(fallback.canExport && fallback.snapshot?.hasSampledElevation == false && fallback.subtitle == "Route only")
        #expect(fallback.snapshot?.points == ActivityGPX(activity: routed).points)
    }

    @Test func firstOpenPreflightAndDirectActivationUseSampledOnlyGeometry() async throws {
        let gate = GPXWriteGate()
        let controller = ActivityGPXExportController(writer: { try await gate.write($0) })
        let activity = ActivityStoreSelectionTests.activity(Int(StreamFixtures.activityID)!, route: false)
        let summary = try GPXFixtures.cached()
        #expect(ActivityGPXExportAvailability.preflight(activity: activity, summary: summary).canExport)
        let current = ActivityGPXExportSource(snapshot: ActivityGPX(activity: activity), summary: summary)
        controller.export(source: current, current: { current })
        // Lazy menu preparation racing direct activation must not cancel it.
        await controller.prepare(current, current: { current })
        await eventually { await gate.count == 1 }
        let file = try #require(try await gate.finish(0))
        await eventually { !controller.isExporting }
        #expect(controller.file === file)
        #expect(try String(contentsOf: file.url, encoding: .utf8).contains("<ele>"))
        controller.cancel()
        file.remove()
    }

    @Test func backgroundAvailabilityPreparationPreservesPresentedErrorsAndPublishedLease() async throws {
        let controller = ActivityGPXExportController()
        let current = source()
        controller.report(title: "Couldn’t open Strava", message: "Browser unavailable")
        await controller.prepare(current, current: { current })
        #expect(controller.failure?.title == "Couldn’t open Strava")
        let direct = ActivityGPXExportController()
        direct.export(source: current, current: { current })
        await eventually { !direct.isExporting }
        let file = try #require(direct.file)
        #expect(direct.failure == nil)
        // Preparation is allowed to arrive after direct activation completed.
        await direct.prepare(current, current: { current })
        #expect(direct.file === file && FileManager.default.fileExists(atPath: file.url.path))
        direct.cancel()
        file.remove()
    }

    @Test func capturedSourceFencesNilSummaryLogoutAndActivityReplacement() {
        let activity = ActivityStoreSelectionTests.activity(1)
        let store = ActivityStore(activities: [activity])
        let before = ActivityGPXExportSource.capture(activity: activity, store: store)
        store.clearScope()
        store.activities = [activity]
        let after = ActivityGPXExportSource.capture(activity: activity, store: store)
        #expect(before.summary == nil && after.summary == nil)
        #expect(before.snapshot == after.snapshot && before != after)
        store.activities = []
        #expect(ActivityGPXExportSource.capture(activity: activity, store: store).snapshot == nil)
        store.activities = [activity]
        #expect(ActivityGPXExportSource.capture(activity: activity, store: store) != after)
    }

    @Test func changedSourceCannotPublishPreparedAvailability() async {
        let source = source()
        var changed = source
        changed.scopeRevision += 1
        let controller = ActivityGPXExportController()
        await controller.prepare(source, current: { changed })
        #expect(!controller.availability.canExport)
    }

    @Test(arguments: [false, true], [0, 1, 2])
    func staleSuccessAndFailureCannotPublishAfterSummaryOrScopeChange(fails: Bool, change: Int) async throws {
        let gate = GPXWriteGate()
        let controller = ActivityGPXExportController(writer: { try await gate.write($0) })
        var current = source()
        await controller.prepare(current, current: { current })
        controller.export(current: { current })
        await eventually { await gate.count == 1 }
        switch change {
        case 0: current.scopeRevision += 1 // nil -> nil summary on logout
        case 1: current = .init(snapshot: current.snapshot, summary: try GPXFixtures.cached())
        default: current.activitiesRevision += 1 // replacement/deletion, even equal snapshot
        }
        let file = try await gate.finish(0, fails: fails)
        await eventually { !controller.isExporting }
        #expect(controller.file == nil && controller.failure == nil)
        if let file { #expect(!FileManager.default.fileExists(atPath: file.url.path)) }
    }

    @Test(arguments: [false, true])
    func cancelledOldWorkCannotClearNewExportOrItsError(fails: Bool) async throws {
        let gate = GPXWriteGate()
        let controller = ActivityGPXExportController(writer: { try await gate.write($0) })
        let current = source()
        await controller.prepare(current, current: { current })
        controller.export(current: { current })
        await eventually { await gate.count == 1 }
        controller.cancel()
        controller.export(current: { current })
        await eventually { await gate.count == 2 }
        let staleFile = try await gate.finish(0, fails: fails)
        await eventually { await gate.completed == 1 }
        // Give the cancelled main-actor continuation a chance to run while the
        // newer writer remains suspended; it must not reset the newer task.
        for _ in 0..<20 { await Task.yield() }
        #expect(controller.isExporting && controller.file == nil && controller.failure == nil)
        if let staleFile { #expect(!FileManager.default.fileExists(atPath: staleFile.url.path)) }
        let file = try #require(try await gate.finish(1))
        await eventually { !controller.isExporting }
        #expect(controller.file === file)
        controller.cancel()
        #expect(FileManager.default.fileExists(atPath: file.url.path), "A presenter's retained lease survives cancellation")
        file.remove()
        #expect(!FileManager.default.fileExists(atPath: file.url.path))
    }

    @Test func failureAllowsRetryAndSuccessOwnsUniqueTemporaryFile() async throws {
        let gate = GPXWriteGate()
        let controller = ActivityGPXExportController(writer: { try await gate.write($0) })
        let current = source()
        await controller.prepare(current, current: { current })
        controller.export(current: { current })
        await eventually { await gate.count == 1 }
        _ = try await gate.finish(0, fails: true)
        await eventually { !controller.isExporting }
        #expect(controller.failure?.title == "Couldn’t export GPX" && controller.file == nil)
        controller.export(current: { current })
        await eventually { await gate.count == 2 }
        #expect(controller.failure == nil)
        let file = try #require(try await gate.finish(1))
        await eventually { !controller.isExporting }
        #expect(controller.file === file)
        let xml = try String(contentsOf: file.url, encoding: .utf8)
        #expect(xml.contains("<trkpt") && !xml.contains("<ele>"))
        controller.cancel()
        file.remove()
    }

    private func source() -> ActivityGPXExportSource {
        .init(snapshot: ActivityGPX(activity: ActivityStoreSelectionTests.activity(1)), summary: nil)
    }

    private func eventually(_ condition: () async -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async {
        let deadline = ContinuousClock.now + .seconds(3)
        while !(await condition()), ContinuousClock.now < deadline { await Task.yield() }
        #expect(await condition(), sourceLocation: sourceLocation)
    }
}

/// Deliberately ignores cancellation so late success/error paths are exercised.
private actor GPXWriteGate {
    enum Failure: Error { case disk }
    private var requests: [(ActivityGPX, CheckedContinuation<ActivityGPXFile, Error>)] = []
    private(set) var completed = 0
    var count: Int { requests.count }
    func write(_ snapshot: ActivityGPX) async throws -> ActivityGPXFile {
        defer { completed += 1 }
        return try await withCheckedThrowingContinuation { requests.append((snapshot, $0)) }
    }
    func finish(_ index: Int, fails: Bool = false) throws -> ActivityGPXFile? {
        let (snapshot, continuation) = requests[index]
        if fails { continuation.resume(throwing: Failure.disk); return nil }
        let file = try snapshot.write()
        continuation.resume(returning: file)
        return file
    }
}

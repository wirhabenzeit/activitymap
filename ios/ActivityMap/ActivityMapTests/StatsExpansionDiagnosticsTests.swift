import Darwin
import SwiftUI
import Synchronization
import Testing
import UIKit
@testable import ActivityMap

/// Opt-in investigation of #347. No timing thresholds: simulator results are
/// comparative diagnostics, not physical-device performance certification.
/// TEST_RUNNER_ACTIVITYMAP_STATS_DIAGNOSTICS=1 enables this suite.
@MainActor @Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["ACTIVITYMAP_STATS_DIAGNOSTICS"] == "1"))
struct StatsExpansionDiagnosticsTests {
    @Test func measureExpansion() async throws {
        let env = ProcessInfo.processInfo.environment
        let output = URL(fileURLWithPath: env["ACTIVITYMAP_STATS_DIAGNOSTICS_OUTPUT"] ?? "/tmp/activitymap-stats-347")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let library = try GalleryLibrary.load()
        let store = ActivityStore(activities: library.activities, listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-10-04")), timeZone: .gmt)
        store.selectedTab = .stats
        let state = StatsDashboardState()
        await state.load(store: store, request: .init(source: StatsDashboardSource(store), choices: [:], canLoad: true))
        try #require(state.completedTiles.count == StatsDashboard.tiles.count)
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.keyWindow
        defer { previous?.makeKeyAndVisible() }
        var measurements: [[String: Any]] = []
        // Layout work is counted outside the production tile. The control
        // freezes the tile's progress at the target endpoint, while the actual
        // production section still interpolates row frames and neighbor widths.
        // This is deliberately NOT a proposed UI: it isolates descendant work.
        let allCases: [(StatsTileID, StatsToggleOption?)] = [
            (.weeklyVolume, nil), (.monthVsLastMonth, nil), (.yearToDate, nil),
            (.activityCalendar, .sport), (.activityCalendar, .time)
        ]
        let selectedTiles = env["ACTIVITYMAP_STATS_DIAGNOSTICS_TILES"].flatMap { $0.isEmpty ? nil : $0.split(separator: ",").map(String.init) }
        let cases = allCases.filter { selectedTiles?.contains($0.0.rawValue) ?? true }
        let modes = env["ACTIVITYMAP_STATS_DIAGNOSTICS_MODES"].flatMap { $0.isEmpty ? nil : $0.split(separator: ",").map(String.init) }
            ?? ["production", "endpoint-content", "cached-endpoint-content", "no-animation"]
        try #require(!cases.isEmpty && !modes.isEmpty)
        try #require(modes.allSatisfy { ["production", "endpoint-content", "cached-endpoint-content", "no-animation"].contains($0) })
        for width in [402.0, 820.0] {
            for (tile, option) in cases {
                if let option, let definition = StatsDashboard.tiles.first(where: { $0.id == tile }) {
                    state.select(option, for: definition)
                    await state.load(store: store, request: .init(source: StatsDashboardSource(store), choices: state.choices, canLoad: true))
                }
                let group = StatsDashboard.tiles.first { $0.id == tile }!.group
                let cachedContent = Dictionary(uniqueKeysWithValues: StatsDashboard.tiles.filter { $0.group == group }.map { definition in
                    @MainActor func content(expanded: Bool) -> AnyView {
                        AnyView(StatsDashboardTile(tile: definition, option: .constant(state.option(definition.id)),
                                                  displayed: state.face(definition.id, source: StatsDashboardSource(store)),
                                                  today: store.stats.reportingDay, expanded: expanded,
                                                  filtered: false, toggleExpansion: {})
                            .environment(\.statsExpansionProgress, expanded ? 1 : 0))
                    }
                    return (definition.id, StatsDiagnosticCachedContent(collapsed: content(expanded: false), expanded: content(expanded: true)))
                })
                for mode in modes {
                    state.expandedTile = nil
                    let probe = StatsDiagnosticProbe()
                    let root = StatsDiagnosticSection(store: store, state: state, tile: tile,
                                                      columns: width < 760 ? 1 : 2,
                                                      endpointOnly: mode == "endpoint-content" || mode == "cached-endpoint-content",
                                                      cachedContent: mode == "cached-endpoint-content" ? cachedContent : [:], probe: probe)
                        .padding(12)
                        .environment(\.dynamicTypeSize, .large)
                        .environment(\.colorScheme, .light)
                    let host = UIHostingController(rootView: root)
                    host.safeAreaRegions = []
                    let window = UIWindow(windowScene: scene)
                    window.rootViewController = host
                    window.frame = CGRect(x: 0, y: 0, width: width, height: 1180)
                    window.makeKeyAndVisible()
                    host.view.layoutIfNeeded()
                    try await Task.sleep(for: .milliseconds(350))
                    // Warm both endpoints before comparing modes; first-use
                    // chart/text setup must not advantage a later control.
                    for _ in 0..<2 {
                        withAnimation(mode == "no-animation" ? nil : .easeInOut(duration: 0.25)) { state.toggleExpansion(tile) }
                        try await Task.sleep(for: .milliseconds(500))
                    }
                    for expanding in [true, false] {
                        probe.reset()
                        let cpuStart = StatsDiagnosticProbe.cpuTime()
                        let start = CACurrentMediaTime()
                        probe.start = start
                        probe.startDisplayLink()
                        withAnimation(mode == "no-animation" ? nil : .easeInOut(duration: 0.25)) { state.toggleExpansion(tile) }
                        try await Task.sleep(for: .milliseconds(700))
                        probe.stopDisplayLink()
                        let cpuMs = (StatsDiagnosticProbe.cpuTime() - cpuStart) * 1000
                        let gaps = zip(probe.displayTimes, probe.displayTimes.dropFirst()).map { ($1 - $0) * 1000 }
                        let samples = probe.geometry[tile, default: []]
                        try #require(!samples.isEmpty, "No production section geometry was observed")
                        let lastChange = samples.last?.elapsedMs ?? 0
                        let measurement: [String: Any] = [
                            "width": width, "tile": tile.rawValue, "option": state.option(tile)?.rawValue ?? "none",
                            "control": mode,
                            "direction": expanding ? "expand" : "collapse", "processCpuMs": cpuMs,
                            "lastGeometryChangeMs": lastChange, "displayCallbacks": probe.displayTimes.count,
                            "maxDisplayGapMs": gaps.max() ?? 0,
                            "gapsOver33Ms": gaps.filter { $0 > 33.34 }.count,
                            "tileMeasurements": probe.measurements.mapValues { $0 },
                            "geometrySamples": Dictionary(uniqueKeysWithValues: probe.geometry.map { id, samples in (id.rawValue, samples.map {
                                ["elapsedMs": $0.elapsedMs, "progress": $0.progress,
                                 "x": $0.frame.minX, "y": $0.frame.minY,
                                 "width": $0.frame.width, "height": $0.frame.height]
                            }) })
                        ]
                        measurements.append(measurement)
                        print("Stats347 \(width) \(tile.rawValue) \(state.option(tile)?.rawValue ?? "none") \(mode) \(expanding ? "expand" : "collapse"): cpu=\(Int(cpuMs))ms lastGeometry=\(Int(lastChange))ms maxGap=\(Int(gaps.max() ?? 0))ms")
                    }
                    window.isHidden = true
                }
            }
        }
        let result: [String: Any] = [
            "activityCount": library.activities.count, "librarySource": library.source,
            "systemVersion": UIDevice.current.systemVersion, "reportingDay": "2026-10-04",
            "animationDurationMs": 250, "sampleWindowMs": 700,
            "notes": "Preloaded production tiles and section in a simulator; both endpoints warmed before timing; no screenshots or forced layout during timing. Process CPU includes all host threads. Display callbacks measure main-run-loop availability, not GPU presentation. Endpoint-content freezes descendant progress but still constructs tile values each frame; cached-endpoint-content also reuses constructed tile values; no-animation toggles the production section without an animation transaction. Controls are isolation experiments, not proposed implementations.",
            "measurements": measurements
        ]
        try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            .write(to: output.appendingPathComponent("expansion.json"))
    }

    @Test func measureExpandedHeights() async throws {
        let output = URL(fileURLWithPath: ProcessInfo.processInfo.environment["ACTIVITYMAP_STATS_DIAGNOSTICS_OUTPUT"] ?? "/tmp/activitymap-stats-347")
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let store = ActivityStore(activities: try GalleryLibrary.load().activities, listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-10-04")), timeZone: .gmt)
        store.selectedTab = .stats
        let state = StatsDashboardState()
        await state.load(store: store, request: .init(source: StatsDashboardSource(store), choices: [:], canLoad: true))
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.keyWindow
        defer { previous?.makeKeyAndVisible() }
        var heights: [[String: Any]] = []
        // Explicit available content heights, excluding shell/status/home areas.
        // Match the existing production cap (only viewports shorter than 480pt).
        for (width, viewport) in [(402.0, 700.0), (375.0, 580.0), (820.0, 270.0)] {
            for tile in StatsDashboard.tiles where StatsDashboard.expandable(tile.id) {
                let limit = viewport < 480 ? viewport - 170 : nil
                let root = StatsDashboardTile(tile: tile, option: .constant(state.option(tile.id)),
                                              displayed: state.face(tile.id, source: StatsDashboardSource(store)),
                                              today: store.stats.reportingDay, expanded: true,
                                              filtered: false, toggleExpansion: {})
                    .environment(\.statsDetailHeightLimit, limit)
                    .environment(\.dynamicTypeSize, .large)
                    .environment(\.colorScheme, .light)
                    .frame(width: width - 24).fixedSize(horizontal: false, vertical: true)
                let host = UIHostingController(rootView: root)
                host.safeAreaRegions = []
                let window = UIWindow(windowScene: scene)
                window.rootViewController = host
                window.frame = CGRect(x: 0, y: 0, width: width - 24, height: 2000)
                window.makeKeyAndVisible()
                host.view.layoutIfNeeded()
                try await Task.sleep(for: .milliseconds(150))
                let size = host.sizeThatFits(in: CGSize(width: width - 24, height: 10_000))
                heights.append(["width": width, "availableHeight": viewport, "tile": tile.id.rawValue,
                                "tileHeight": size.height, "overflow": max(0, size.height - viewport),
                                "visualHeightLimit": limit as Any? ?? NSNull()])
                window.frame.size.height = ceil(size.height)
                host.view.frame = window.bounds
                host.view.layoutIfNeeded()
                let format = UIGraphicsImageRendererFormat(); format.scale = 1
                let image = UIGraphicsImageRenderer(bounds: host.view.bounds, format: format).image { _ in
                    host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
                }
                try #require(image.pngData()).write(to: output.appendingPathComponent("height-\(Int(width))-\(Int(viewport))-\(tile.id.rawValue).png"))
                window.isHidden = true
            }
        }
        try JSONSerialization.data(withJSONObject: heights, options: [.prettyPrinted, .sortedKeys])
            .write(to: output.appendingPathComponent("heights.json"))
    }
}

private struct StatsDiagnosticSection: View {
    let store: ActivityStore
    let state: StatsDashboardState
    let tile: StatsTileID
    let columns: Int
    let endpointOnly: Bool
    let cachedContent: [StatsTileID: StatsDiagnosticCachedContent]
    let probe: StatsDiagnosticProbe
    var body: some View {
        let group = StatsDashboard.tiles.first { $0.id == tile }!.group
        ScrollView {
            StatsAnimatedSection(tiles: StatsDashboard.tiles.filter { $0.group == group },
                                 expandedTile: state.expandedTile, columns: columns) { definition in
                StatsDiagnosticTile(store: store, state: state, tile: definition, endpointOnly: endpointOnly,
                                    cachedContent: cachedContent[definition.id], probe: probe)
            }
        }
    }
}

private struct StatsDiagnosticTile: View {
    let store: ActivityStore
    let state: StatsDashboardState
    let tile: StatsTileDefinition
    let endpointOnly: Bool
    let cachedContent: StatsDiagnosticCachedContent?
    let probe: StatsDiagnosticProbe
    @Environment(\.statsExpansionProgress) private var progress
    var body: some View {
        StatsDiagnosticMeasurementLayout(id: tile.id, probe: probe) {
          if let cachedContent {
            if state.expandedTile == tile.id { cachedContent.expanded }
            else { cachedContent.collapsed }
          } else {
            StatsDashboardTile(tile: tile, option: .constant(state.option(tile.id)),
                               displayed: state.face(tile.id, source: StatsDashboardSource(store)),
                               today: store.stats.reportingDay, expanded: state.expandedTile == tile.id,
                               filtered: false, toggleExpansion: {})
                .environment(\.statsExpansionProgress, endpointOnly ? (state.expandedTile == tile.id ? 1 : 0) : progress)
          }
        }
        .onGeometryChange(for: StatsDiagnosticGeometry.self) { geometry in
            .init(progress: progress ?? 0, frame: geometry.frame(in: .global))
        } action: { value in
            guard let start = probe.start else { return }
            probe.geometry[tile.id, default: []].append(.init(elapsedMs: (CACurrentMediaTime() - start) * 1000,
                                                             progress: value.progress, frame: value.frame))
        }
    }
}

private struct StatsDiagnosticCachedContent { let collapsed: AnyView; let expanded: AnyView }

nonisolated private struct StatsDiagnosticGeometry: Equatable { let progress: Double; let frame: CGRect }
private struct StatsDiagnosticMeasurementLayout: Layout {
    let id: StatsTileID
    let probe: StatsDiagnosticProbe
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        probe.recordMeasurement(id.rawValue)
        return subviews.first?.sizeThatFits(proposal) ?? .zero
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading, proposal: proposal)
    }
}

@MainActor private final class StatsDiagnosticProbe: NSObject {
    struct Sample { let elapsedMs: Double; let progress: Double; let frame: CGRect }
    var start: Double?
    nonisolated private let counts = Mutex<[String: Int]>([:])
    var measurements: [String: Int] { counts.withLock { $0 } }
    var geometry: [StatsTileID: [Sample]] = [:]
    var displayTimes: [Double] = []
    private var link: CADisplayLink?
    func reset() { start = nil; counts.withLock { $0 = [:] }; geometry = [:]; displayTimes = [] }
    nonisolated func recordMeasurement(_ id: String) { counts.withLock { $0[id, default: 0] += 1 } }
    func startDisplayLink() {
        link = CADisplayLink(target: self, selector: #selector(display))
        link?.add(to: .main, forMode: .common)
    }
    func stopDisplayLink() { link?.invalidate(); link = nil }
    @objc private func display() { displayTimes.append(CACurrentMediaTime()) }
    static func cpuTime() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        return Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec)
            + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1_000_000
    }
}

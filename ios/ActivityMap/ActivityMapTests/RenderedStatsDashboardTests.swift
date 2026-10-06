import SwiftUI
import UIKit
import MapboxMaps
import Testing
@testable import ActivityMap

@MainActor @Suite(.serialized) struct RenderedStatsDashboardTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["ACTIVITYMAP_EXPANSION_FRAMES"] == "1"),
          arguments: ["volume-expand", "volume-collapse", "month-expand", "month-collapse"])
    func captureExpansionFrames(scenario: String) async throws {
        let tile: StatsTileID = scenario.hasPrefix("month") ? .monthVsLastMonth : .weeklyVolume
        let collapsing = scenario.hasSuffix("collapse")
        let library = try GalleryLibrary.load()
        let store = ActivityStore(activities: library.activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-10-04")), timeZone: .gmt)
        store.selectedTab = .stats
        let state = StatsDashboardState()
        await StatsDashboardTests.load(state, store)
        if collapsing { state.toggleExpansion(tile) }
        let host = try StatsDashboardHarness(root: StatsScreen(store: store, dashboard: state)
            .environment(\.colorScheme, .light)
            .environment(\.locale, Locale(identifier: "de_CH")),
            size: CGSize(width: 820, height: 1180))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(300))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(bounds: host.host.view.bounds, format: format)
        func snapshot() -> UIImage {
            // Read the current presentation without forcing a layout/commit.
            renderer.image { _ in host.host.view.drawHierarchy(in: host.host.view.bounds, afterScreenUpdates: false) }
        }
        var frames: [(Double, Double, UIImage)] = [(-1, 0, snapshot())]
        let start = CACurrentMediaTime()
        withAnimation(.easeInOut(duration: 0.25)) { state.toggleExpansion(tile) }
        // Keep images in memory during the animation; PNG encoding/file IO happens afterwards.
        // Actual timestamps and capture costs are recorded rather than claiming exact frame cadence.
        for target in stride(from: 0.0, through: 700.0, by: 25.0) {
            let remaining = target / 1000 - (CACurrentMediaTime() - start)
            // Always yield a display interval: catching up with synchronous
            // snapshots would starve SwiftUI's commits and freeze the animation.
            try await Task.sleep(for: .seconds(max(remaining, 1.0 / 60)))
            let before = CACurrentMediaTime()
            let image = snapshot()
            frames.append(((before - start) * 1000, (CACurrentMediaTime() - before) * 1000, image))
        }
        let path = ProcessInfo.processInfo.environment["ACTIVITYMAP_EXPANSION_OUTPUT"] ?? "/tmp/activitymap-expansion-frames"
        let directory = URL(fileURLWithPath: path).appendingPathComponent(scenario)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var metadata: [[String: Any]] = []
        for (index, frame) in frames.enumerated() {
            let file = String(format: "frame-%02d.png", index)
            try #require(frame.2.pngData()).write(to: directory.appendingPathComponent(file))
            metadata.append(["file": file, "elapsedMs": frame.0, "captureMs": frame.1])
        }
        let manifest: [String: Any] = ["frames": metadata, "durationMs": 250, "width": 820, "height": 1180,
            "activityCount": library.activities.count, "reportingDay": "2026-10-04",
            "capture": "Continuous snapshots of production StatsScreen in a rendered simulator host; state preloaded; no forced layout; actual elapsed capture times."]
        try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
            .write(to: directory.appendingPathComponent("frames.json"))
        #expect(state.expandedTile == (collapsing ? nil : tile) && frames.count == 30)
    }

    @Test
    func chartGeometryFollowsExpansionAndNeighborReflow() async throws {
        let state = StatsDashboardState()
        let probe = StatsAnimationProbe()
        let tiles = StatsDashboard.tiles.filter { $0.group == .now }
        let host = try StatsDashboardHarness(root: ScrollView {
            StatsObservedTestSection(state: state, tiles: tiles, columns: 2) { tile in
                StatsAnimationProbeTile(id: tile.id, expanded: state.expandedTile == tile.id, probe: probe)
            }.padding(12)
        }, size: CGSize(width: 820, height: 1180))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(100))
        // Training volume is the unpaired full-width tile. Expanding This month
        // pairs it with This week, so its chart narrows during the reflow.
        let initialVolumeWidth = try #require(probe.samples[.weeklyVolume]?.last).size.width
        withAnimation(.linear(duration: 0.4)) { state.toggleExpansion(.monthVsLastMonth) }
        try await Task.sleep(for: .milliseconds(500))
        let narrowedVolumeWidth = try #require(probe.samples[.weeklyVolume]?.last).size.width
        #expect(initialVolumeWidth - narrowedVolumeWidth > 300)
        #expect(probe.samples[.weeklyVolume, default: []].contains {
            $0.size.width > narrowedVolumeWidth + 20 && $0.size.width < initialVolumeWidth - 20
        }, "Neighbor charts receive intermediate widths, not just their destination width")
        // Reverse while in flight, then switch to another expanded card.
        withAnimation(.linear(duration: 0.4)) { state.toggleExpansion(.monthVsLastMonth) }
        try await Task.sleep(for: .milliseconds(120))
        withAnimation(.linear(duration: 0.4)) { state.toggleExpansion(.weeklyVolume) }
        try await Task.sleep(for: .milliseconds(500))
        withAnimation(.linear(duration: 0.4)) { state.toggleExpansion(.weeklyVolume) }
        try await Task.sleep(for: .milliseconds(500))
        for id in [StatsTileID.weeklyVolume, .monthVsLastMonth] {
            let samples = probe.samples[id, default: []]
            #expect(samples.filter { $0.progress > 0.1 && $0.progress < 0.9 }.count >= 3,
                    "Both expansion and collapse deliver intermediate content geometry")
            for sample in samples {
                #expect(abs(sample.size.height - (110 + 130 * sample.progress)) < 1,
                        "Swift Charts height follows the section's presented progress")
            }
        }
        #expect(abs(try #require(probe.samples[.weeklyVolume]?.last).size.width - initialVolumeWidth) < 1)
        // No animation transaction (including Reduce Motion) must settle immediately.
        state.toggleExpansion(.monthVsLastMonth)
        try await Task.sleep(for: .milliseconds(80))
        #expect(abs(try #require(probe.samples[.monthVsLastMonth]?.last).size.height - 240) < 1)
    }

    @Test(arguments: [402.0, 820.0], [StatsTileID.weeklyVolume, .monthVsLastMonth])
    func expandedTilesOwnTheirRowWithoutRemounting(width: Double, expanded: StatsTileID) async throws {
        let store: ActivityStore
        if ProcessInfo.processInfo.environment["ACTIVITYMAP_GALLERY_LIBRARY"] != nil {
            store = ActivityStore(activities: try GalleryLibrary.load().activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
            store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-10-04")), timeZone: .gmt)
            store.selectedTab = .stats
        } else {
            store = try StatsDashboardTests.fixture().0
        }
        let state = StatsDashboardState()
        await StatsDashboardTests.load(state, store)
        let source = StatsDashboardSource(store)
        let probe = StatsLayoutProbe()
        let tiles = StatsDashboard.tiles.filter { $0.group == .now }
        let host = try StatsDashboardHarness(root: ScrollView {
            StatsObservedTestSection(state: state, tiles: tiles, columns: width >= 760 ? 2 : 1) { tile in
                    StatsDashboardTile(tile: tile, option: .constant(state.option(tile.id)),
                        displayed: state.face(tile.id, source: source), today: source.today,
                        expanded: state.expandedTile == tile.id, filtered: false, toggleExpansion: {})
                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { probe.frames[tile.id] = $0 }
                        .onAppear { probe.mounts[tile.id, default: 0] += 1 }

            }.padding(12)
        }, size: CGSize(width: width, height: 1180))
        defer { host.close() }
        try await statsWait { probe.frames.count == tiles.count }
        let fullWidth = width - 24
        #expect(abs(try #require(probe.frames[.weeklyVolume]).width - fullWidth) < 1,
                "The last unpaired compact tile fills the row")
        let mounts = probe.mounts
        let originalTop = try #require(probe.frames[expanded]).minY
        if width >= 760 {
            #expect(abs(try #require(probe.frames[.thisWeek]).height - #require(probe.frames[.monthVsLastMonth]).height) < 1,
                    "Compact row surfaces have matching heights")
        }
        try host.capture("flow-collapsed-\(Int(width))")
        withAnimation(.easeInOut(duration: 0.25)) { state.toggleExpansion(expanded) }
        try await Task.sleep(for: .milliseconds(80))
        try host.capture("flow-transition-\(Int(width))-\(expanded.rawValue)")
        try await Task.sleep(for: .milliseconds(400))
        #expect(abs((probe.frames[expanded]?.width ?? 0) - fullWidth) < 1, "Expanded width: \(String(describing: probe.frames[expanded])); expected \(fullWidth)")
        try await Task.sleep(for: .milliseconds(350))
        let selected = try #require(probe.frames[expanded])
        #expect(abs(selected.minY - originalTop) < 1, "Expansion starts at the original row without a scroll jump")
        if width >= 760 && expanded == .weeklyVolume {
            let week = try #require(probe.frames[.thisWeek]), month = try #require(probe.frames[.monthVsLastMonth])
            // Training volume owns its row; the compact pair above it stays put.
            #expect(week.maxY < selected.minY && abs(week.minY - month.minY) < 1)
            #expect(abs(week.width - (fullWidth - 12) / 2) < 1 && abs(week.height - month.height) < 1,
                    "Compact neighbors keep an equal-height row above the expanded tile")
        }
        for tile in tiles where tile.id != expanded {
            let other = try #require(probe.frames[tile.id])
            #expect(other.maxY <= selected.minY || other.minY >= selected.maxY,
                    "Expanded tile never shares a row or overlaps a neighbor")
        }
        #expect(probe.mounts == mounts, "Reflow preserves tile identity and local inspection/picker state")
        try host.capture("flow-\(Int(width))-\(expanded.rawValue)")
        state.toggleExpansion(expanded)
        try await Task.sleep(for: .milliseconds(150))
        #expect(probe.mounts == mounts)
        if width >= 760 {
            let first = try #require(probe.frames[.thisWeek]), second = try #require(probe.frames[.monthVsLastMonth])
            #expect(abs(first.minY - second.minY) < 1 && abs(first.width - (fullWidth - 12) / 2) < 1)
        }
    }

    @Test(arguments: ["phone", "phone-dark", "small-large-text", "tablet", "landscape"])
    func dashboardRendersRealTilesAndRetainsMetricState(variant: String) async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState()
        let size: CGSize = switch variant {
        case "tablet": CGSize(width: 820, height: 1180)
        case "landscape": CGSize(width: 844, height: 390)
        case "small-large-text": CGSize(width: 375, height: 812)
        default: CGSize(width: 402, height: 874)
        }
        let host = try StatsDashboardHarness(root: StatsScreen(store: store, dashboard: state)
            .environment(\.dynamicTypeSize, variant == "small-large-text" ? .accessibility3 : .large)
            .environment(\.colorScheme, variant == "phone-dark" ? .dark : .light), size: size)
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        try await Task.sleep(for: .milliseconds(150))
        let scroll = try #require(host.descendants(UIScrollView.self).first { $0.contentSize.height > $0.bounds.height + 1 })
        #expect(scroll.contentSize.width <= scroll.bounds.width + 1, "No horizontally clipped dashboard")
        try host.capture("overview-\(variant)")
        let tile = try #require(StatsDashboard.tiles.first { $0.id == .weeklyVolume })
        state.select(.time, for: tile)
        state.toggleExpansion(.weeklyVolume)
        try await statsWait {
            if case .volume = state.result(.weeklyVolume, source: StatsDashboardSource(store)) { return true }
            return false
        }
        scroll.setContentOffset(CGPoint(x: 0, y: min(500, scroll.contentSize.height - scroll.bounds.height)), animated: false)
        try await Task.sleep(for: .milliseconds(150))
        try host.capture("expanded-volume-\(variant)")
        scroll.setContentOffset(CGPoint(x: 0, y: scroll.contentSize.height - scroll.bounds.height), animated: false)
        try await Task.sleep(for: .milliseconds(150))
        try host.capture("patterns-\(variant)")
        #expect(state.option(.weeklyVolume) == .time && state.expandedTile == .weeklyVolume)
    }

    @Test(arguments: [false, true])
    func volumeSportTableFitsPhoneAndLargeText(largeText: Bool) async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        guard case .dashboard(.volume(_, _, _, let averages, let history)) = await store.stats.result(.dashboard(.weeklyVolume, .distance), for: store) else {
            Issue.record("Missing volume"); return
        }
        let host = try StatsDashboardHarness(root: ScrollView {
            StatsVolumeDetail(history: history, averages: averages, metric: .distance, range: .constant(.weeks), showTotals: true) { EmptyView() }.padding(12)
        }.environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large), size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(150))
        let scrolls = host.descendants(UIScrollView.self)
        let outer = try #require(scrolls.first)
        #expect(outer.contentSize.width <= outer.bounds.width + 1, "The dashboard does not scroll horizontally")
        if largeText {
            #expect(scrolls.contains { $0.contentSize.width > $0.bounds.width }, "Wide table columns remain reachable by scrolling")
        }
        try host.capture("volume-sport-table-\(largeText ? "large-text" : "phone")")
    }

    @Test(arguments: [false, true])
    func patternDetailsFitPhoneAndLargeText(largeText: Bool) async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState()
        state.select(.allTime, for: try #require(StatsDashboard.tiles.first { $0.id == .sportMix }))
        await StatsDashboardTests.load(state, store)
        let source = StatsDashboardSource(store)
        let host = try StatsDashboardHarness(root: ScrollView {
            VStack {
                ForEach([StatsTileID.distanceVsElevation], id: \.self) { id in
                    StatsDashboardTile(tile: StatsDashboard.tiles.first { $0.id == id }!, option: .constant(state.option(id)),
                        displayed: state.face(id, source: source), today: source.today, expanded: true, filtered: false, toggleExpansion: {})
                }
            }.padding(12)
        }.environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large), size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(150))
        let scrolls = host.descendants(UIScrollView.self)
        let outer = try #require(scrolls.first)
        #expect(outer.contentSize.width <= outer.bounds.width + 1)
        try host.capture("patterns-details-\(largeText ? "large-text" : "phone")")
    }

    @Test(arguments: ["phone", "large-text", "wide"])
    func overviewDetailsFitWithoutHorizontalClipping(variant: String) async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState()
        await StatsDashboardTests.load(state, store)
        let source = StatsDashboardSource(store)
        let width: CGFloat = variant == "wide" ? 900 : 375
        let host = try StatsDashboardHarness(root: ScrollView {
            VStack {
                ForEach([StatsTileID.sportMix, .yearPace, .typicalWeek, .records, .activityCalendar], id: \.self) { id in
                    StatsDashboardTile(tile: StatsDashboard.tiles.first { $0.id == id }!, option: .constant(state.option(id)),
                        displayed: state.face(id, source: source), today: source.today, expanded: [.sportMix, .records, .activityCalendar].contains(id), filtered: false, toggleExpansion: {})
                }
            }.padding(12)
        }.environment(\.dynamicTypeSize, variant == "large-text" ? .accessibility3 : .large), size: CGSize(width: width, height: 874))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(150))
        let outer = try #require(host.descendants(UIScrollView.self).first)
        #expect(outer.contentSize.width <= outer.bounds.width + 1)
        try host.capture("overview-details-\(variant)")
    }

    @Test(arguments: [false, true])
    func selectedCalendarDayFitsInline(largeText: Bool) async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        guard case .dashboard(.calendar(let rolling, let years)) = await store.stats.result(.dashboard(.activityCalendar, .sport), for: store) else {
            Issue.record("Missing calendar"); return
        }
        let selected = try #require(rolling.days.keys.max())
        let host = try StatsDashboardHarness(root: ScrollView {
            StatsCalendarDetail(rolling: rolling, years: years, today: store.stats.reportingDay, option: .sport,
                expanded: true, openActivity: { _ in }, selectedDay: selected).padding(16)
        }.environment(\.dynamicTypeSize, largeText ? .accessibility3 : .large), size: CGSize(width: 375, height: 1100))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(150))
        let outer = try #require(host.descendants(UIScrollView.self).first)
        #expect(outer.contentSize.width <= outer.bounds.width + 1)
        try host.capture("calendar-selected-\(largeText ? "large-text" : "phone")")
    }

    @Test func compactAxesRenderShortWorkoutsAndImperialDistances() async throws {
        let host = try StatsDashboardHarness(root: VStack(spacing: 24) {
            Text("Half-hour workout (hours)")
            StatsPeriodBars(points: [.init(x: 1, value: 0.5, series: "Time", partial: false)],
                expanded: false, label: { _ in "Mon" }, detailLabel: { _ in "Monday" },
                valueLabel: { "\($0) h" })
            Text("Short distance (miles)")
            StatsPeriodBars(points: [.init(x: 1, value: 0.5, series: "Distance", partial: false)],
                expanded: false, label: { _ in "Mon" }, detailLabel: { _ in "Monday" },
                valueLabel: { "\($0 / 1.609344) mi" }, axisValue: { $0 / 1.609344 })
        }.padding().environment(\.locale, Locale(identifier: "en_US")), size: CGSize(width: 402, height: 440))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(200))
        try host.capture("fractional-compact-axes")
    }

    @Test func displayPreferencesRedrawAndSurviveSettingsReopening() async throws {
        let preferences = DisplayPreferences.shared
        let oldUnits = preferences.units, oldDate = preferences.dateFormat, oldAppearance = preferences.appearance
        defer {
            preferences.units = oldUnits; preferences.dateFormat = oldDate; preferences.appearance = oldAppearance
        }
        preferences.units = .metric; preferences.dateFormat = .system; preferences.appearance = .light
        let auth = AuthController()
        let initial = try StatsDashboardHarness(root: AccountSheet(destination: .settings, auth: auth),
                                               size: CGSize(width: 402, height: 874))
        defer { initial.close() }
        try await Task.sleep(for: .milliseconds(150))
        let before = try initial.capture("display-before")
        preferences.units = .imperial; preferences.dateFormat = .iso; preferences.appearance = .dark
        try await Task.sleep(for: .milliseconds(150))
        let after = try initial.capture("display-after")
        #expect(before.pngData() != after.pngData())
        initial.close()
        let reopened = try StatsDashboardHarness(root: AccountSheet(destination: .settings, auth: auth),
                                                size: CGSize(width: 402, height: 874))
        defer { reopened.close() }
        try await Task.sleep(for: .milliseconds(150))
        try reopened.capture("display-reopened")
        let restored = DisplayPreferences()
        #expect(restored.units == .imperial && restored.dateFormat == .iso && restored.appearance == .dark)
    }

    @Test func incompleteVolumeFillStaysBelowItsLine() async throws {
        let start = StatsDates.day("2026-08-31")
        let values = [10_000.0, 5_000, 5_000, 6_000, 7_000]
        let points = values.enumerated().map { index, value in
            StatsChartPoint(x: start + index * 7, value: value, series: "Weekly total", partial: index == values.count - 1)
        }
        let host = try StatsDashboardHarness(root: StatsSeriesChart(points: points, metric: .elevation,
            expanded: false, axis: .date, style: .volume, compact: true)
            .padding(20).frame(width: 378, height: 180).background(.white)
            .environment(\.colorScheme, .light), size: CGSize(width: 378, height: 180))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(150))
        let image = try host.capture("volume-tail-regression")
        let cgImage = try #require(image.cgImage)
        func rgb(x: CGFloat, y: CGFloat) throws -> [UInt8] {
            let crop = try #require(cgImage.cropping(to: CGRect(x: x * image.scale, y: y * image.scale,
                                                               width: 4 * image.scale, height: 4 * image.scale)))
            var bytes = [UInt8](repeating: 0, count: 4)
            try bytes.withUnsafeMutableBytes { buffer in
                let context = try #require(CGContext(data: buffer.baseAddress, width: 1, height: 1,
                    bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                context.draw(crop, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            }
            return Array(bytes.prefix(3))
        }
        // Fixed renderer geometry: neither 4pt sample intersects an axis, a
        // gridline (10'000 at y≈72, 5'000 at y≈115) or the tail (y≈105).
        // Default stacking puts the pale area ABOVE the tail instead of below it.
        #expect(try rgb(x: 300, y: 88).allSatisfy { $0 > 250 }, "No phantom area above the dashed tail")
        #expect(try rgb(x: 300, y: 135).allSatisfy { $0 > 235 && $0 < 250 }, "The pale area remains below the tail")
    }

    @Test func largeTextShellKeepsStatsDestinationReachable() async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let host = try StatsDashboardHarness(root: AppShell(store: store)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.dynamicTypeSize, .accessibility3), size: CGSize(width: 375, height: 812))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(300))
        try host.capture("shell-large-text")
        #expect(store.selectedTab == .stats)
    }

    @Test func pendingMetricChangePreservesDashboardHeightAndScrollPosition() async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState()
        let host = try StatsDashboardHarness(root: StatsScreen(store: store, dashboard: state),
                                              size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        state.toggleExpansion(.weeklyVolume)
        try await Task.sleep(for: .milliseconds(150))
        let scroll = try #require(host.descendants(UIScrollView.self).first { $0.contentSize.height > 1500 })
        scroll.setContentOffset(CGPoint(x: 0, y: 500), animated: false)
        let height = scroll.contentSize.height, offset = scroll.contentOffset.y
        // Hold the new request pending to expose the frame which previously
        // collapsed into a short spinner. This standalone host stays visible.
        store.selectedTab = .map
        state.select(.elevation, for: try #require(StatsDashboard.tiles.first { $0.id == .weeklyVolume }))
        try await Task.sleep(for: .milliseconds(150))
        #expect(abs(scroll.contentSize.height - height) < 1)
        #expect(abs(scroll.contentOffset.y - offset) < 1)
        #expect(state.face(.weeklyVolume, source: StatsDashboardSource(store))?.option == .distance)
        try host.capture("pending-metric-stable")
        store.selectedTab = .stats
        try await statsWait { state.result(.weeklyVolume, source: StatsDashboardSource(store)) != nil }
        #expect(state.face(.weeklyVolume, source: StatsDashboardSource(store))?.option == .elevation)
        #expect(state.expandedTile == .weeklyVolume)
    }

    @Test func realOfflineFailureAndAuthorizationTransitionsKeepTruthfulContent() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        var checkpoint = Fixtures.checkpoint
        checkpoint.lastSyncAt = Date(timeIntervalSince1970: 1)
        try await storage.apply([.upsertActivity(try Fixtures.activity(["id": "1"]))], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([.changes("cursor-1", .failure(.server(code: "temporary", message: "Try later", status: 500, requestID: nil, retryable: false)))])
        let store = ActivityStore(), state = StatsDashboardState()
        let sync = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        sync.setSession(SyncFixtures.session(verified: false), storage: storage)
        await sync.refresh()
        store.selectedTab = .stats
        let host = try StatsDashboardHarness(root: StatsScreen(store: store, sync: sync, dashboard: state),
                                              size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        try host.capture("cached-offline")
        #expect(StatsPresentation(store: store, sync: sync).state == .cached)
        guard case .comparison(let before, _, _, _) = state.result(.yearToDate, source: StatsDashboardSource(store)) else {
            Issue.record("Missing cached comparison"); return
        }
        sync.setSession(SyncFixtures.session(), storage: storage)
        await sync.refresh()
        try await Task.sleep(for: .milliseconds(100))
        try host.capture("error-with-content")
        #expect(StatsPresentation(store: store, sync: sync).hasContent)
        try await statsWait { state.result(.yearToDate, source: StatsDashboardSource(store)) != nil }
        if case .comparison(let after, _, _, _) = state.result(.yearToDate, source: StatsDashboardSource(store)) {
            #expect(after == before, "A failed sync retains the authorized cached values")
        } else { Issue.record("Missing comparison after failure") }
        sync.setSession(SyncFixtures.session(connected: false), storage: storage)
        try await Task.sleep(for: .milliseconds(100))
        try host.capture("unavailable")
        #expect(!StatsPresentation(store: store, sync: sync).hasContent)
        #expect(state.result(.yearToDate, source: StatsDashboardSource(store)) == nil)
    }

    @Test func realDashboardSurvivesShellRoundTripAndStatsResetPreservesBrowsingDates() async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        // Use enough rows to establish a real list scroll position.
        let base = store.activities
        store.activities = (1...360).map { index in
            let original = base[index % base.count]
            var row = ActivityStoreSelectionTests.activity(index, sport: original.sportType, route: false)
            row.name = original.name; row.startDateLocal = original.startDateLocal
            row.distance = original.distance; row.movingTime = original.movingTime
            row.totalElevationGain = original.totalElevationGain
            return row
        }
        let state = StatsDashboardState(), sheets = BrowseSheetPresentation()
        let destination = BrowseStatsDestination { store, sync in AnyView(StatsScreen(store: store, sync: sync, dashboard: state)) }
        let host = try StatsDashboardHarness(root: AppShell(store: store, sheets: sheets, statsContent: destination)
            .environment(\.horizontalSizeClass, .compact), size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        let stats = try #require(host.descendants(UIScrollView.self).first { !($0 is UICollectionView) && $0.contentSize.height > 1500 })
        stats.setContentOffset(CGPoint(x: 0, y: 800), animated: false)
        let statsOffset = stats.contentOffset.y
        state.select(.allTime, for: try #require(StatsDashboard.tiles.first { $0.id == .sportMix }))
        store.selectedTab = .list
        try await statsWait { host.descendants(UICollectionView.self).contains { $0.contentSize.height > 1500 } }
        let list = try #require(host.descendants(UICollectionView.self).first { $0.contentSize.height > 1500 })
        list.setContentOffset(CGPoint(x: 0, y: 700), animated: false)
        let listOffset = list.contentOffset.y, camera = store.mapContext.camera
        let selected = store.activities[0].id
        store.replaceSelection(with: [selected])
        store.selectedTab = .map
        try await Task.sleep(for: .milliseconds(100))
        store.selectedTab = .stats
        try await Task.sleep(for: .milliseconds(100))
        #expect(host.descendants(UIScrollView.self).contains { $0 === stats })
        #expect(abs(stats.contentOffset.y - statsOffset) < 1)
        #expect(state.option(.sportMix) == .allTime)
        store.selectedTab = .list
        try await Task.sleep(for: .milliseconds(100))
        #expect(abs(list.contentOffset.y - listOffset) < 1)
        store.selectedTab = .stats
        store.dateDayRange = ActivityDayRange(start: "2000-01-01", end: "2000-12-31")
        store.searchText = "Ride"
        let dates = store.dateDayRange
        sheets.showsFilters = true
        try await statsWait { host.host.presentedViewController != nil && host.host.presentedViewController?.isBeingPresented == false }
        try host.capture("shell-stats-filters", presented: true)
        FilterScope.stats.reset(store)
        sheets.showsFilters = false
        #expect(store.dateDayRange == dates && store.selectedActivityIDs == [selected])
        #expect(store.mapContext.camera.zoom == camera.zoom)
        #expect(state.option(.sportMix) == .allTime)
        store.clearScope()
        #expect(store.selectedTab == .stats || store.selectedTab == .map)
        #expect(state.result(.sportMix, source: StatsDashboardSource(store)) == nil)
    }
}

@MainActor private func statsWait(_ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(12)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(40)) }
    try #require(condition(), "Stats rendering did not reach the expected state")
}

@MainActor private final class StatsDashboardHarness<Content: View> {
    let window: UIWindow
    let oldWindow: UIWindow?
    let host: UIHostingController<Content>
    init(root: Content, size: CGSize) throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        oldWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        host = UIHostingController(rootView: root)
        window.rootViewController = host; window.makeKeyAndVisible()
        host.view.frame = window.bounds; host.view.layoutIfNeeded()
    }
    func descendants<T: UIView>(_ type: T.Type) -> [T] {
        func visit(_ view: UIView) -> [T] { ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap(visit) }
        return visit(host.view)
    }
    @discardableResult func capture(_ name: String, presented: Bool = false) throws -> UIImage {
        let view = presented ? try #require(host.presentedViewController?.view) : host.view!
        view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: view.bounds).image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        let directory = URL(fileURLWithPath: "/tmp/activitymap-stats-263-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
        return image
    }
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

@MainActor private final class StatsLayoutProbe {
    var frames: [StatsTileID: CGRect] = [:]
    var mounts: [StatsTileID: Int] = [:]
}

@MainActor private final class StatsAnimationProbe {
    nonisolated struct Sample: Equatable { var progress: Double; var size: CGSize }
    var samples: [StatsTileID: [Sample]] = [:]
}
private struct StatsAnimationProbeTile: View {
    let id: StatsTileID
    let expanded: Bool
    let probe: StatsAnimationProbe
    @Environment(\.statsExpansionProgress) private var progress
    var body: some View {
        StatsTileSurface(title: id.rawValue, period: "Animation geometry", expanded: expanded) {
            EmptyView()
        } content: {
            StatsSeriesChart(points: [.init(x: 1, value: 20, series: "Total", partial: false),
                                      .init(x: 2, value: 40, series: "Total", partial: false)],
                             metric: .distance, expanded: expanded, axis: .date, style: .bars, compact: true)
                .onGeometryChange(for: StatsAnimationProbe.Sample.self) { geometry in
                    .init(progress: progress ?? 0, size: geometry.size)
                } action: { probe.samples[id, default: []].append($0) }
        }
    }
}

/// The host's root value is created once; observe expansion in a View body just
/// as StatsScreen does, so the section receives updated animation targets.
private struct StatsObservedTestSection<Content: View>: View {
    let state: StatsDashboardState
    let tiles: [StatsTileDefinition]
    let columns: Int
    @ViewBuilder let content: (StatsTileDefinition) -> Content
    var body: some View {
        StatsAnimatedSection(tiles: tiles, expandedTile: state.expandedTile, columns: columns, content: content)
    }
}

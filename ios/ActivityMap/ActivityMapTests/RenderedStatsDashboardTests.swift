import SwiftUI
import UIKit
import MapboxMaps
import Testing
@testable import ActivityMap

@MainActor @Suite(.serialized) struct RenderedStatsDashboardTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["ACTIVITYMAP_DETAIL_MOTION_COMPARISON"] == "1"))
    func captureListAndStatsNavigationMotion() async throws {
        try await statsWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let landscape = ProcessInfo.processInfo.environment["ACTIVITYMAP_DETAIL_MOTION_LANDSCAPE"] == "1"
        if landscape {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeLeft))
            try await statsWait { scene.interfaceOrientation.isLandscape }
        }
        defer { if landscape { scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) } }
        let library = try GalleryLibrary.load()
        let store = ActivityStore(activities: library.activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-10-07")), timeZone: .gmt)
        store.selectedTab = .list
        let state = StatsDashboardState()
        await StatsDashboardTests.load(state, store)
        let previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = previousToken }
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let host = try StatsDashboardHarness(root: AppShell(store: store, statsContent: destination)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.verticalSizeClass, landscape ? .compact : .regular)
            .environment(\.colorScheme, ProcessInfo.processInfo.environment["ACTIVITYMAP_DETAIL_MOTION_DARK"] == "1" ? .dark : .light)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##)),
            size: landscape ? scene.coordinateSpace.bounds.size : CGSize(width: 402, height: 874))
        defer { host.close() }
        try await statsWait { host.descendants(UICollectionView.self).first?.visibleCells.isEmpty == false }
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["ACTIVITYMAP_DETAIL_MOTION_OUTPUT"]
                            ?? "/tmp/activitymap-detail-motion-comparison")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data().write(to: directory.appendingPathComponent("ready"))
        // An external simctl compositor recording starts before these actions.
        // No snapshots or forced layouts run during the measured transitions.
        let deadline = Date().addingTimeInterval(60)
        while !FileManager.default.fileExists(atPath: directory.appendingPathComponent("recording").path), Date() < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        try #require(FileManager.default.fileExists(atPath: directory.appendingPathComponent("recording").path))
        try await Task.sleep(for: .seconds(2))
        var results: [[String: Any]] = []
        let activity = try #require(store.listedActivities.first)
        for mode in ["list", "stats"] {
            store.selectedTab = mode == "list" ? .list : .stats
            try await Task.sleep(for: .seconds(1))
            let controllers = host.controllers(UINavigationController.self)
            let navigation = try #require(mode == "list" ? controllers.last : controllers.first)
            for repetition in 0..<2 {
                for direction in ["push", "back"] {
                    let probe = StatsNavigationStartProbe(navigation: navigation)
                    let actionTime = Date().timeIntervalSince1970
                    probe.begin()
                    if direction == "push" {
                        if mode == "list" { store.inspect(activity.id) }
                        else { state.toggleExpansion(.weeklyVolume) }
                    } else { navigation.popViewController(animated: true) }
                    try await Task.sleep(for: .milliseconds(1400))
                    probe.end()
                    try await statsWait { navigation.transitionCoordinator == nil && navigation.viewControllers.count == (direction == "push" ? 2 : 1) }
                    results.append(["mode": mode, "direction": direction, "repetition": repetition,
                                    "actionTime": actionTime, "samples": probe.samples,
                                    "viewportWidth": host.host.view.bounds.width,
                                    "viewportHeight": host.host.view.bounds.height,
                                    "safeAreaTop": host.host.view.safeAreaInsets.top,
                                    "navigationControllerCount": controllers.count])
                    try await Task.sleep(for: .milliseconds(350))
                }
            }
        }
        try JSONSerialization.data(withJSONObject: ["results": results, "activityCount": library.activities.count,
            "capture": "Same production AppShell, viewport and library; compositor recording plus display-link presentation geometry; no snapshots or forced layout during motion."],
            options: [.prettyPrinted, .sortedKeys]).write(to: directory.appendingPathComponent("motion.json"))
        try Data().write(to: directory.appendingPathComponent("done"))
        try await Task.sleep(for: .seconds(1))
    }

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
            .environment(\.statsDetailPresentation, .inline)
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

    @Test(arguments: ["phone", "landscape", "large-text"])
    func phoneNavigationKeepsContentPosition(variant: String) async throws {
        try await statsWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let store = ActivityStore(activities: try GalleryLibrary.load().activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-10-07")), timeZone: .gmt)
        store.selectedTab = .stats
        let state = StatsDashboardState()
        await StatsDashboardTests.load(state, store)
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let size = variant == "landscape" ? CGSize(width: 844, height: 390) : CGSize(width: 402, height: 874)
        let previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = previousToken }
        let host = try StatsDashboardHarness(root: AppShell(store: store, statsContent: destination)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.verticalSizeClass, variant == "landscape" ? .compact : .regular)
            .environment(\.dynamicTypeSize, variant == "large-text" ? .accessibility3 : .large)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##)), size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(400))
        let navigation = try #require(host.contentNavigation())
        #expect(host.shellAccountButton() != nil)
        #expect(!navigation.isNavigationBarHidden, "The phone dashboard and detail share a native header")
        let root = try #require(host.descendants(UIScrollView.self, in: navigation.viewControllers[0].view)
            .first { !($0 is UICollectionView) && $0.contentSize.height > 1500 })
        root.setContentOffset(CGPoint(x: 0, y: 500), animated: false)
        let rootOffset = root.contentOffset.y
        try await Task.sleep(for: .milliseconds(100))
        let account = try #require(host.shellAccountButton())
        let accountFrame = host.host.view.convert(account.accessibilityFrame, from: nil)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(bounds: host.host.view.bounds, format: format)
        let capture = ProcessInfo.processInfo.environment["ACTIVITYMAP_STATS_NAVIGATION_FRAMES"] == "1"
        let output = ProcessInfo.processInfo.environment["ACTIVITYMAP_STATS_NAVIGATION_OUTPUT"] ?? "/tmp/activitymap-stats-navigation-frames"
        var detailController: UIViewController?
        var detailGestureDelegate: (any UIGestureRecognizerDelegate)?
        for phase in ["push", "back"] {
            var frames: [(UIImage?, [String: Any])] = []
            let start = CACurrentMediaTime()
            if phase == "push" {
                withAnimation(.default) { state.toggleExpansion(.weeklyVolume) }
            } else {
                navigation.popViewController(animated: true)
            }
            for target in stride(from: 0.0, through: 1000.0, by: 25.0) {
                let remaining = target / 1000 - (CACurrentMediaTime() - start)
                try await Task.sleep(for: .seconds(max(remaining, 1.0 / 60)))
                let before = CACurrentMediaTime()
                let image = capture ? renderer.image { _ in
                    host.host.view.drawHierarchy(in: host.host.view.bounds, afterScreenUpdates: false)
                } : nil
                var sample: [String: Any] = ["elapsedMs": (before - start) * 1000,
                    "captureMs": (CACurrentMediaTime() - before) * 1000,
                    "transitioning": navigation.transitionCoordinator != nil]
                if let account = host.shellAccountButton(),
                   !account.accessibilityFrame.isEmpty {
                    let frame = host.host.view.convert(account.accessibilityFrame, from: nil)
                    sample["accountCenterX"] = frame.midX
                    sample["accountCenterY"] = frame.midY
                    sample["accountWidth"] = frame.width
                    sample["accountHeight"] = frame.height
                }
                if phase == "push", navigation.viewControllers.count == 2 {
                    detailController = navigation.viewControllers[1]
                }
                if let detailController, detailController.view.window != nil,
                   let scroll = host.descendants(UIScrollView.self, in: detailController.view)
                    .first(where: { $0.bounds.height > 100 && $0.window != nil }) {
                    sample["detailSafeAreaTop"] = detailController.view.safeAreaInsets.top
                    sample["detailOffsetY"] = scroll.contentOffset.y
                    sample["detailInsetTop"] = scroll.adjustedContentInset.top
                    sample["detailViewportY"] = scroll.convert(scroll.bounds, to: host.host.view).minY
                    sample["detailContentTopY"] = scroll.convert(.zero, to: host.host.view).y
                    sample["detailViewportHeight"] = scroll.bounds.height
                }
                frames.append((image, sample))
            }
            // Include both the in-flight and settled destination: the old
            // native bar added 10pt only when its push finished.
            // A zoom deliberately transforms the destination's screen position.
            // Its untransformed layout/insets must still stay fixed through it.
            let keys = ["detailSafeAreaTop", "detailOffsetY", "detailInsetTop", "detailViewportHeight"]
            for key in keys {
                let samples = frames.compactMap { $0.1[key] as? CGFloat }
                if phase == "push" { #expect(!samples.isEmpty) }
                if let first = samples.first {
                    #expect(samples.allSatisfy { abs($0 - first) < 1 }, "\(variant) \(phase): \(key) changed during navigation: \(samples)")
                }
            }
            var metadata: [[String: Any]] = []
            if capture {
                let directory = URL(fileURLWithPath: output).appendingPathComponent("zoom-\(variant)-\(phase)")
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                for (index, frame) in frames.enumerated() {
                    let name = String(format: "frame-%02d.png", index)
                    try #require(frame.0?.pngData()).write(to: directory.appendingPathComponent(name))
                    var sample = frame.1
                    sample["file"] = name
                    metadata.append(sample)
                }
                try JSONSerialization.data(withJSONObject: ["frames": metadata, "variant": variant,
                    "width": size.width, "height": size.height, "activityCount": store.activities.count,
                    "capture": "Production AppShell/StatsScreen; UIKit push and Back, no forced layout during capture; actual timestamps."],
                    options: [.prettyPrinted, .sortedKeys]).write(to: directory.appendingPathComponent("frames.json"))
            }
            try await statsWait { navigation.transitionCoordinator == nil && navigation.viewControllers.count == (phase == "push" ? 2 : 1) }
            if phase == "push" {
                #expect(host.shellAccountButton() != nil,
                        "The focused chart retains Settings in its native header")
                #expect(host.shellControl(label: "Filters") != nil)
                #expect(navigation.topViewController?.navigationItem.title == "Training volume")
                let bar = navigation.navigationBar.convert(navigation.navigationBar.bounds, to: host.host.view)
                #expect(abs(bar.minY - host.host.view.safeAreaInsets.top) < 2,
                        "Stats detail takes over the top header instead of adding another row")
                #expect(host.controllers(UINavigationController.self).filter {
                    !$0.isNavigationBarHidden && $0.navigationBar.window != nil
                }.count == 1)
            } else {
                let settledAccount = try #require(host.shellAccountButton())
                let settledFrame = host.host.view.convert(settledAccount.accessibilityFrame, from: nil)
                #expect(abs(settledFrame.midX - accountFrame.midX) < 1 && abs(settledFrame.midY - accountFrame.midY) < 1,
                        "Returning restores the overview's profile button at its original position")
            }
            try host.capture("phone-single-stats-header-\(variant)-\(phase)")
            let gesture = try #require(navigation.interactivePopGestureRecognizer)
            if phase == "push" {
                #expect(gesture.isEnabled)
                #expect(gesture.delegate?.gestureRecognizerShouldBegin?(gesture) == true)
                detailGestureDelegate = gesture.delegate
            } else {
                #expect(gesture.delegate !== detailGestureDelegate, "Leaving detail restores UIKit's gesture delegate")
            }
        }
        #expect(state.expandedTile == nil && abs(root.contentOffset.y - rootOffset) < 1)
    }

    @Test func phoneStatsHeaderCanPresentSettingsFromDetail() async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState(), sheets = BrowseSheetPresentation()
        let previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = previousToken }
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let host = try StatsDashboardHarness(root: AppShell(store: store, sheets: sheets, statsContent: destination)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, .compact), size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        let navigation = try #require(host.contentNavigation())
        try host.capture("phone-header-root")
        state.toggleExpansion(.weeklyVolume)
        try await statsWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        try host.capture("phone-header-detail")
        sheets.accountDestination = .settings
        try await statsWait { host.host.presentedViewController != nil && host.host.presentedViewController?.isBeingPresented == false }
        #expect(state.expandedTile == .weeklyVolume && navigation.viewControllers.count == 2)
        try host.capture("phone-header-detail-settings", presented: true)
        sheets.accountDestination = nil
        try await statsWait { host.host.presentedViewController == nil }
        navigation.popViewController(animated: true)
        try await statsWait { state.expandedTile == nil && navigation.transitionCoordinator == nil }
        sheets.showsFilters = true
        try await statsWait { host.host.presentedViewController != nil && host.host.presentedViewController?.isBeingPresented == false }
        try host.capture("phone-header-root-filters", presented: true)
        sheets.showsFilters = false
        try await statsWait { host.host.presentedViewController == nil }
    }

    /// Opt-in simulator review: cancel a short edge swipe, then press the
    /// actual Back button. Observe UIKit's real interactive coordinator.
    @Test(.enabled(if: ProcessInfo.processInfo.environment["ACTIVITYMAP_STATS_HEADER_INTERACTION"] == "1"))
    func reviewPhoneStatsHeaderGestures() async throws {
        let store = ActivityStore(activities: try GalleryLibrary.load().activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.selectedTab = .stats
        let state = StatsDashboardState()
        await StatsDashboardTests.load(state, store)
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let host = try StatsDashboardHarness(root: AppShell(store: store, statsContent: destination)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##)),
            size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(500))
        let navigation = try #require(host.contentNavigation())
        let root = try #require(host.descendants(UIScrollView.self).first { !($0 is UICollectionView) && $0.contentSize.height > 1500 })
        root.setContentOffset(CGPoint(x: 0, y: 500), animated: false)
        let offset = root.contentOffset.y
        withAnimation(.default) { state.toggleExpansion(.weeklyVolume) }
        try await statsWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        try host.capture("phone-header-interaction-detail")
        var observedInteraction = false, cancelledInteraction = false
        let deadline = Date().addingTimeInterval(180)
        while state.expandedTile != nil, Date() < deadline {
            if !observedInteraction, let transition = navigation.transitionCoordinator, transition.isInteractive {
                observedInteraction = true
                transition.notifyWhenInteractionChanges { context in
                    cancelledInteraction = context.isCancelled
                    #expect(context.isCancelled, "The review starts with a cancelled short edge swipe")
                    #expect(state.expandedTile == .weeklyVolume)
                }
            }
            try await Task.sleep(for: .milliseconds(16))
        }
        try await statsWait { navigation.viewControllers.count == 1 && navigation.transitionCoordinator == nil }
        #expect(observedInteraction && cancelledInteraction)
        #expect(state.expandedTile == nil && abs(root.contentOffset.y - offset) < 1)
        #expect(host.shellAccountButton() != nil)
        try host.capture("phone-header-interaction-back")
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["ACTIVITYMAP_STATS_NAVIGATION_LATENCY"] == "1"))
    func measurePhoneNavigationStart() async throws {
        try await statsWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let library = try GalleryLibrary.load()
        let store = ActivityStore(activities: library.activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-10-07")), timeZone: .gmt)
        store.selectedTab = .stats
        let state = StatsDashboardState()
        await StatsDashboardTests.load(state, store)
        let previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = previousToken }
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let host = try StatsDashboardHarness(root: AppShell(store: store, statsContent: destination)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##)),
            size: CGSize(width: 402, height: 874))
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(500))
        let navigation = try #require(host.contentNavigation())
        var results: [[String: Any]] = []
        // No snapshots or forced layouts while measuring. The display link
        // observes UIKit's presentation layer, rather than its target frame.
        for tile in [StatsTileID.weeklyVolume, .monthVsLastMonth, .yearToDate, .records] {
            for repetition in 0..<3 {
                for direction in ["push", "back"] {
                    let probe = StatsNavigationStartProbe(navigation: navigation)
                    let calculations = store.stats.calculationCount
                    probe.begin()
                    if direction == "push" {
                        withAnimation(.default) { state.toggleExpansion(tile) }
                    } else if repetition < 2 {
                        withAnimation(.default) { state.expandedTile = nil }
                    } else {
                        navigation.popViewController(animated: true)
                    }
                    let actionMs = (CACurrentMediaTime() - probe.start) * 1000
                    try await Task.sleep(for: .milliseconds(1200))
                    probe.end()
                    try await statsWait { navigation.viewControllers.count == (direction == "push" ? 2 : 1) && navigation.transitionCoordinator == nil }
                    let rootStart = probe.samples.first { $0["rootX"] != nil }?["rootX"]
                    let firstMotion = probe.samples.first { sample in
                        if direction == "back", let rootStart, let x = sample["rootX"], abs(x - rootStart) > 1 { return true }
                        guard let x = sample["x"] else { return false }
                        return direction == "push" ? x < 401 : x > 1
                    }
                    let times = probe.samples.compactMap { $0["elapsedMs"] }
                    let gaps = zip(times, times.dropFirst()).map { $1 - $0 }
                    let end = probe.samples.last { $0["transitioning"] == 1 }?["elapsedMs"] ?? 0
                    results.append(["tile": tile.rawValue, "repetition": repetition, "direction": direction,
                        "backAction": repetition < 2 ? "selection binding" : "UIKit pop",
                        "actionMs": actionMs, "firstDisplayMs": times.first ?? 0,
                        "firstVisibleMovementMs": firstMotion?["elapsedMs"] as Any? ?? NSNull(),
                        "lastTransitionSampleMs": end,
                        "maxDisplayGapMs": gaps.max() ?? 0,
                        "newCalculations": store.stats.calculationCount - calculations,
                        "samples": probe.samples])
                    print("Stats navigation \(tile.rawValue) #\(repetition) \(direction): firstDisplay=\(Int(times.first ?? 0))ms, firstMovement=\(firstMotion?["elapsedMs"].map { String(Int($0)) } ?? "not observed")ms, end=\(Int(end))ms, maxGap=\(Int(gaps.max() ?? 0))ms")
                }
                try await Task.sleep(for: .milliseconds(100))
            }
        }
        let output = ProcessInfo.processInfo.environment["ACTIVITYMAP_STATS_NAVIGATION_LATENCY_OUTPUT"] ?? "/tmp/activitymap-stats-navigation-latency.json"
        try JSONSerialization.data(withJSONObject: ["activityCount": library.activities.count, "results": results,
            "capture": "Production shell, preloaded Stats; time from Expand/Back action to first display-link observation of movement, including ancestor presentation transforms. Callback timestamps are an upper bound on visibility when the main thread is busy; no snapshots or forced layout. Simulator comparison, not a physical-device latency budget."],
            options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: output))
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
            .environment(\.statsDetailPresentation, variant == "tablet" ? .inline : .navigation)
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
        try await Task.sleep(for: .milliseconds(600))
        let visibleScroll = try #require(host.descendants(UIScrollView.self).first { $0.bounds.height > 100 })
        visibleScroll.setContentOffset(CGPoint(x: 0, y: max(0, min(500, visibleScroll.contentSize.height - visibleScroll.bounds.height))), animated: false)
        try await Task.sleep(for: .milliseconds(150))
        try host.capture("expanded-volume-\(variant)")
        visibleScroll.setContentOffset(CGPoint(x: 0, y: max(0, visibleScroll.contentSize.height - visibleScroll.bounds.height)), animated: false)
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
            // The window sits under the status bar; ignore its device-specific
            // inset so the sampled geometry is identical on iPhone and iPad.
            .ignoresSafeArea()
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
        // Fixed renderer geometry without safe-area insets: neither 4pt sample
        // intersects an axis, a gridline (10'000 at y≈42, 5'000 at y≈84,
        // 0 at y≈127) or the tail (y≈74 at x=300).
        // Default stacking puts the pale area ABOVE the tail instead of below it.
        #expect(try rgb(x: 300, y: 57).allSatisfy { $0 > 250 }, "No phantom area above the dashed tail")
        #expect(try rgb(x: 300, y: 103).allSatisfy { $0 > 235 && $0 < 250 }, "The pale area remains below the tail")
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

    @Test(arguments: ["portrait", "landscape", "large-text"])
    func phoneDetailNavigationRetainsDashboardAndChoices(variant: String) async throws {
        try await statsWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
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
        let size = variant == "landscape" ? CGSize(width: 844, height: 390) : CGSize(width: 402, height: 874)
        let previousToken = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = previousToken }
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let host = try StatsDashboardHarness(root: AppShell(store: store, statsContent: destination)
            .environment(\.statsDetailPresentation, .navigation)
            .environment(\.horizontalSizeClass, .compact)
            .environment(\.verticalSizeClass, variant == "landscape" ? .compact : .regular)
            .environment(\.mapStyleOverride, MapStyle(json: ##"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#e5e8df"}}]}"##))
            .environment(\.dynamicTypeSize, variant == "large-text" ? .accessibility3 : .large), size: size)
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        let navigation = try #require(host.contentNavigation())
        let root = try #require(host.descendants(UIScrollView.self).first { !($0 is UICollectionView) && $0.contentSize.height > 1500 })
        let firstHeight = root.contentSize.height
        // Publishing the last result precedes SwiftUI's final layout commit.
        try await Task.sleep(for: .milliseconds(300))
        host.host.view.layoutIfNeeded()
        if ProcessInfo.processInfo.environment["ACTIVITYMAP_GALLERY_LIBRARY"] != nil {
            print("Stats dashboard before navigation: initial height \(firstHeight), settled height \(root.contentSize.height)")
        }
        root.setContentOffset(CGPoint(x: 0, y: 500), animated: false)
        let offset = root.contentOffset, height = root.contentSize.height
        let volume = try #require(state.inspection(.weeklyVolume))
        volume.volumeRange = .months
        for id in StatsDashboard.ids where StatsDashboard.expandable(id) {
            if id == .activityCalendar {
                state.inspection(id)?.calendarDay = StatsDashboardSource(store).today
            }
            withAnimation(.default) { state.toggleExpansion(id) }
            do {
                try await statsWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
            } catch {
                print("Stats push failed: variant=\(variant), tile=\(id), selection=\(String(describing: state.expandedTile)), tab=\(store.selectedTab), depth=\(navigation.viewControllers.count)")
                throw error
            }
            try await Task.sleep(for: .milliseconds(100))
            let detailScroll = try #require(host.descendants(UIScrollView.self, in: navigation.viewControllers[1].view).first { $0.bounds.height > 100 })
            #expect(host.shellAccountButton() != nil && navigation.topViewController?.navigationItem.title == StatsDashboard.tiles.first { $0.id == id }?.title)
            #expect(detailScroll !== root, "The tile opens in its own scrolling destination")
            #expect(detailScroll.contentSize.width <= detailScroll.bounds.width + 1)
            #expect(abs(root.contentSize.height - height) < 1, "Opening detail never resizes the dashboard")
            if id == .weeklyVolume {
                state.select(.elevation, for: try #require(StatsDashboard.tiles.first { $0.id == id }))
                try await statsWait { state.face(id, source: StatsDashboardSource(store))?.option == .elevation }
                volume.volumeTotals = true
                #expect(volume.volumeRange == .months)
            }
            if id == .records { state.inspection(id)?.recordsRange = .allTime }
            if id == .activityCalendar {
                #expect(state.inspection(id)?.calendarDay == StatsDashboardSource(store).today)
                state.inspection(id)?.calendarYear = StatsDates.parts(StatsDashboardSource(store).today).year!
            }
            try host.capture("detail-\(id.rawValue)-\(variant)")
            navigation.popViewController(animated: true)
            do {
                try await statsWait { state.expandedTile == nil && navigation.viewControllers.count == 1 && navigation.transitionCoordinator == nil }
            } catch {
                print("Stats pop failed: variant=\(variant), tile=\(id), selection=\(String(describing: state.expandedTile)), tab=\(store.selectedTab), depth=\(navigation.viewControllers.count)")
                throw error
            }
            #expect(host.descendants(UIScrollView.self).contains { $0 === root })
            #expect(abs(root.contentOffset.y - offset.y) < 1, "Back restores the exact dashboard position")
            #expect(abs(root.contentSize.height - height) < 1)
        }
        #expect(state.inspection(.records)?.recordsRange == .allTime)
        #expect(state.inspection(.activityCalendar)?.calendarYear == StatsDates.parts(StatsDashboardSource(store).today).year!)
        #expect(state.option(.weeklyVolume) == .elevation)
        #expect(state.inspection(.weeklyVolume) === volume && volume.volumeTotals && volume.volumeRange == .months)
        state.toggleExpansion(.records)
        try await statsWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        store.clearScope()
        try await statsWait { state.expandedTile == nil && navigation.viewControllers.count == 1 && navigation.transitionCoordinator == nil }
        #expect(state.inspection(.weeklyVolume) !== volume, "Account changes discard inspection state")
    }

    @Test(arguments: ["portrait", "landscape", "expanded"])
    func tabletStatDetailOpensFullWidthFocusPage(orientation: String) async throws {
        let expanded = orientation == "expanded"
        let library = try GalleryLibrary.load()
        let store = ActivityStore(activities: library.activities,
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-10-07")), timeZone: .gmt)
        store.selectedTab = .stats
        let state = StatsDashboardState()
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let size = orientation == "portrait" ? CGSize(width: 834, height: 1194) : CGSize(width: 1194, height: 834)
        let sheets = BrowseSheetPresentation()
        sheets.showsFilters = expanded
        let host = try StatsDashboardHarness(root: AppShell(store: store, sheets: sheets, statsContent: destination)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: size)
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        let navigation = try #require(host.contentNavigation())
        let root = try #require(host.descendants(UIScrollView.self).first {
            !($0 is UICollectionView) && $0.contentSize.height > 1500
        })
        let initialWidth = root.bounds.width
        // The filter rail sits beside the dashboard; the expanded panel is a
        // column because the dashboard is one column (#354).
        let filterWidth = (expanded ? BrowsePaneLayout.filterWidth : FilterRail.width) + 1
        #expect(abs(initialWidth - (size.width - filterWidth)) < 2)
        root.setContentOffset(CGPoint(x: 0, y: 250), animated: false)
        let offset = root.contentOffset.y
        let calculations = store.stats.calculationCount
        let inspection = try #require(state.inspection(.weeklyVolume))
        inspection.volumeRange = .months

        // The chart uses all content width beside the retained filters.
        state.toggleExpansion(.weeklyVolume)
        try await statsWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        let page = try #require(navigation.topViewController)
        #expect(page.preferredTransition != nil, "Regular-width iPad zooms the tile into its focus page")
        let detail = try #require(host.descendants(UIScrollView.self, in: page.view).first { abs($0.bounds.width - initialWidth) < 2 })
        #expect(abs(detail.bounds.width - initialWidth) < 2)
        #expect(state.expandedTile == .weeklyVolume && inspection.volumeRange == .months)
        #expect(sheets.showsFilters == expanded)
        try host.capture("ipad-stats-focus-\(orientation)")

        // Back restores the retained dashboard, its scroll position and the
        // filter visibility without rebuilding or recalculating anything.
        navigation.popViewController(animated: true)
        try await statsWait { state.expandedTile == nil && navigation.transitionCoordinator == nil }
        #expect(host.descendants(UIScrollView.self).contains { $0 === root })
        #expect(abs(root.bounds.width - initialWidth) < 2)
        #expect(abs(root.contentOffset.y - offset) < 1)
        #expect(host.descendants(UIScrollView.self).contains { abs($0.bounds.width - 320) < 2 } == expanded)
        #expect(state.inspection(.weeklyVolume) === inspection && inspection.volumeRange == .months)
        #expect(store.stats.calculationCount == calculations)
        #expect(sheets.showsFilters == expanded, "Focus pages never change filter visibility")

        // Every other expandable tile uses the same full-width page.
        for tile in StatsDashboard.tiles.map(\.id) where StatsDashboard.expandable(tile) && tile != .weeklyVolume {
            state.toggleExpansion(tile)
            try await statsWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
            let page = try #require(navigation.topViewController)
            let detail = try #require(host.descendants(UIScrollView.self, in: page.view).first { abs($0.bounds.width - initialWidth) < 2 })
            #expect(abs(detail.bounds.width - initialWidth) < 2, "\(tile.rawValue)")
            try host.capture("ipad-stats-focus-\(orientation)-\(tile.rawValue)")
            navigation.popViewController(animated: true)
            try await statsWait { state.expandedTile == nil && navigation.transitionCoordinator == nil }
        }
    }

    @Test(arguments: ["portrait", "landscape", "phone", "split-window", "large-text"])
    func statsFocusKeepsFiltersAndDestinationsUsable(scenario: String) async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState(), sheets = BrowseSheetPresentation()
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let size: CGSize = switch scenario {
        case "landscape": CGSize(width: 1194, height: 834)
        case "phone": CGSize(width: 402, height: 874)
        case "split-window": CGSize(width: 600, height: 1000)
        default: CGSize(width: 834, height: 1194)
        }
        let sidebar = ["portrait", "landscape"].contains(scenario)
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let host = try StatsDashboardHarness(root: AppShell(store: store, sheets: sheets, statsContent: destination)
            .environment(\.horizontalSizeClass, scenario == "phone" ? .compact : .regular)
            .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: size)
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        let navigation = try #require(host.contentNavigation())
        let dates = ActivityDayRange(start: "2026-01-01", end: "2026-12-31")
        store.dateDayRange = dates
        state.toggleExpansion(.weeklyVolume)
        try await statsWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        #expect(host.shellAccountButton() != nil)
        sheets.showsFilters = true
        if sidebar {
            try await statsWait { host.descendants(UITextField.self).count == 1 }
            #expect(host.host.presentedViewController == nil)
            #expect(host.descendants(UIScrollView.self).contains { abs($0.bounds.width - 320) < 2 })
        } else {
            try await statsWait { host.host.presentedViewController != nil && host.host.presentedViewController?.isBeingPresented == false }
        }
        store.searchText = "No matching activity"
        try await statsWait { store.statsActivities.isEmpty }
        #expect(state.expandedTile == .weeklyVolume && store.dateDayRange == dates)
        try host.capture("stats-focus-filters-\(scenario)", presented: !sidebar)
        store.resetStatsActivityFilters()
        sheets.showsFilters = false
        if !sidebar { try await statsWait { host.host.presentedViewController == nil } }
        try host.capture("stats-focus-shell-\(scenario)")
        store.selectedTab = .list
        try await statsWait { state.expandedTile == nil && navigation.viewControllers.count == 1 && navigation.transitionCoordinator == nil }
        #expect(store.selectedTab == .list && store.dateDayRange == dates)
    }

    @Test(arguments: ["portrait", "landscape"])
    func filtersStayStationaryDuringStatsFocusTransition(scenario: String) async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState(), sheets = BrowseSheetPresentation()
        sheets.showsFilters = true
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let size = scenario == "landscape" ? CGSize(width: 1194, height: 834) : CGSize(width: 834, height: 1194)
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let host = try StatsDashboardHarness(root: AppShell(store: store, sheets: sheets, statsContent: destination)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: size)
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        let navigation = try #require(host.contentNavigation())
        let field = try #require(host.descendants(UITextField.self).first)
        let filters = try #require(host.descendants(UIScrollView.self).first { abs($0.bounds.width - 320) < 2 })
        let filterFrame = filters.convert(filters.bounds, to: host.host.view)
        let filterOffset = filters.contentOffset
        #expect(!filters.isDescendant(of: navigation.view), "Filters belong to the stationary shell")
        #expect(abs(navigation.view.bounds.width - (size.width - 321)) < 2)
        for phase in ["expand", "back"] {
            if phase == "expand" { withAnimation(.default) { state.toggleExpansion(.weeklyVolume) } }
            else { navigation.popViewController(animated: true) }
            var transitionSamples = 0
            for index in 0..<30 {
                try await Task.sleep(for: .milliseconds(25))
                if navigation.transitionCoordinator != nil { transitionSamples += 1 }
                #expect(host.descendants(UITextField.self).count == 1,
                        "The animation must never introduce a second filter panel")
                #expect(host.descendants(UITextField.self).first === field)
                let layer = filters.layer.presentation() ?? filters.layer
                let frame = layer.convert(layer.bounds, to: host.host.view.layer.presentation() ?? host.host.view.layer)
                #expect(abs(frame.minX - filterFrame.minX) < 1 && abs(frame.minY - filterFrame.minY) < 1)
                #expect(abs(frame.width - filterFrame.width) < 1 && abs(frame.height - filterFrame.height) < 1)
                #expect(filters.contentOffset == filterOffset && sheets.showsFilters)
                if ProcessInfo.processInfo.environment["ACTIVITYMAP_STATS_FILTER_TRANSITION_FRAMES"] == "1" {
                    try host.captureTransitionFrame("filters-\(scenario)-\(phase)", index: index)
                }
            }
            #expect(transitionSamples > 0, "Observe the real in-flight transition, not only its final layout")
            try await statsWait { navigation.transitionCoordinator == nil && navigation.viewControllers.count == (phase == "expand" ? 2 : 1) }
            try host.capture("stationary-filters-\(scenario)-\(phase)")
        }
        #expect(state.expandedTile == nil)
    }

    @Test func tabletFocusPageSurvivesWindowResize() async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState()
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let destination = BrowseStatsDestination { store, _ in AnyView(StatsScreen(store: store, dashboard: state)) }
        let host = try StatsDashboardHarness(root: AppShell(store: store, statsContent: destination)
            .environment(\.horizontalSizeClass, .regular)
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style)), size: CGSize(width: 834, height: 1194))
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        let navigation = try #require(host.contentNavigation())
        state.toggleExpansion(.weeklyVolume)
        try await statsWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        // Crossing the 760pt threshold in either direction keeps the same page.
        for size in [CGSize(width: 600, height: 1194), CGSize(width: 1194, height: 834)] {
            host.window.frame.size = size
            host.host.view.frame = host.window.bounds
            try await Task.sleep(for: .milliseconds(200))
            #expect(navigation.viewControllers.count == 2 && state.expandedTile == .weeklyVolume)
        }
        navigation.popViewController(animated: true)
        try await statsWait { navigation.viewControllers.count == 1 && state.expandedTile == nil && navigation.transitionCoordinator == nil }
        state.toggleExpansion(.records)
        try await statsWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        #expect(state.expandedTile == .records)
    }

    @Test func tabletExpansionKeepsSingleDashboardDestination() async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState()
        let host = try StatsDashboardHarness(root: StatsScreen(store: store, dashboard: state)
            .environment(\.statsDetailPresentation, .inline), size: CGSize(width: 820, height: 1180))
        defer { host.close() }
        try await statsWait { state.completedTiles.count == StatsDashboard.tiles.count }
        let navigation = try #require(host.controllers(UINavigationController.self).first)
        let root = try #require(host.descendants(UIScrollView.self).first { $0.contentSize.height > 1000 })
        let height = root.contentSize.height
        withAnimation(.easeInOut(duration: 0.25)) { state.toggleExpansion(.records) }
        try await Task.sleep(for: .milliseconds(400))
        #expect(navigation.viewControllers.count == 1)
        #expect(root.contentSize.height > height + 100)
    }

    @Test func pendingMetricChangePreservesDashboardHeightAndScrollPosition() async throws {
        let (store, _) = try StatsDashboardTests.fixture()
        let state = StatsDashboardState()
        let host = try StatsDashboardHarness(root: StatsScreen(store: store, dashboard: state)
            .environment(\.statsDetailPresentation, .inline), size: CGSize(width: 402, height: 874))
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
        let scroll = try #require(host.descendants(UIScrollView.self).first { $0.contentSize.height > 1500 })
        scroll.setContentOffset(CGPoint(x: 0, y: 300), animated: false)
        let cachedOffset = scroll.contentOffset
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
            #expect(scroll.contentOffset == cachedOffset,
                    "A sync failure preserves the user's dashboard scroll position")
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
            .environment(\.statsDetailPresentation, .navigation)
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
        let statsNavigation = try #require(host.contentNavigation())
        state.toggleExpansion(.weeklyVolume)
        try await statsWait { statsNavigation.viewControllers.count == 2 && statsNavigation.transitionCoordinator == nil }
        store.selectedTab = .map
        try await statsWait { state.expandedTile == nil && statsNavigation.viewControllers.count == 1 && statsNavigation.transitionCoordinator == nil }
        store.selectedTab = .stats
        try await Task.sleep(for: .milliseconds(100))
        #expect(state.expandedTile == nil && statsNavigation.viewControllers.count == 1)
        state.toggleExpansion(.weeklyVolume)
        try await statsWait { statsNavigation.viewControllers.count == 2 && statsNavigation.transitionCoordinator == nil }
        statsNavigation.popViewController(animated: true)
        try await statsWait { state.expandedTile == nil && statsNavigation.transitionCoordinator == nil }
        #expect(host.descendants(UIScrollView.self).contains { $0 === stats })
        store.clearScope()
        #expect(store.selectedTab == .stats || store.selectedTab == .map)
        #expect(state.result(.sportMix, source: StatsDashboardSource(store)) == nil)
    }
}

@MainActor private final class StatsNavigationStartProbe: NSObject {
    private weak var navigation: UINavigationController?
    private var destination: UIViewController?
    private var root: UIViewController?
    private var link: CADisplayLink?
    private(set) var start = 0.0
    private(set) var samples: [[String: Double]] = []
    init(navigation: UINavigationController) {
        self.navigation = navigation
        root = navigation.viewControllers.first
        if navigation.viewControllers.count == 2 { destination = navigation.topViewController }
    }
    func begin() {
        start = CACurrentMediaTime()
        link = CADisplayLink(target: self, selector: #selector(sample))
        link?.add(to: .main, forMode: .common)
    }
    func end() { link?.invalidate(); link = nil }
    @objc private func sample() {
        var frame = ["elapsedMs": (CACurrentMediaTime() - start) * 1000]
        if let navigation, navigation.viewControllers.count == 2 { destination = navigation.topViewController }
        frame["transitioning"] = navigation?.transitionCoordinator == nil ? 0 : 1
        if let transition = navigation?.transitionCoordinator {
            frame["nativeDurationMs"] = transition.transitionDuration * 1000
            frame["nativeCurve"] = Double(transition.completionCurve.rawValue)
        }
        if let navigation, let root, root.view.window != nil, let layer = root.view.layer.presentation() {
            frame["rootX"] = layer.convert(layer.bounds, to: navigation.view.layer.presentation() ?? navigation.view.layer).minX
        }
        if let navigation, let destination, destination.view.window != nil,
           let layer = destination.view.layer.presentation() {
            // UIKit animates an ancestor transition container. Looking only
            // at the destination's own frame would report its target x = 0.
            frame["x"] = layer.convert(layer.bounds, to: navigation.view.layer.presentation() ?? navigation.view.layer).minX
        }
        samples.append(frame)
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
    func descendants<T: UIView>(_ type: T.Type, in view: UIView? = nil) -> [T] {
        func visit(_ view: UIView) -> [T] { ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap(visit) }
        return visit(view ?? host.view)
    }
    func controllers<T: UIViewController>(_ type: T.Type) -> [T] {
        func visit(_ controller: UIViewController) -> [T] {
            ((controller as? T).map { [$0] } ?? []) + controller.children.flatMap(visit)
        }
        return visit(host)
    }
    func shellAccountButton() -> NSObject? {
        shellControl(label: "Settings")
    }
    func shellControl(label: String) -> NSObject? {
        var visited: Set<ObjectIdentifier> = []
        func visit(_ object: NSObject) -> NSObject? {
            guard visited.insert(ObjectIdentifier(object)).inserted else { return nil }
            if object.accessibilityLabel == label, !object.accessibilityFrame.isEmpty { return object }
            let count = object.accessibilityElementCount()
            if count > 0, count < 1000 {
                for index in 0..<count {
                    if let child = object.accessibilityElement(at: index) as? NSObject,
                       let found = visit(child) { return found }
                }
            }
            if let view = object as? UIView {
                for child in view.subviews { if let found = visit(child) { return found } }
            }
            return nil
        }
        return visit(host.view)
    }
    func contentNavigation() -> UINavigationController? {
        controllers(UINavigationController.self).first
    }
    func captureTransitionFrame(_ name: String, index: Int) throws {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds, format: format).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: false)
        }
        let directory = URL(fileURLWithPath: "/tmp/activitymap-stats-stationary-frames/\(name)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appendingPathComponent(String(format: "frame-%02d.png", index)))
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

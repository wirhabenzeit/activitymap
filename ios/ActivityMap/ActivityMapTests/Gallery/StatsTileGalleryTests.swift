import CryptoKit
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

/// Tile-only review captures, using the production face and production queries.
/// Run with scripts/stats-tile-gallery.sh; ordinary test runs skip this export.
@MainActor @Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["ACTIVITYMAP_STATS_GALLERY"] == "1"))
struct StatsTileGalleryTests {
    @Test func captureTiles() async throws {
        let env = ProcessInfo.processInfo.environment
        let output = URL(fileURLWithPath: try #require(env["ACTIVITYMAP_GALLERY_OUTPUT"]))
        let libraryURL = URL(fileURLWithPath: try #require(env["ACTIVITYMAP_GALLERY_LIBRARY"]))
        let bytes = try Data(contentsOf: libraryURL)
        let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let today = env["ACTIVITYMAP_STATS_GALLERY_DAY"] ?? "2026-09-22"
        let library = try GalleryLibrary.load()
        let store = ActivityStore(activities: library.activities, listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day(today)), timeZone: .gmt)
        store.selectedTab = .stats
        let state = StatsDashboardState()
        await state.load(store: store, request: .init(source: StatsDashboardSource(store), choices: [:], canLoad: true))
        try #require(state.completedTiles.count == StatsDashboard.tiles.count)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.keyWindow
        defer { previous?.makeKeyAndVisible() }
        for tile in StatsDashboard.tiles {
            let face = try #require(state.face(tile.id, source: StatsDashboardSource(store)))
            let modes: [(Bool, StatsHistoryRange)] = tile.id == .weeklyVolume
                ? [(false, .weeks), (true, .weeks), (true, .months), (true, .years)]
                : StatsDashboard.expandable(tile.id) ? [(false, .weeks), (true, .weeks)] : [(false, .weeks)]
            for (expanded, range) in modes {
                let root = StatsDashboardTile(tile: tile, option: .constant(state.option(tile.id)),
                    displayed: face, today: store.stats.reportingDay, expanded: expanded,
                    filtered: false, toggleExpansion: {}, volumeRange: range)
                    .frame(width: 378).fixedSize(horizontal: false, vertical: true)
                    .environment(\.locale, Locale(identifier: "de_CH"))
                    .environment(\.timeZone, TimeZone(identifier: "Europe/Zurich")!)
                    .environment(\.dynamicTypeSize, .large)
                    .environment(\.colorScheme, .light)
                    .environment(\.horizontalSizeClass, .compact)
                let host = UIHostingController(rootView: root)
                // A tile has no screen safe area. Disable the host's inherited
                // status/home insets rather than baking blank strips into crops.
                host.safeAreaRegions = []
                let window = UIWindow(windowScene: scene)
                window.rootViewController = host
                window.frame = CGRect(x: 0, y: 0, width: 378, height: 1500)
                window.makeKeyAndVisible()
                host.view.backgroundColor = .clear
                var size = host.sizeThatFits(in: CGSize(width: 378, height: 10_000))
                try #require(size.height > 100 && size.height < 5000)
                window.frame.size = CGSize(width: 378, height: ceil(size.height))
                host.view.frame = window.bounds
                host.view.layoutIfNeeded()
                // No network/async data remains; allow Swift Charts its layout pass.
                try await Task.sleep(for: .milliseconds(150))
                // Lazy content can refine its intrinsic height on the first layout.
                // Re-measure the actual production tile so captures have no host padding.
                size = host.sizeThatFits(in: CGSize(width: 378, height: 10_000))
                window.frame.size = CGSize(width: 378, height: ceil(size.height))
                host.view.frame = window.bounds
                host.view.layoutIfNeeded()
                let format = UIGraphicsImageRendererFormat()
                format.scale = 2
                let image = UIGraphicsImageRenderer(bounds: host.view.bounds, format: format).image { _ in
                    host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
                }
                let mode = expanded ? (range == .weeks ? "expanded" : "expanded-\(range.rawValue)") : "collapsed"
                let stem = "ios-\(tile.id.rawValue)-\(mode)"
                try #require(image.pngData()).write(to: output.appendingPathComponent(stem + ".png"))
                let metadata: [String: Any] = ["platform": "ios", "tile": tile.id.rawValue,
                    "title": tile.title, "state": mode, "today": today, "fixtureHash": hash,
                    "activityCount": library.activities.count, "width": 378, "height": ceil(size.height),
                    "scale": 2, "option": state.option(tile.id)?.rawValue ?? "none",
                    "capture": "Production SwiftUI tile, isolated at dashboard phone width"]
                try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
                    .write(to: output.appendingPathComponent(stem + ".json"))
                window.isHidden = true
            }
        }
    }
}

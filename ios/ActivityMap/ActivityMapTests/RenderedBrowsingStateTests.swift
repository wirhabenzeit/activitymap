import MapboxMaps
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

extension RenderedRoutePickingTests {
    @Test(arguments: ["phone", "accessibility", "tablet"])
    func browsingCachedStatesKeepMapAndListMounted(layout: String) async throws {
        let token = MapboxOptions.accessToken
        MapboxOptions.accessToken = "pk.offline-test"
        defer { MapboxOptions.accessToken = token }
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity(["id": "1", "name": "Saved activity near midnight"])
        var checkpoint = Fixtures.checkpoint
        checkpoint.lastSyncAt = Date().addingTimeInterval(-30 * 86400)
        checkpoint.freshness = .init(lastSummaryReconciledAt: nil)
        try await storage.apply([.upsertActivity(dto)], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .failure(.serviceUnavailable(retryAfter: 120, requestID: nil))),
        ])
        let store = ActivityStore()
        let sync = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        sync.setSession(SyncFixtures.session(verified: false), storage: storage)
        await sync.refresh()
        let root = NavigationStack { BrowseContent(store: store, sync: sync).navigationTitle("ActivityMap") }
            .environment(\.mapStyleOverride, MapStyle(json: CameraHarness.style))
            .environment(\.dynamicTypeSize, layout == "accessibility" ? .accessibility2 : .large)
        let host = try BrowsingHarness(root: root, size: layout == "tablet" ? CGSize(width: 768, height: 1024) : CGSize(width: 390, height: 844))
        defer { host.close() }
        try await browsingWait { host.descendants(of: MapView.self).first?.mapboxMap.isStyleLoaded == true }
        let map = try #require(host.descendants(of: MapView.self).first)
        try await Task.sleep(for: .milliseconds(150))
        try host.save(name: "\(layout)-offline-map")
        store.selectedTab = .list
        try await Task.sleep(for: .milliseconds(150))
        try host.save(name: "\(layout)-offline-list")
        store.replaceSelection(with: [1])
        store.searchText = "No matching name"
        try await Task.sleep(for: .milliseconds(150))
        #expect(BrowsingPresentation(store: store, sync: sync).empty?.kind == .noMatches)
        try host.save(name: "\(layout)-filtered-list")
        store.selectedTab = .map
        try await Task.sleep(for: .milliseconds(150))
        try host.save(name: "\(layout)-filtered-map")
        store.resetFilters()
        var noGPS = store.activities[0]
        noGPS.coordinates = []
        store.activities = [noGPS]
        try await Task.sleep(for: .milliseconds(150))
        #expect(BrowsingPresentation(store: store, sync: sync).empty?.kind == .noRoutes)
        try host.save(name: "\(layout)-no-gps-map")
        // A transient status change restores the cached DTO but never recreates
        // the retained map/list or loses filter/selection/context.
        sync.setSession(SyncFixtures.session(), storage: storage)
        await sync.refresh()
        try await Task.sleep(for: .milliseconds(150))
        #expect(host.descendants(of: MapView.self).first === map)
        #expect(store.selectedActivityIDs == [1])
        #expect(!sync.canRefresh && sync.status != .expired)
        try host.save(name: "\(layout)-server-wait-map")
    }

    @Test(arguments: ["phone", "accessibility", "tablet"])
    func browsingRecoveryAndTimestampViews(layout: String) async throws {
        let size = layout == "tablet" ? CGSize(width: 768, height: 1024) : CGSize(width: 390, height: 844)
        let statuses: [(String, SyncController.Status, Bool)] = [
            ("loading", .syncing, false), ("empty", .ready, true), ("offline-empty", .offline, false),
            ("failed-empty", .failed("Server temporarily unavailable"), false),
            ("expired", .expired, false), ("disconnected", .disconnected, false),
        ]
        for (name, status, cache) in statuses {
            let presentation = BrowsingPresentation(tab: .list, activityCount: 0, filteredCount: 0, routeCount: 0,
                                                   status: status, hasCompletedCache: cache, canRetry: true)
            let state = try #require(presentation.empty)
            let root = NavigationStack {
                ListScreen(store: ActivityStore(), emptyState: state)
                    .safeAreaInset(edge: .top, spacing: 0) {
                        BrowsingStatusBar(presentation: presentation, failureMessage: nil, recover: { _ in })
                    }
                    .navigationTitle("Activities")
            }.environment(\.dynamicTypeSize, layout == "accessibility" ? .accessibility2 : .large)
            let host = try BrowsingHarness(root: root, size: size)
            try await Task.sleep(for: .milliseconds(150))
            try host.save(name: "\(layout)-\(name)")
            host.close()
        }
        let details = BrowsingPresentation(tab: .list, activityCount: 1, filteredCount: 1, routeCount: 0,
                                           status: .retryAfter(Date().addingTimeInterval(120)), hasCompletedCache: true, canRetry: false,
                                           lastSync: Date().addingTimeInterval(-30 * 86400), reconciliation: nil,
                                           retryAfter: Date().addingTimeInterval(120), photoMetadataCount: 3)
        let root = NavigationStack { BrowsingSyncDetails(presentation: details, failureMessage: nil, recover: { _ in }).navigationTitle("Sync Details") }
            .environment(\.dynamicTypeSize, layout == "accessibility" ? .accessibility2 : .large)
        let host = try BrowsingHarness(root: root, size: size)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(150))
        try host.save(name: "\(layout)-timestamps-and-photo-information")
    }
}

@MainActor
private final class BrowsingHarness<Content: View> {
    let window: UIWindow
    let oldWindow: UIWindow?
    let host: UIHostingController<Content>
    init(root: Content, size: CGSize) throws {
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        oldWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        host = UIHostingController(rootView: root)
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
    }
    func save(name: String) throws {
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true) }
        let directory = URL(fileURLWithPath: "/tmp/activitymap-browsing-preview")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appendingPathComponent("\(name).png"))
    }
    func descendants<T: UIView>(of type: T.Type) -> [T] {
        func visit(_ view: UIView) -> [T] { ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap(visit) }
        return visit(host.view)
    }
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

@MainActor
private func browsingWait(_ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(10)
    while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
    #expect(condition())
}

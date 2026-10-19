#if DEBUG
import Observation
import SwiftUI
import UIKit

/// The real detail/actions and native share presenter in an offline automation
/// host. No account, credentials or production persistence are consulted.
struct ActivityActionsUITestFixture: View {
    @State private var fixture = ActivityActionsUITestState()
    @State private var preferences = DisplayPreferences(defaults: nil)
    private let scenario = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--activity-actions-scenario=") }?
        .components(separatedBy: "=").last ?? "standard"

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                Button("Invalidate summary") { fixture.loader.reset() }
                    .accessibilityIdentifier("activity-actions-invalidate")
                Button("Leave after export") { fixture.leaveAfterExport = true }
                    .accessibilityIdentifier("activity-actions-arm-departure")
            }
            .font(.caption).buttonStyle(.bordered)
            Text(fixture.ready ? "Activity actions fixture ready" : "Preparing activity actions fixture")
                .font(.caption2)
                .accessibilityIdentifier("activity-actions-fixture-state")
                .accessibilityValue(fixture.diagnostics)
            if let failure = fixture.failure { Text(failure).accessibilityIdentifier("activity-actions-fixture-error") }
            if fixture.ready, fixture.detailVisible, let activity = fixture.activity {
                ScrollView {
                    ActivityDetailContent(activity: activity, streamSummaries: fixture.loader)
                }
                .accessibilityIdentifier("activity-actions-detail-scroll")
            } else { Spacer() }
        }
        .environment(preferences)
        .environment(\.locale, Locale(identifier: "en_US"))
        .environment(\.dynamicTypeSize, scenario == "large-text" ? .accessibility3 : .large)
        .environment(\.layoutDirection, scenario == "rtl" ? .rightToLeft : .leftToRight)
        .environment(\.colorScheme, scenario == "dark" ? .dark : .light)
        .background(AppTheme.surface)
        .background(ActivityActionsRootProbe { fixture.root = $0 }.frame(width: 0, height: 0))
        .task {
            await fixture.prepare(scenario)
            while !Task.isCancelled {
                await fixture.sample()
                do { try await Task.sleep(for: .milliseconds(100)) }
                catch { return }
            }
        }
    }
}

private actor ActivityActionsOfflineSource: CompactSummarySource {
    private(set) var calls = 0
    func summary(activityID: String, mode: StreamFetchMode) throws -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummary> {
        calls += 1
        throw APIClient.RequestError.transport("The offline action fixture must never request streams")
    }
}

@MainActor @Observable
private final class ActivityActionsUITestState {
    var activity: Activity?
    let loader: StreamSummaryLoader
    var ready = false
    var failure: String?
    var detailVisible = true
    var leaveAfterExport = false
    var diagnostics = "{}"
    @ObservationIgnored weak var root: UIViewController?
    @ObservationIgnored private let source: ActivityActionsOfflineSource
    @ObservationIgnored private let baseline: Set<URL>
    @ObservationIgnored private var departureAt: Date?
    @ObservationIgnored private var storage: LocalStore?
    @ObservationIgnored private let diagnosticsPath = ProcessInfo.processInfo.environment["ACTIVITYMAP_ACTION_DIAGNOSTICS_PATH"]

    struct Diagnostics: Codable {
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

    init() {
        let source = ActivityActionsOfflineSource()
        self.source = source
        loader = StreamSummaryLoader(source: { _ in source })
        baseline = (try? Self.directories()) ?? []
    }

    func prepare(_ scenario: String) async {
        do {
            let metadata = ActivityMapAPI.StreamMetadata(generation: "actions-fixture", revision: "1", state: .current,
                fetchStatus: .succeeded, availableTypes: [.distance, .latlng, .altitude], fetchedAt: .now, expiresAt: nil)
            var fields: [String: Any] = [
                "id": "1", "athlete": "42", "name": "Morning hike", "sport_type": "Hike",
                "start_date": "2026-09-20T09:12:34.123Z", "start_date_local": "2026-09-20T11:12:34.123Z",
                "timezone": "Europe/Zurich", "distance": 1234.5, "moving_time": 900, "elapsed_time": 1000,
                "total_elevation_gain": 123.4, "average_speed": 1.25,
                "map_polyline": "_p~iF~ps|U_ulLnnqC_mqNvxq`@", "geometry_state": "detailed",
                "max_watts": 456, "weighted_average_watts": 123,
            ]
            if scenario == "elevation" {
                fields["streams"] = try JSONSerialization.jsonObject(with: ActivityMapAPI.makeEncoder().encode(metadata))
            }
            let dto = try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.Activity.self,
                from: JSONSerialization.data(withJSONObject: fields))
            var activity = try StoredModelMapper.activity(dto)
            if scenario == "no-gps" { activity.coordinates = []; activity.geometrySource = .none }
            if scenario == "summary" { activity.geometrySource = .summary }
            if scenario == "elevation" {
                let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
                self.storage = storage
                let session = SyncSession(user: .init(id: "action-fixture", name: nil, email: nil, image: nil,
                    athleteID: "42", stravaConnected: true, stravaPermissions: nil,
                    authentication: .init(method: .bearer, sessionExpiresAt: .now.addingTimeInterval(86400))),
                    token: "offline-fixture-only", deployment: URL(string: "https://example.test")!, verified: false)
                try await storage.apply([.upsertActivity(dto)], scope: session.scope)
                let summary = ActivityMapAPI.StreamSummary(version: 1, basis: .distance, time: [0, 1, 2, 3],
                    distance: [100, 200, 600, 1100], latlng: [[47, 8], [47.001, 8.001], [47.002, 8.003], [47.004, 8.005]],
                    altitude: [400, 410, 405, 450], watts: nil, heartrate: nil)
                let compact = ActivityMapAPI.ActivityCompactStreamSummary(activityID: "1", metadata: metadata,
                    summary: try CompactStreamCodec.encode(summary), lastError: nil, nextRetryAt: nil)
                let fence = await storage.streamFence()
                _ = try await storage.saveStreamSummary(compact, scope: session.scope, fence: fence)
                await loader.configure(session, storage: storage)
                await loader.load(activityID: "1")
            }
            self.activity = activity
            ready = true
        } catch { failure = String(describing: error) }
    }

    func sample() async {
        do {
            let directories = try Self.directories().subtracting(baseline)
            let files = try directories.flatMap { try FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil) }
                .filter { $0.pathExtension == "gpx" }
            let xml = try files.map { try String(contentsOf: $0, encoding: .utf8) }.joined()
            func find(_ controller: UIViewController) -> ActivityGPXSharePresenter.Controller? {
                if let presenter = controller as? ActivityGPXSharePresenter.Controller { return presenter }
                return controller.children.lazy.compactMap(find).first
            }
            let presenter = root.flatMap(find)
            let share = presenter?.activityController
            let presented = share?.presentingViewController != nil && share?.isBeingPresented == false
            let anchor = share?.popoverPresentationController
            let anchored = anchor != nil && anchor?.sourceView === presenter?.view && anchor?.sourceRect == presenter?.view.bounds
                && (anchor?.sourceRect.height ?? 0) >= 44
            if leaveAfterExport && presented {
                departureAt = departureAt ?? .now.addingTimeInterval(0.5)
                if let departureAt, departureAt <= .now { detailVisible = false }
            }
            let state = Diagnostics(ready: ready, exports: directories.count, hasFile: files.contains { $0.lastPathComponent == "Morning-hike.gpx" },
                hasSampledElevation: xml.contains("<ele>400.0</ele>") && xml.contains("<ele>450.0</ele>") && xml.contains("sampled route with averaged elevation"),
                hasNoTimestamps: !xml.contains("<time>"), sharePresented: presented, popoverAnchoredToRow: anchored,
                networkCalls: await source.calls, detailVisible: detailVisible)
            let data = try JSONEncoder().encode(state)
            diagnostics = String(decoding: data, as: UTF8.self)
            if let diagnosticsPath { try data.write(to: URL(fileURLWithPath: diagnosticsPath), options: .atomic) }
        } catch { failure = String(describing: error) }
    }

    private static func directories() throws -> Set<URL> {
        Set(try FileManager.default.contentsOfDirectory(at: FileManager.default.temporaryDirectory,
            includingPropertiesForKeys: nil).filter { $0.lastPathComponent.hasPrefix("activitymap-gpx-") })
    }
}

private struct ActivityActionsRootProbe: UIViewControllerRepresentable {
    var update: (UIViewController) -> Void
    func makeUIViewController(context: Context) -> Controller { Controller(update: update) }
    func updateUIViewController(_ controller: Controller, context: Context) { controller.update = update }
    final class Controller: UIViewController {
        var update: (UIViewController) -> Void
        init(update: @escaping (UIViewController) -> Void) { self.update = update; super.init(nibName: nil, bundle: nil) }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func loadView() { view = UIView(); view.isUserInteractionEnabled = false }
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            if let root = view.window?.rootViewController { update(root) }
        }
    }
}
#endif

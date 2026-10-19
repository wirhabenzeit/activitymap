import Foundation
import Observation

/// Everything that can invalidate an offline export, including nil-summary
/// exports across account changes and removal/recreation of the same activity.
nonisolated struct ActivityGPXExportSource: Hashable, Sendable {
    let snapshot: ActivityGPX?
    let summary: CachedStreamSummary?
    var scopeRevision: Int = 0
    var activitiesRevision: Int = 0
    var summaryRevision: Int = 0

    @MainActor static func capture(activity: Activity, store: ActivityStore? = nil,
                                   summaries: StreamSummaryLoader? = nil) -> Self {
        let loader = store?.streamSummaries ?? summaries
        let current: Activity? = if let store { store.activity(id: activity.id) } else { activity }
        return Self(snapshot: current.map(ActivityGPX.init(activity:)),
                    summary: loader?.currentSummary(for: String(activity.id)),
                    scopeRevision: store?.mapContext.scopeRevision ?? 0,
                    activitiesRevision: store?.activitiesRevision ?? 0,
                    summaryRevision: loader?.sessionRevision ?? 0)
    }
}

/// Body/task identity is constant-size: never copy/hash all route vertices.
nonisolated struct ActivityGPXExportKey: Hashable {
    let activityID: Int
    let scopeRevision: Int
    let activitiesRevision: Int
    let summaryRevision: Int
    let summaryStoredAt: Date?
    let summaryMetadata: ActivityMapAPI.StreamMetadata?
    let name: String
    let description: String?
    let lastUpdated: Date?

    @MainActor init(activity: Activity, store: ActivityStore? = nil, summaries: StreamSummaryLoader? = nil) {
        let loader = store?.streamSummaries ?? summaries
        let cached = loader?.currentSummary(for: String(activity.id))
        activityID = activity.id
        scopeRevision = store?.mapContext.scopeRevision ?? 0
        activitiesRevision = store?.activitiesRevision ?? 0
        summaryRevision = loader?.sessionRevision ?? 0
        summaryStoredAt = cached?.storedAt
        summaryMetadata = cached?.metadata
        name = activity.name
        description = activity.description
        lastUpdated = activity.lastUpdated
    }
}

/// The row menu and detail surface use the same saved geometry and explanation.
nonisolated struct ActivityGPXExportAvailability: Sendable {
    let snapshot: ActivityGPX?
    let canExport: Bool
    let subtitle: String
    var hint: String {
        canExport ? "Share the saved route as a GPX file" : "This activity has no GPS route to export"
    }
    init(snapshot: ActivityGPX?) {
        self.snapshot = snapshot
        canExport = snapshot?.points.isEmpty == false
        subtitle = !canExport ? "No GPS route"
            : snapshot?.hasSampledElevation == true ? "Route with elevation" : "Route only"
    }
    /// A first-open menu can offer export immediately without decoding every
    /// visible row. The worker validates cached samples before writing; malformed
    /// samples fall back to the polyline or the same explicit no-GPS error.
    @MainActor static func preflight(activity: Activity, summary: CachedStreamSummary?) -> Self {
        let sampled = summary?.activityID == String(activity.id) && summary?.isCurrent == true
            && summary?.metadata.state == .current && summary?.codec == "polyline-v1"
            && summary?.algorithmVersion == 1 && summary?.dto.summary?.algorithmVersion == 1
            && summary?.dto.summary?.basis != nil && (summary?.dto.summary?.count ?? 0) > 0
            && summary?.dto.summary?.altitude != nil && summary?.dto.summary?.latlng != nil
        let available = sampled || !activity.coordinates.isEmpty
        return Self(snapshot: nil, canExport: available,
                    subtitle: !available ? "No GPS route" : sampled ? "Route with elevation" : "Route only")
    }
    private init(snapshot: ActivityGPX?, canExport: Bool, subtitle: String) {
        self.snapshot = snapshot; self.canExport = canExport; self.subtitle = subtitle
    }
    static func prepare(_ source: ActivityGPXExportSource) -> Self {
        Self(snapshot: source.snapshot?.includingSampledElevation(from: source.summary))
    }
}

/// Owns preparation and export work; native presentation/anchors stay in views.
@MainActor @Observable
final class ActivityGPXExportController {
    struct Failure: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }
    typealias Writer = @Sendable (ActivityGPX) async throws -> ActivityGPXFile
    private(set) var availability = ActivityGPXExportAvailability(snapshot: nil)
    private(set) var isExporting = false
    var file: ActivityGPXFile?
    var failure: Failure?
    private var preparedKey: ActivityGPXExportKey?
    private var preparedSource: ActivityGPXExportSource?
    private var preparationID: UUID?
    private var publishedSource: ActivityGPXExportSource?
    private var activeSource: ActivityGPXExportSource?
    private var operationID: UUID?
    private var exportTask: Task<Void, Never>?
    private let writer: Writer

    init(writer: @escaping Writer = { snapshot in
        let worker = Task.detached(priority: .userInitiated) { try snapshot.write() }
        return try await withTaskCancellationHandler { try await worker.value } onCancel: { worker.cancel() }
    }) { self.writer = writer }

    func prepared(for key: ActivityGPXExportKey) -> ActivityGPXExportAvailability? {
        preparedKey == key ? availability : nil
    }

    func prepare(_ source: ActivityGPXExportSource, key: ActivityGPXExportKey? = nil, current: @escaping @MainActor () -> ActivityGPXExportSource) async {
        if preparedSource == source { preparedKey = key; return }
        // A menu's lazy preparation may start just after direct accessibility
        // activation. Preparing that same source must not cancel its export.
        if activeSource != source && publishedSource != source { cancel(clearFailure: false) }
        preparedSource = nil
        availability = .init(snapshot: nil)
        let id = UUID()
        preparationID = id
        let worker = Task.detached(priority: .userInitiated) { ActivityGPXExportAvailability.prepare(source) }
        let result = await withTaskCancellationHandler { await worker.value } onCancel: { worker.cancel() }
        guard !Task.isCancelled, preparationID == id, current() == source else { return }
        availability = result
        preparedSource = source
        preparedKey = key
        preparationID = nil
    }

    func export(source: ActivityGPXExportSource? = nil, current: @escaping @MainActor () -> ActivityGPXExportSource) {
        guard !isExporting, file == nil, let source = source ?? preparedSource,
              source == current(), source.snapshot != nil else { return }
        let id = UUID()
        operationID = id
        activeSource = source
        isExporting = true
        failure = nil
        exportTask = Task {
            defer {
                // A cancelled worker may finish after a newer export has begun.
                if operationID == id { operationID = nil; activeSource = nil; isExporting = false; exportTask = nil }
            }
            do {
                let worker = Task.detached(priority: .userInitiated) { ActivityGPXExportAvailability.prepare(source) }
                let prepared = await withTaskCancellationHandler { await worker.value } onCancel: { worker.cancel() }
                try Task.checkCancellation()
                guard operationID == id, current() == source else { return }
                guard prepared.canExport, let snapshot = prepared.snapshot else { throw ActivityGPX.ExportError.noGeometry }
                let result = try await writer(snapshot)
                guard !Task.isCancelled, operationID == id, current() == source else {
                    result.remove() // Never published: this worker owns the entire lease.
                    return
                }
                publishedSource = source
                file = result
            } catch is CancellationError { }
            catch {
                guard !Task.isCancelled, operationID == id, current() == source else { return }
                report(title: "Couldn’t export GPX", message: (error as? ActivityGPX.ExportError)?.localizedDescription
                    ?? "The GPX file couldn’t be created. Please try again.")
            }
        }
    }

    func report(title: String, message: String) { failure = Failure(title: title, message: message) }

    func cancel(clearFailure: Bool = true) {
        preparationID = nil
        operationID = nil
        activeSource = nil
        publishedSource = nil
        if clearFailure { failure = nil }
        exportTask?.cancel()
        exportTask = nil
        isExporting = false
        // The native presenter retains its own lease through dismissal. Do not
        // explicitly remove a published file while UIKit may still be sharing it.
        file = nil
    }
}

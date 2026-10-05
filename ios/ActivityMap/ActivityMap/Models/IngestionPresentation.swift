import Foundation

nonisolated struct IngestionPresentation {
    struct Row: Identifiable {
        var id: String { title }
        let title: String
        let coverage: String
        let counts: String
        let schedule: String
        let reason: String?
        let retryAt: Date?
        let outcome: ActivityMapAPI.IngestionRunOutcome?
    }
    static func rows(_ status: ActivityMapAPI.IngestionStatus) -> [Row] {
        let h = status.history, d = status.details, s = status.streams, p = status.photos
        return [
            Row(title: "Activity history", coverage: progress(h.progress),
                counts: h.totalActivityCount == nil ? "\(h.knownActivityCount) activities imported · Strava total not yet known" : "\(h.knownActivityCount) activities imported · full history discovered",
                schedule: scheduling(h.scheduling), reason: h.schedulingReason.map(reason), retryAt: h.retryAt, outcome: h.lastOutcome),
            Row(title: "Activity details", coverage: progress(d.progress),
                counts: "\(d.detailed) fetched · \(d.neverFetched) awaiting first fetch · \(d.invalidated) awaiting refresh · \(d.retryWaiting) of these waiting to retry",
                schedule: scheduling(d.scheduling), reason: d.schedulingReason.map(reason), retryAt: d.retryAt, outcome: d.lastOutcome),
            Row(title: "Streams & charts", coverage: s.failed > 0 ? "Needs attention" : progress(s.progress),
                counts: "\(s.withData) with data · \(s.withoutData) with no sensor data · \(s.runnable) queued · \(s.waiting) waiting · \(s.blocked) blocked · \(s.failed) failed. \(s.chartSummaries) chart summaries available.",
                schedule: scheduling(s.scheduling), reason: s.schedulingReason.map(reason), retryAt: s.retryAt, outcome: nil),
            Row(title: "Photo metadata", coverage: progress(p.progress),
                counts: "\(p.current) of \(p.activitiesWithPhotos) activities with photos checked · \(p.refreshRequired) awaiting refresh · \(p.unknown) not checked. \(p.photoCount) photo records; image downloads are separate.",
                schedule: scheduling(p.scheduling), reason: p.schedulingReason.map(reason), retryAt: p.retryAt, outcome: nil)
        ]
    }
    static func stale(_ status: ActivityMapAPI.IngestionStatus, now: Date) -> Bool {
        now.timeIntervalSince(status.observedAt) >= 120
    }
    static func progress(_ value: ActivityMapAPI.IngestionProgress) -> String {
        switch value {
        case .notStarted: "Not started"
        case .inProgress: "Partially available"
        case .complete: "Covered"
        case .unknown: "Unknown"
        }
    }
    static func scheduling(_ value: ActivityMapAPI.IngestionScheduling) -> String {
        switch value {
        case .idle: "No work pending"
        case .scheduled: "Automatic processing scheduled"
        case .waiting: "Waiting to retry"
        case .blocked: "Reconnect Strava to continue"
        case .disabled: "Background processing is disabled on the server"
        case .stalled: "Background processing has stopped reporting; contact support if this continues"
        case .notScheduled: "No automatic refresh is scheduled"
        case .unknown: "No background run has been recorded"
        }
    }
    static func reason(_ value: ActivityMapAPI.IngestionReason) -> String {
        switch value {
        case .rateLimited: "Strava request limit reached; processing will resume on a later run"
        case .timeBudget: "More work remains for the next scheduled run"
        case .credentialsUnavailable: "Reconnect Strava to continue"
        case .unauthorized: "Strava rejected the connection; reconnect Strava"
        case .upstreamError: "Strava could not be reached"
        case .invalidResponse: "Strava returned data that could not be read"
        case .detailFailures: "Some activity details could not be fetched and will be retried"
        case .photoRefreshFailed: "Photo metadata could not be refreshed"
        case .historyFetchFailed: "Activity history could not be fetched"
        case .persistenceFailed: "The server could not save the update"
        case .internalError: "The server could not finish processing"
        }
    }
    static func outcome(_ value: ActivityMapAPI.IngestionRunOutcome) -> String {
        let title: String
        switch value.outcome {
        case .succeeded: title = "Last run succeeded"
        case .partial: title = "Last run partly succeeded"
        case .deferred: title = "Last run deferred"
        case .failed: title = "Last run failed"
        case .blocked: title = "Last run blocked"
        }
        return title + (value.reason.map { ": " + reason($0) } ?? "")
    }
}

nonisolated extension IngestionPresentation {
    struct CoverageProgress: Equatable {
        let completed: Int
        let total: Int
        var fraction: Double { Double(completed) / Double(total) }
        var percent: Double { floor(fraction * 1000) / 10 }
        var percentage: String { percent.formatted(.number.precision(.fractionLength(0...1))) + "%" }
    }
    struct Summary {
        let title: String
        let count: String
        let status: String
        var progress: CoverageProgress? = nil
    }
    static func coverageProgress(_ completed: Int?, total: Int) -> CoverageProgress? {
        guard let completed, total > 0 else { return nil }
        return CoverageProgress(completed: min(total, max(0, completed)), total: total)
    }
    static func summaries(_ value: ActivityMapAPI.IngestionStatus) -> [Summary] {
        let h = value.history, d = value.details, s = value.streams, p = value.photos
        return [
            Summary(title: "History", count: "\(h.knownActivityCount.formatted()) imported" + (h.totalActivityCount == nil ? " · total unknown" : ""), status: compactStatus(h.progress, h.scheduling, outcome: h.lastOutcome)),
            Summary(title: "Details", count: "\(d.detailed.formatted()) of \(h.knownActivityCount.formatted()) ready", status: compactStatus(d.progress, d.scheduling, outcome: d.lastOutcome), progress: coverageProgress(d.detailed, total: h.knownActivityCount)),
            Summary(title: "Streams", count: "\((s.withData + s.withoutData).formatted()) of \(h.knownActivityCount.formatted()) checked", status: s.failed > 0 ? "Needs attention" : compactStatus(s.progress, s.scheduling), progress: coverageProgress(s.withData + s.withoutData, total: h.knownActivityCount)),
            Summary(title: "Photos", count: p.activitiesWithPhotos == 0 ? "No photos reported" : p.activitiesWithStoredPhotos.map { "\($0.formatted()) of \(p.activitiesWithPhotos.formatted()) activities have photos available" } ?? "Photo availability not reported by this server", status: compactStatus(p.progress, p.scheduling), progress: coverageProgress(p.activitiesWithStoredPhotos, total: p.activitiesWithPhotos))
        ]
    }
    static func compactStatus(_ progress: ActivityMapAPI.IngestionProgress, _ scheduling: ActivityMapAPI.IngestionScheduling, outcome: ActivityMapAPI.IngestionRunOutcome? = nil) -> String {
        switch scheduling {
        case .blocked: return "Reconnect"
        case .disabled: return "Paused"
        case .stalled: return "Needs attention"
        case .unknown: return "Schedule unknown"
        case .waiting: return "Waiting"
        case .notScheduled: return "Refresh pending"
        case .scheduled:
            if outcome?.outcome == .deferred && outcome?.reason == .rateLimited { return "Waiting" }
            return progress == .complete ? "Checking" : progress == .notStarted ? "Queued" : "Importing"
        case .idle: return progress == .complete ? "Ready" : progress == .unknown ? "Unknown" : "Not started"
        }
    }
}

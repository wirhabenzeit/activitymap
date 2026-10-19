import Foundation

nonisolated struct IngestionPresentation {
    struct Row: Identifiable {
        let id: String
        let title: String
        let coverage: String
        let counts: String
        let schedule: String
        let reason: String?
        let retryAt: Date?
        let outcome: ActivityMapAPI.IngestionRunOutcome?
    }
    static func rows(_ status: ActivityMapAPI.IngestionStatus, locale: Locale = .current) -> [Row] {
        let h = status.history, d = status.details, s = status.streams, p = status.photos
        return [
            Row(id: "history", title: String(localized: AppMessages.statusPipelineHistory(locale: locale)), coverage: progress(h.progress, locale: locale),
                counts: h.totalActivityCount == nil ? String(localized: AppMessages.statusHistoryUnknown(h.knownActivityCount, locale: locale)) : String(localized: AppMessages.statusHistoryComplete(h.knownActivityCount, locale: locale)),
                schedule: scheduling(h.scheduling, locale: locale), reason: h.schedulingReason.map { reason($0, locale: locale) }, retryAt: h.retryAt, outcome: h.lastOutcome),
            Row(id: "details", title: String(localized: AppMessages.statusPipelineDetails(locale: locale)), coverage: progress(d.progress, locale: locale),
                counts: String(localized: AppMessages.statusDetailsCounts(d.detailed, d.neverFetched, d.invalidated, d.retryWaiting, locale: locale)),
                schedule: scheduling(d.scheduling, locale: locale), reason: d.schedulingReason.map { reason($0, locale: locale) }, retryAt: d.retryAt, outcome: d.lastOutcome),
            Row(id: "streams", title: String(localized: AppMessages.statusPipelineStreams(locale: locale)), coverage: s.failed > 0 ? String(localized: AppMessages.statusCompactNeedsAttention(locale: locale)) : progress(s.progress, locale: locale),
                counts: String(localized: AppMessages.statusStreamsCounts(s.withData, s.withoutData, s.runnable, s.waiting, s.blocked, s.failed, s.chartSummaries, locale: locale)),
                schedule: scheduling(s.scheduling, locale: locale), reason: s.schedulingReason.map { reason($0, locale: locale) }, retryAt: s.retryAt, outcome: nil),
            Row(id: "photos", title: String(localized: AppMessages.statusPipelinePhotos(locale: locale)), coverage: progress(p.progress, locale: locale),
                counts: String(localized: AppMessages.statusPhotosCounts(p.current, p.activitiesWithPhotos, p.refreshRequired, p.unknown, p.photoCount, locale: locale)),
                schedule: scheduling(p.scheduling, locale: locale), reason: p.schedulingReason.map { reason($0, locale: locale) }, retryAt: p.retryAt, outcome: nil)
        ]
    }
    static func stale(_ status: ActivityMapAPI.IngestionStatus, now: Date) -> Bool {
        now.timeIntervalSince(status.observedAt) >= 120
    }
    static func progress(_ value: ActivityMapAPI.IngestionProgress, locale: Locale = .current) -> String {
        switch value {
        case .notStarted: String(localized: AppMessages.statusProgressNotStarted(locale: locale))
        case .inProgress: String(localized: AppMessages.statusProgressInProgress(locale: locale))
        case .complete: String(localized: AppMessages.statusProgressComplete(locale: locale))
        case .unknown: String(localized: AppMessages.statusProgressUnknown(locale: locale))
        }
    }
    static func scheduling(_ value: ActivityMapAPI.IngestionScheduling, locale: Locale = .current) -> String {
        switch value {
        case .idle: String(localized: AppMessages.statusSchedulingIdle(locale: locale))
        case .scheduled: String(localized: AppMessages.statusSchedulingScheduled(locale: locale))
        case .waiting: String(localized: AppMessages.statusSchedulingWaiting(locale: locale))
        case .blocked: String(localized: AppMessages.statusSchedulingBlocked(locale: locale))
        case .disabled: String(localized: AppMessages.statusSchedulingDisabled(locale: locale))
        case .stalled: String(localized: AppMessages.statusSchedulingStalled(locale: locale))
        case .notScheduled: String(localized: AppMessages.statusSchedulingNotScheduled(locale: locale))
        case .unknown: String(localized: AppMessages.statusSchedulingUnknown(locale: locale))
        }
    }
    static func reason(_ value: ActivityMapAPI.IngestionReason, locale: Locale = .current) -> String {
        switch value {
        case .rateLimited: String(localized: AppMessages.statusReasonRateLimited(locale: locale))
        case .timeBudget: String(localized: AppMessages.statusReasonTimeBudget(locale: locale))
        case .credentialsUnavailable: String(localized: AppMessages.statusReasonCredentialsUnavailable(locale: locale))
        case .unauthorized: String(localized: AppMessages.statusReasonUnauthorized(locale: locale))
        case .upstreamError: String(localized: AppMessages.statusReasonUpstreamError(locale: locale))
        case .invalidResponse: String(localized: AppMessages.statusReasonInvalidResponse(locale: locale))
        case .detailFailures: String(localized: AppMessages.statusReasonDetailFailures(locale: locale))
        case .photoRefreshFailed: String(localized: AppMessages.statusReasonPhotoRefreshFailed(locale: locale))
        case .historyFetchFailed: String(localized: AppMessages.statusReasonHistoryFetchFailed(locale: locale))
        case .persistenceFailed: String(localized: AppMessages.statusReasonPersistenceFailed(locale: locale))
        case .internalError: String(localized: AppMessages.statusReasonInternalError(locale: locale))
        }
    }
    static func outcome(_ value: ActivityMapAPI.IngestionRunOutcome, locale: Locale = .current) -> String {
        let title: String
        switch value.outcome {
        case .succeeded: title = String(localized: AppMessages.statusOutcomeSucceeded(locale: locale))
        case .partial: title = String(localized: AppMessages.statusOutcomePartial(locale: locale))
        case .deferred: title = String(localized: AppMessages.statusOutcomeDeferred(locale: locale))
        case .failed: title = String(localized: AppMessages.statusOutcomeFailed(locale: locale))
        case .blocked: title = String(localized: AppMessages.statusOutcomeBlocked(locale: locale))
        }
        return value.reason.map { String(localized: AppMessages.statusOutcomeWithReason(title, reason($0, locale: locale), locale: locale)) } ?? title
    }
}

nonisolated extension IngestionPresentation {
    struct CoverageProgress: Equatable {
        let completed: Int
        let total: Int
        var fraction: Double { Double(completed) / Double(total) }
        var percent: Double { floor(fraction * 1000) / 10 }
        var percentage: String { formattedPercentage() }
        func formattedPercentage(locale: Locale = .current) -> String { (percent / 100).formatted(.percent.precision(.fractionLength(0...1)).locale(locale)) }
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
    static func summaries(_ value: ActivityMapAPI.IngestionStatus, locale: Locale = .current) -> [Summary] {
        let h = value.history, d = value.details, s = value.streams, p = value.photos
        return [
            Summary(title: String(localized: AppMessages.statusSummaryHistory(locale: locale)), count: String(localized: h.totalActivityCount == nil ? AppMessages.statusHistorySummaryUnknown(h.knownActivityCount, locale: locale) : AppMessages.statusHistorySummary(h.knownActivityCount, locale: locale)), status: compactStatus(h.progress, h.scheduling, outcome: h.lastOutcome, locale: locale)),
            Summary(title: String(localized: AppMessages.statusSummaryDetails(locale: locale)), count: String(localized: AppMessages.statusDetailsSummary(d.detailed, h.knownActivityCount, locale: locale)), status: compactStatus(d.progress, d.scheduling, outcome: d.lastOutcome, locale: locale), progress: coverageProgress(d.detailed, total: h.knownActivityCount)),
            Summary(title: String(localized: AppMessages.statusSummaryStreams(locale: locale)), count: String(localized: AppMessages.statusStreamsSummary(s.withData + s.withoutData, h.knownActivityCount, locale: locale)), status: s.failed > 0 ? String(localized: AppMessages.statusCompactNeedsAttention(locale: locale)) : compactStatus(s.progress, s.scheduling, locale: locale), progress: coverageProgress(s.withData + s.withoutData, total: h.knownActivityCount)),
            Summary(title: String(localized: AppMessages.statusSummaryPhotos(locale: locale)), count: p.activitiesWithPhotos == 0 ? String(localized: AppMessages.statusNoPhotos(locale: locale)) : p.activitiesWithStoredPhotos.map { String(localized: AppMessages.statusPhotosSummary($0, p.activitiesWithPhotos, locale: locale)) } ?? String(localized: AppMessages.statusPhotosUnknown(locale: locale)), status: compactStatus(p.progress, p.scheduling, locale: locale), progress: coverageProgress(p.activitiesWithStoredPhotos, total: p.activitiesWithPhotos))
        ]
    }
    static func compactStatus(_ progress: ActivityMapAPI.IngestionProgress, _ scheduling: ActivityMapAPI.IngestionScheduling, outcome: ActivityMapAPI.IngestionRunOutcome? = nil, locale: Locale = .current) -> String {
        switch scheduling {
        case .blocked: return String(localized: AppMessages.statusCompactReconnect(locale: locale))
        case .disabled: return String(localized: AppMessages.statusCompactPaused(locale: locale))
        case .stalled: return String(localized: AppMessages.statusCompactNeedsAttention(locale: locale))
        case .unknown: return String(localized: AppMessages.statusCompactScheduleUnknown(locale: locale))
        case .waiting: return String(localized: AppMessages.statusCompactWaiting(locale: locale))
        case .notScheduled: return String(localized: AppMessages.statusCompactRefreshPending(locale: locale))
        case .scheduled:
            if outcome?.outcome == .deferred && outcome?.reason == .rateLimited { return String(localized: AppMessages.statusCompactWaiting(locale: locale)) }
            return progress == .complete ? String(localized: AppMessages.statusCompactChecking(locale: locale)) : progress == .notStarted ? String(localized: AppMessages.statusCompactQueued(locale: locale)) : String(localized: AppMessages.statusCompactImporting(locale: locale))
        case .idle: return progress == .complete ? String(localized: AppMessages.statusCompactReady(locale: locale)) : progress == .unknown ? String(localized: AppMessages.statusProgressUnknown(locale: locale)) : String(localized: AppMessages.statusProgressNotStarted(locale: locale))
        }
    }
}

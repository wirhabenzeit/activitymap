import Foundation

/// "Check Strava for missing activities" in Settings, as on the web
/// (src/lib/ingestion/strava-check.ts): one request that starts the account's
/// reconciliation sweep in the background. Nothing about the request is kept:
/// Settings shows the sweep from the ingestion status it already polls, so a
/// relaunch shows it as the server has it. Only the answer to a request made
/// since that status was observed is shown instead.
enum StravaCheck {
    enum Request: Equatable, Sendable {
        case started(at: Date)
        /// Not started: checked recently, or not possible right now.
        case recent(at: Date, retryAt: Date?)
        case failed(at: Date, retryAt: Date)

        var at: Date {
            switch self {
            case .started(let at), .recent(let at, _), .failed(let at, _): at
            }
        }
    }

    struct View: Equatable {
        var disabled: Bool
        var message: String?
    }

    static func request(
        _ session: SyncSession, now: () -> Date = Date.init,
        submit: (SyncSession) async throws -> ActivityMapAPI.StravaImport = {
            try await APIClient.post("/api/v1/strava-import", bearerToken: $0.token,
                                     baseURL: $0.deployment, as: ActivityMapAPI.StravaImport.self)
        }
    ) async -> Request {
        do {
            let run = try await submit(session)
            // `running` once the sweep was started (or already was); otherwise
            // `retryAt` says when a request is accepted again.
            return run.status == .running ? .started(at: now()) : .recent(at: now(), retryAt: run.retryAt)
        } catch {
            let delay = max(60, APIClient.errorFacts(for: error).retryAfter ?? 0)
            return .failed(at: now(), retryAt: now().addingTimeInterval(delay))
        }
    }

    static func view(_ status: ActivityMapAPI.IngestionStatus?, request: Request?, now: Date,
                     locale: Locale = .current) -> View {
        func time(_ date: Date) -> String { date.formatted(date: .abbreviated, time: .shortened) }
        let requested = View(disabled: true, message: String(localized: AppMessages.settingsCheckStravaRequested(locale: locale)))
        func answer() -> View? {
            switch request {
            case nil: return nil
            case .started: return requested
            case .failed(_, let retryAt):
                return View(disabled: now < retryAt, message: String(localized: AppMessages.settingsCheckStravaFailed(locale: locale)))
            case .recent(_, let retryAt):
                guard let retryAt, now < retryAt else { return nil }
                return View(disabled: true, message: String(localized: AppMessages.settingsCheckStravaRecent(time(retryAt), locale: locale)))
            }
        }
        guard let status else { return answer() ?? View(disabled: false, message: nil) }
        // A request answered after this status was observed is newer news.
        if let request, request.at > status.observedAt, let newer = answer() { return newer }
        let history = status.history, sweep = history.reconciliation
        // The reconnect prompt next to it already says what to do.
        if history.scheduling == .blocked { return View(disabled: true, message: nil) }
        if history.scheduling == .waiting, let retryAt = history.retryAt {
            return View(disabled: true, message: String(localized: AppMessages.settingsCheckStravaWaiting(time(retryAt), locale: locale)))
        }
        if sweep.phase == .scanning, let started = sweep.scanStartedAt {
            return View(disabled: true, message: String(localized: AppMessages.settingsCheckStravaScanning(time(started), locale: locale)))
        }
        if sweep.phase == .confirming, let started = sweep.scanStartedAt {
            return View(disabled: true, message: String(localized: AppMessages.settingsCheckStravaConfirming(time(started), locale: locale)))
        }
        // Due but not picked up yet: requested a moment ago, here or elsewhere.
        if sweep.phase != .idle || sweep.nextDueAt.map({ $0 <= status.observedAt }) == true { return requested }
        // A started request this status already accounts for is shown by it.
        let older: View? = if case .started = request { nil } else { answer() }
        if let older, older.disabled { return older }
        return View(disabled: false, message: sweep.lastCompletedAt.map {
            String(localized: AppMessages.settingsCheckStravaLastChecked(time($0), locale: locale))
        } ?? older?.message)
    }
}

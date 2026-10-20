import Foundation
import Observation

@MainActor @Observable
final class StravaImportController {
    private(set) var scope: StoreScope?
    private(set) var snapshot: ActivityMapAPI.StravaImport?
    private(set) var messageText: PresentationText?
    var message: String? { message(locale: .current) }
    func message(locale: Locale) -> String? { messageText?.string(locale: locale) }
    private(set) var isStarting = false
    private(set) var nextCheck = Date.distantPast
    private(set) var retryAt = Date.distantPast
    private var generation = 0
    private var revision = 0
    private var loading = false
    private let defaults: UserDefaults
    private let now: () -> Date
    private let load: (SyncSession) async throws -> ActivityMapAPI.StravaImport
    private let submit: (SyncSession) async throws -> ActivityMapAPI.StravaImport

    init(defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init,
         load: @escaping (SyncSession) async throws -> ActivityMapAPI.StravaImport = {
             try await APIClient.get("/api/v1/strava-import", bearerToken: $0.token,
                                     baseURL: $0.deployment, as: ActivityMapAPI.StravaImport.self)
         }, submit: @escaping (SyncSession) async throws -> ActivityMapAPI.StravaImport = {
             try await APIClient.post("/api/v1/strava-import", bearerToken: $0.token,
                                      baseURL: $0.deployment, as: ActivityMapAPI.StravaImport.self)
         }) {
        self.defaults = defaults; self.now = now; self.load = load; self.submit = submit
    }

    func activate(_ session: SyncSession) {
        generation += 1; revision += 1
        if scope != session.scope { snapshot = nil }
        scope = session.scope; messageText = nil; isStarting = false; loading = false
        retryAt = defaults.object(forKey: key(session.scope)) as? Date ?? .distantPast
        nextCheck = retryAt > now() ? retryAt : .distantPast
    }

    func observe(_ session: SyncSession) async {
        activate(session)
        let current = generation
        guard session.verified else { return }
        while !Task.isCancelled && current == generation {
            await refresh(session)
            do { try await Task.sleep(for: .seconds(3)) }
            catch { return }
        }
    }

    func refresh(_ session: SyncSession) async {
        guard session.verified, scope == session.scope, !loading, !isStarting, now() >= nextCheck else { return }
        let current = generation, version = revision
        loading = true
        defer { if current == generation { loading = false } }
        nextCheck = now().addingTimeInterval(30)
        do {
            let result = try await load(session)
            try Task.checkCancellation()
            guard current == generation, version == revision, scope == session.scope else { return }
            snapshot = result; messageText = nil
            nextCheck = now().addingTimeInterval(result.status == .running ? 3 : 30)
            retryAt = max(retryAt, result.retryAt ?? .distantPast)
        } catch {
            guard !Task.isCancelled, current == generation, version == revision else { return }
            record(error, session)
        }
    }

    func start(_ session: SyncSession) async {
        guard canStart(session) else { return }
        revision += 1
        let current = generation
        isStarting = true; messageText = nil
        defer { if current == generation { isStarting = false } }
        do {
            let result = try await submit(session)
            guard !Task.isCancelled, current == generation, scope == session.scope else { return }
            snapshot = result
            retryAt = max(retryAt, result.retryAt ?? .distantPast)
            nextCheck = now().addingTimeInterval(3)
        } catch {
            guard !Task.isCancelled, current == generation else { return }
            record(error, session)
        }
    }

    func canStart(_ session: SyncSession) -> Bool {
        session.verified && scope == session.scope && snapshot?.available == true
            && snapshot?.status != .running && !isStarting && now() >= retryAt
    }

    private func record(_ error: Error, _ session: SyncSession) {
        messageText = .localized(AppMessages.errorStravaImportCouldNotCheckTheStravaFetchPleaseTry())
        let facts = APIClient.errorFacts(for: error)
        let delay = max(30, facts.retryAfter ?? 0)
        if facts.authenticationRejected {
            snapshot = nil; messageText = .localized(AppMessages.errorStravaImportSignInAgainToFetchFromStrava())
        }
        retryAt = max(retryAt, now().addingTimeInterval(delay)); nextCheck = retryAt
        defaults.set(retryAt, forKey: key(session.scope))
    }
    private func key(_ scope: StoreScope) -> String { "strava-import.retry.v1." + scope.key }

    var progressMessage: String? { progressMessage(locale: .current) }
    func progressMessage(locale: Locale) -> String? {
        guard let run = snapshot else { return nil }
        if run.status == .idle { return nil }
        if run.status == .running { return String(localized: AppMessages.statusStravaImportRunning(run.summaries, run.details, run.photos, locale: locale)) }
        if run.status == .interrupted { return String(localized: AppMessages.statusStravaImportInterrupted(run.summaries, run.details, run.photos, locale: locale)) }
        if run.reason == .accountUnavailable || run.status == .blocked { return String(localized: AppMessages.errorStravaImportReconnectStravaFromAccountToContinueFetching(locale: locale)) }
        if run.reason == .rateLimit { return String(localized: AppMessages.statusStravaImportRateLimited(run.summaries, run.details, run.photos, locale: locale)) }
        if run.reason == .busy { return String(localized: AppMessages.errorStravaImportFetchingPausedWhileTheServiceIsBusyPlease(locale: locale)) }
        if run.status == .failed { return String(localized: AppMessages.statusStravaImportFailed(run.summaries, run.details, run.photos, locale: locale)) }
        if run.status == .deferred { return String(localized: AppMessages.statusStravaImportDeferred(run.summaries, run.details, run.photos, locale: locale)) }
        return String(localized: AppMessages.statusStravaImportFinished(run.summaries, run.details, run.photos, locale: locale))
    }
}

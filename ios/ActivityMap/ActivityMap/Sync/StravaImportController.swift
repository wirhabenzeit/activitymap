import Foundation
import Observation

@MainActor @Observable
final class StravaImportController {
    private(set) var scope: StoreScope?
    private(set) var snapshot: ActivityMapAPI.StravaImport?
    private(set) var message: String?
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
        scope = session.scope; message = nil; isStarting = false; loading = false
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
            snapshot = result; message = nil
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
        isStarting = true; message = nil
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
        message = "Could not check the Strava fetch. Please try again later."
        var delay: TimeInterval = 30
        if let failure = error as? APIClient.RequestError {
            switch failure {
            case .rateLimited(let seconds, _), .serviceUnavailable(let seconds?, _),
                 .server(_, _, _, _, _, let seconds?): delay = max(delay, seconds)
            default: break
            }
            if AuthController.isExplicitlyUnauthenticated(failure) {
                snapshot = nil; message = "Sign in again to fetch from Strava."
            }
        }
        retryAt = max(retryAt, now().addingTimeInterval(delay)); nextCheck = retryAt
        defaults.set(retryAt, forKey: key(session.scope))
    }
    private func key(_ scope: StoreScope) -> String { "strava-import.retry.v1." + scope.key }

    var progressMessage: String? {
        guard let run = snapshot else { return nil }
        let counts = "\(run.summaries) activity summaries fetched · \(run.details) activities updated · \(run.photos) photos fetched"
        if run.status == .idle { return nil }
        if run.status == .running { return "Fetching from Strava in the background… \(counts)." }
        if run.status == .interrupted { return "The fetch was interrupted. Saved progress is kept; try again when available. \(counts)." }
        if run.reason == .accountUnavailable || run.status == .blocked { return "Reconnect Strava from Account to continue fetching." }
        if run.reason == .rateLimit { return "Strava’s request limit was reached. \(counts)." }
        if run.reason == .busy { return "Fetching paused while the service is busy. Please try again when available." }
        if run.status == .failed { return "Could not finish fetching. Saved progress is kept. \(counts)." }
        if run.status == .deferred { return "This fetch has paused. You can continue with another fetch when available. \(counts)." }
        return "Fetch finished. \(counts)."
    }
}

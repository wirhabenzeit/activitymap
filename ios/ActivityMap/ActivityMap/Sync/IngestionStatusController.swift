import Foundation
import Observation

/// A read-only snapshot, scoped like the activity cache. Never fetches Strava,
/// raw samples or images. The stored observation remains useful offline.
@MainActor @Observable
final class IngestionStatusController {
    struct Cache: Codable {
        var status: ActivityMapAPI.IngestionStatus?
        var nextCheck: Date
    }
    private(set) var scope: StoreScope?
    private(set) var snapshot: ActivityMapAPI.IngestionStatus?
    private(set) var message: String?
    private(set) var isLoading = false
    private(set) var nextCheck = Date.distantPast
    private var generation = 0
    private let defaults: UserDefaults
    private let load: (SyncSession) async throws -> ActivityMapAPI.IngestionStatus

    init(defaults: UserDefaults = .standard,
         load: @escaping (SyncSession) async throws -> ActivityMapAPI.IngestionStatus = {
             try await APIClient.get("/api/v1/ingestion-status", bearerToken: $0.token,
                                     baseURL: $0.deployment, as: ActivityMapAPI.IngestionStatus.self)
         }) {
        self.defaults = defaults
        self.load = load
    }

    func activate(_ session: SyncSession) {
        generation += 1
        scope = session.scope
        let cache = defaults.data(forKey: key(session.scope))
            .flatMap { try? ActivityMapAPI.makeDecoder().decode(Cache.self, from: $0) }
        snapshot = cache?.status
        nextCheck = cache?.nextCheck ?? .distantPast
        message = nil
        isLoading = false
    }

    func observe(_ session: SyncSession) async {
        activate(session)
        let current = generation
        guard session.verified else {
            message = "Offline or session not verified. Showing the last known server status when available."
            return
        }
        while !Task.isCancelled && current == generation {
            await refresh(session)
            do { try await Task.sleep(for: .seconds(max(60, nextCheck.timeIntervalSinceNow))) }
            catch { return }
        }
    }

    func refresh(_ session: SyncSession) async {
        guard session.verified, scope == session.scope, !isLoading, Date() >= nextCheck else { return }
        let current = generation
        isLoading = true
        nextCheck = Date().addingTimeInterval(60)
        save(session.scope)
        defer { if current == generation { isLoading = false } }
        do {
            let status = try await load(session)
            try Task.checkCancellation()
            guard current == generation, scope == session.scope else { return }
            snapshot = status
            message = nil
            save(session.scope)
        } catch {
            guard !Task.isCancelled, current == generation, scope == session.scope else { return }
            message = "Server import status is not available. Showing the last known snapshot when available."
            if let failure = error as? APIClient.RequestError {
                switch failure {
                case .rateLimited(let delay, _), .serviceUnavailable(let delay?, _),
                     .server(_, _, _, _, _, let delay?):
                    nextCheck = max(nextCheck, Date().addingTimeInterval(delay))
                default: break
                }
                if AuthController.isExplicitlyUnauthenticated(failure) {
                    snapshot = nil
                    message = "Sign in again to check server import status."
                }
            }
            save(session.scope)
        }
    }

    private func key(_ scope: StoreScope) -> String { "ingestion-status.v1." + scope.key }
    private func save(_ scope: StoreScope) {
        if let data = try? ActivityMapAPI.makeEncoder().encode(Cache(status: snapshot, nextCheck: nextCheck)) {
            defaults.set(data, forKey: key(scope))
        }
    }
}

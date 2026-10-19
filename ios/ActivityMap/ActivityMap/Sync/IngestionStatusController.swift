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
    private(set) var messageText: PresentationText?
    var message: String? { message(locale: .current) }
    func message(locale: Locale) -> String? { messageText?.string(locale: locale) }
    private(set) var requiresSignIn = false
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
        messageText = nil
        requiresSignIn = false
        isLoading = false
    }

    func observe(_ session: SyncSession) async {
        activate(session)
        let current = generation
        guard session.verified else {
            messageText = .localized(AppMessages.errorImportStatusOfflineOrSessionNotVerifiedShowingTheLast())
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
            requiresSignIn = false
            messageText = nil
            save(session.scope)
        } catch {
            guard !Task.isCancelled, current == generation, scope == session.scope else { return }
            messageText = .localized(AppMessages.errorImportStatusServerImportStatusIsNotAvailableShowingThe())
            let facts = APIClient.errorFacts(for: error)
            if let delay = facts.retryAfter {
                nextCheck = max(nextCheck, Date().addingTimeInterval(delay))
            }
            requiresSignIn = facts.authenticationRejected
            if requiresSignIn {
                snapshot = nil
                messageText = .localized(AppMessages.errorImportStatusSignInAgainToCheckServerImportStatus())
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

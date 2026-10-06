import Foundation
import Observation

nonisolated struct SyncSession: Equatable, Sendable {
    let user: ActivityMapAPI.CurrentUser
    let token: String
    let deployment: URL
    let verified: Bool

    var scope: StoreScope { StoreScope(deployment: deployment, userID: user.id) }
}

@MainActor
@Observable
final class SyncController {
    enum Status: Equatable {
        case signedOut, syncing, ready, offline, expired, disconnected, paused
        case failed(String)
        case rateLimited(Date)
        case retryAfter(Date)

        var title: String {
            switch self {
            case .signedOut: "Connect Strava to see your activities"
            case .syncing: "Syncing activities…"
            case .ready: "Activity sync complete"
            case .offline: "Offline · reconnect to sync"
            case .expired: "Sign-in expired · connect with Strava again to sync"
            case .disconnected: "Strava is not connected"
            case .paused: "Activity sync paused"
            case .failed: "Couldn’t sync activities"
            case .rateLimited: "Sync paused · try again later"
            case .retryAfter: "Server unavailable · try again later"
            }
        }
    }

    let summaries: StreamSummaryLoader
    let activities: ActivityStore
    private(set) var status: Status = .signedOut
    private(set) var checkpoint: SyncCheckpoint?
    private(set) var photos: [Photo] = []
    private(set) var session: SyncSession?
    private var storage: LocalStore?
    private var work: Task<Void, Never>?
    private var generation = 0
    private var retryAt: Date?
    private var retryIsRateLimit = true

    var hasCompletedCache: Bool { checkpoint?.bootstrapComplete == true && checkpoint?.lastSyncAt != nil }
    var lastSyncAt: Date? { checkpoint?.lastSyncAt }
    var lastReconciliationAt: Date? { checkpoint?.freshness?.lastSummaryReconciledAt }
    var retryNotBefore: Date? { retryAt }
    var canRefresh: Bool {
        guard let session, session.user.stravaConnected,
              session.user.authentication.sessionExpiresAt > now(), status != .syncing else { return false }
        return retryAt.map { $0 <= now() } ?? true
    }
    private var deferredStatus: Status {
        let date = retryAt ?? now()
        return retryIsRateLimit ? .rateLimited(date) : .retryAfter(date)
    }
    private var needsCleanup = false
    private let now: () -> Date
    private let source: (SyncSession) -> any SyncPageSource
    private let invalidate: (String) -> Void

    init(
        activities: ActivityStore,
        now: @escaping () -> Date = Date.init,
        source: @escaping (SyncSession) -> any SyncPageSource = { SyncAPI(baseURL: $0.deployment, token: $0.token) },
        summarySource: @escaping (SyncSession) -> any CompactSummarySource = {
            StreamsAPI(baseURL: $0.deployment, token: $0.token)
        },
        invalidate: @escaping (String) -> Void
    ) {
        self.summaries = StreamSummaryLoader(source: summarySource, invalidate: invalidate)
        activities.streamSummaries = self.summaries
        self.activities = activities
        self.now = now
        self.source = source
        self.invalidate = invalidate
    }

    /// Cancellation and a generation check protect both disk and visible state.
    /// New work waits for its predecessor before removing the old account's data.
    func setSession(_ next: SyncSession?, storage: LocalStore) {
        guard self.storage == nil || session != next || (needsCleanup && work == nil) else { return }
        let sameCredential = session?.token == next?.token && session?.scope == next?.scope
        let expiredSignIn = status == .expired && next == nil
        self.storage = storage
        session = next
        generation += 1
        let current = generation
        let previous = work
        previous?.cancel()
        // Verification and profile metadata may change during normal refresh.
        // Keep browsing state for the same usable credential; actual scope,
        // expiry and connection transitions still clear it immediately.
        let retainsVisibleState = sameCredential && next.map {
            $0.user.stravaConnected && $0.user.authentication.sessionExpiresAt > now()
        } == true
        if !retainsVisibleState { clearVisible() }
        if !sameCredential { retryAt = nil }
        status = next.map { session in
            if !session.user.stravaConnected { return .disconnected }
            if session.user.authentication.sessionExpiresAt <= now() { return .expired }
            return .syncing
        } ?? (expiredSignIn ? .expired : .signedOut)
        needsCleanup = true
        work = Task {
            defer { if current == generation { work = nil } }
            await previous?.value
            guard current == generation, !Task.isCancelled else { return }
            do {
                let active = next.flatMap { $0.user.authentication.sessionExpiresAt > now() && $0.user.stravaConnected ? $0 : nil }
                try await storage.clearExcept(scope: active?.scope)
                guard current == generation, !Task.isCancelled else { return }
                needsCleanup = false
                await summaries.configure(active, storage: storage)
                guard current == generation, !Task.isCancelled else { return }
                if let active {
                    await perform(active, storage: storage, generation: current)
                } else if let next {
                    status = next.user.stravaConnected ? .expired : .disconnected
                } else {
                    status = expiredSignIn ? .expired : .signedOut
                }
            } catch {
                if current == generation { status = .failed(String(describing: error)) }
            }
        }
    }

    func refresh() async {
        guard !Task.isCancelled else { return }
        if let pending = work {
            await pending.value
            if pending.isCancelled { await refresh() }
            return
        }
        guard let storage else { return }
        if needsCleanup {
            setSession(session, storage: storage)
            await work?.value
            return
        }
        guard let session else { return }
        let authorized = session.user.stravaConnected && session.user.authentication.sessionExpiresAt > now()
        if authorized, let retryAt, retryAt > now() { status = deferredStatus; return }
        let current = generation
        work = Task {
            defer { if current == generation { work = nil } }
            await perform(session, storage: storage, generation: current)
        }
        await work?.value
    }

    func pause() {
        work?.cancel()
        summaries.pause()
        if status == .syncing { status = .paused }
    }


    private func perform(_ session: SyncSession, storage: LocalStore, generation current: Int) async {
        do {
            guard session.user.authentication.sessionExpiresAt > now(), session.user.stravaConnected else {
                clearVisible()
                try await storage.clear(scope: session.scope)
                if current == generation { status = session.user.stravaConnected ? .expired : .disconnected }
                return
            }
            try await loadCache(session, storage: storage, generation: current)
            guard current == generation, !Task.isCancelled else { return }
            guard session.verified else {
                status = .offline
                return
            }
            if let retryAt, retryAt > now() { status = deferredStatus; return }
            status = .syncing
            let engine = SyncEngine(source: source(session), store: storage, scope: session.scope)
            _ = try await engine.run()
            guard current == generation, !Task.isCancelled else { return }
            try await loadCache(session, storage: storage, generation: current)
            if current == generation {
                retryAt = nil
                status = .ready
            }
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            if AuthController.isExplicitlyUnauthenticated(error) {
                clearVisible()
                needsCleanup = true
                status = .expired
                invalidate(session.token)
                do { try await storage.clear(scope: session.scope) }
                catch {
                    if current == generation { status = .failed(String(describing: error)) }
                    return
                }
                guard current == generation else { return }
                needsCleanup = false
                status = .expired
                return
            }
            // Reload committed pages even on failure: already-applied tombstones
            // must not remain visible just because a subsequent request failed.
            do { try await loadCache(session, storage: storage, generation: current) }
            catch { if current == generation { clearVisible() } }
            guard current == generation else { return }
            if case .rateLimited(let delay, _) = error as? APIClient.RequestError {
                retryAt = now().addingTimeInterval(delay)
                retryIsRateLimit = true
                status = deferredStatus
            } else if let delay = Self.serverRetryDelay(error) {
                retryAt = now().addingTimeInterval(delay)
                retryIsRateLimit = false
                status = deferredStatus
            } else if case .transport = error as? APIClient.RequestError {
                status = .offline
            } else {
                status = .failed(String(describing: error))
            }
        }
    }

    private static func serverRetryDelay(_ error: Error) -> TimeInterval? {
        switch error as? APIClient.RequestError {
        case .serviceUnavailable(let delay, _): return delay
        case .server(_, _, _, _, true, let delay): return delay
        default: return nil
        }
    }

    /// The cache has no age limit of its own: the server revalidates Strava data
    /// within seven days (docs/strava-data-policy.md), and every sync applies
    /// its upserts and tombstones. Sign-out, sign-in expiry, disconnection and
    /// an explicit 401 still clear it.
    private func loadCache(_ session: SyncSession, storage: LocalStore, generation current: Int) async throws {
        let snapshot = try await storage.snapshot(scope: session.scope)
        guard current == generation, !Task.isCancelled else { throw CancellationError() }
        checkpoint = snapshot.checkpoint
        guard let checkpoint, checkpoint.bootstrapComplete, checkpoint.lastSyncAt != nil else {
            activities.activities = []
            photos = []
            activities.photos = []
            try? await activities.photoImages.configure(scope: session.scope, photos: [])
            return
        }
        let mapped = try snapshot.activities.map(StoredModelMapper.activity)
        // Assigning activities drops selection/focus/inspection of absent IDs
        // (committed deletions and rebootstrap removals) inside ActivityStore.
        activities.activities = mapped
        let activityIDs = Set(mapped.map { String($0.id) })
        let mappedPhotos = snapshot.photos.map(StoredModelMapper.photo).filter { photo in
            activityIDs.contains(photo.activityID)
        }
        photos = mappedPhotos
        activities.photos = mappedPhotos
        // Image-cache I/O failure must not invalidate committed metadata or sync.
        // The image loader will show an unavailable state if its byte store fails.
        try? await activities.photoImages.configure(scope: session.scope, photos: mappedPhotos)
        guard current == generation, !Task.isCancelled else { throw CancellationError() }
    }

    private func clearVisible() {
        summaries.reset()
        activities.clearScope()
        photos = []
        checkpoint = nil
    }
}

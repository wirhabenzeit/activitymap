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
    let summarySync: StreamSummarySync
    let editing = ActivityEditingService()
    let sharing = ActivitySharingService()
    private(set) var editingInProgress = false
    let activities: ActivityStore
    private(set) var status: Status = .signedOut
    private(set) var checkpoint: SyncCheckpoint?
    private(set) var photos: [Photo] = []
    private(set) var session: SyncSession?
    var firstSummaryCount: Int?
    var firstSummaryError: String?
    private(set) var firstSummaryRetryable = true
    private var pendingFirstSummaryCount: Int?
    private var fetchedInitialSummaries = false
    private var importingInitialSummaries = false
    private let fetchInitialSummaries: ((SyncSession) async throws -> Int)?
    private var storage: LocalStore?
    private var work: Task<Void, Never>?
    private var generation = 0
    private var retryAt: Date?
    private var retryIsRateLimit = true
    // Checkpoint timestamps/cursors can advance without any visible data change.
    // Retain one detached snapshot so an unchanged poll does not invalidate
    // Stats, route sources, selection caches or loaded photo images.
    @ObservationIgnored private var publishedActivities: [ActivityMapAPI.Activity]?
    @ObservationIgnored private var publishedActivityRevision: Int?
    @ObservationIgnored private var publishedPhotos: [ActivityMapAPI.Photo]?
    @ObservationIgnored private var photoCacheConfigured = false

    var hasCompletedCache: Bool { checkpoint?.bootstrapComplete == true && checkpoint?.lastSyncAt != nil }
    var isLoadingInitialActivities: Bool {
        importingInitialSummaries && status == .syncing && activities.activities.isEmpty
    }
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
    private let editSource: (SyncSession) -> any ActivityEditSource

    init(
        activities: ActivityStore,
        now: @escaping () -> Date = Date.init,
        source: @escaping (SyncSession) -> any SyncPageSource = { SyncAPI(baseURL: $0.deployment, token: $0.token) },
        summarySource: @escaping (SyncSession) -> any CompactSummarySource = {
            StreamsAPI(baseURL: $0.deployment, token: $0.token)
        },
        storedSummarySource: @escaping (SyncSession) -> any StoredSummarySource = {
            StreamsAPI(baseURL: $0.deployment, token: $0.token)
        },
        fetchInitialSummaries: ((SyncSession) async throws -> Int)? = nil,
        editSource: @escaping (SyncSession) -> any ActivityEditSource = {
            ActivityEditsAPI(baseURL: $0.deployment, token: $0.token)
        },
        invalidate: @escaping (String) -> Void
    ) {
        self.summaries = StreamSummaryLoader(source: summarySource, invalidate: invalidate)
        self.summarySync = StreamSummarySync(now: now, source: storedSummarySource, invalidate: invalidate)
        activities.streamSummaries = self.summaries
        self.activities = activities
        self.now = now
        self.source = source
        self.fetchInitialSummaries = fetchInitialSummaries
        self.invalidate = invalidate
        self.editSource = editSource
        editing.coordinator = self
        activities.activityEditing = editing
        sharing.session = { [weak self] in self?.session }
    }

    /// Cancellation and a generation check protect both disk and visible state.
    /// New work waits for its predecessor before removing the old account's data.
    func setSession(_ next: SyncSession?, storage: LocalStore) {
        guard self.storage == nil || session != next || (needsCleanup && work == nil) else { return }
        let sameCredential = session?.token == next?.token && session?.scope == next?.scope
        let expiredSignIn = status == .expired && next == nil
        self.storage = storage
        session = next
        summarySync.configure(next)
        generation += 1
        editingInProgress = false
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
        // An edit waits for the existing reader, then owns the write interval.
        // The next normal sync catches up from the unchanged cursor afterwards.
        guard !editingInProgress else { return }
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
        summarySync.pause()
        summaries.pause()
        if status == .syncing { status = .paused }
    }

    func updateActivity(activityID: Int, fields: ActivityMapAPI.UpdateActivityRequest) async throws {
        if let reason = editing.unavailableReason { throw ActivityEditingError.unavailable(reason) }
        guard !editingInProgress, let session, let storage else {
            throw ActivityEditingError.unavailable("Another save is in progress. Please wait.")
        }
        let current = generation
        editingInProgress = true
        defer { if current == generation { editingInProgress = false } }
        await work?.value
        try Task.checkCancellation()
        guard current == generation, self.session == session else { throw CancellationError() }
        if let reason = editing.unavailableReason { throw ActivityEditingError.unavailable(reason) }
        let id = String(activityID)
        guard try await storage.summaryActivityExists(activityID: id, scope: session.scope) else {
            throw ActivityEditingError.unavailable("This activity is no longer available. Sync to update your library.")
        }
        let fence = await storage.streamFence()
        guard current == generation else { throw CancellationError() }
        do {
            let updated = try await editSource(session).update(activityID: id, fields: fields)
            try Task.checkCancellation()
            guard current == generation, self.session == session else { throw CancellationError() }
            guard updated.id == id else { throw ActivityEditingError.reconciliation }
            do {
                try await storage.commitActivityEdit(updated, scope: session.scope, fence: fence,
                    sessionExpiresAt: session.user.authentication.sessionExpiresAt, now: now())
                try await loadCache(session, storage: storage, generation: current)
            } catch is CancellationError { throw CancellationError() }
            catch { throw ActivityEditingError.reconciliation }
        } catch {
            guard current == generation else { throw CancellationError() }
            if AuthController.isExplicitlyUnauthenticated(error) {
                clearVisible()
                status = .expired
                invalidate(session.token)
                try await storage.clear(scope: session.scope)
            }
            throw error
        }
    }

    func clearAfterAccountDeletion() async throws {
        guard let storage else { return }
        setSession(nil, storage: storage)
        await work?.value
        await summarySync.stopAndWait()
        try await storage.clearExcept(scope: nil)
        try await activities.photoImages.configure(scope: nil, photos: [])
    }


    private func perform(_ session: SyncSession, storage: LocalStore, generation current: Int) async {
        var importing = pendingFirstSummaryCount != nil
        defer { if current == generation { importingInitialSummaries = false } }
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
            if importing { firstSummaryError = nil }
            importingInitialSummaries = importing
            status = .syncing
            let engine = SyncEngine(source: source(session), store: storage, scope: session.scope)
            _ = try await engine.run()
            guard current == generation, !Task.isCancelled else { return }
            try await loadCache(session, storage: storage, generation: current)
            if activities.activities.isEmpty, !fetchedInitialSummaries,
               session.user.stravaPermissions?.activities != ActivityMapAPI.StravaActivityAccess.none,
               let fetchInitialSummaries {
                importing = true
                // Only a completed server sync with no activities starts the
                // blocking first import. An empty phone cache is insufficient.
                importingInitialSummaries = true
                firstSummaryError = nil
                let count = try await fetchInitialSummaries(session)
                guard current == generation, !Task.isCancelled else { return }
                fetchedInitialSummaries = true
                pendingFirstSummaryCount = count
                _ = try await engine.run()
                guard current == generation, !Task.isCancelled else { return }
                try await loadCache(session, storage: storage, generation: current)
            }
            if current == generation {
                if let count = pendingFirstSummaryCount {
                    firstSummaryCount = count
                    pendingFirstSummaryCount = nil
                }
                firstSummaryError = nil
                retryAt = nil
                status = .ready
                summarySync.start(storage: storage)
            }
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            summarySync.pause()
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
                if importing { firstSummaryError = Self.summaryErrorMessage(error) }
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
            if importing {
                firstSummaryError = Self.summaryErrorMessage(error)
                if case .server(_, _, _, _, let retryable, _) = error as? APIClient.RequestError {
                    firstSummaryRetryable = retryable
                } else { firstSummaryRetryable = true }
            }
        }
    }

    private static func summaryErrorMessage(_ error: Error) -> String {
        if case .server(let code, let message, _, _, _, _) = error as? APIClient.RequestError {
            if code == "strava_not_connected" { return message + " Connect with Strava again in Settings." }
            if code == "not_authenticated" { return message + " Sign in again to continue." }
            return message
        }
        return String(describing: error)
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
            publishedActivities = nil; publishedActivityRevision = nil; publishedPhotos = nil
            photoCacheConfigured = false
            if !activities.activities.isEmpty { activities.activities = [] }
            if !photos.isEmpty { photos = [] }
            if !activities.photos.isEmpty { activities.photos = [] }
            try? await activities.photoImages.configure(scope: session.scope, photos: [])
            return
        }
        let activitiesChanged = publishedActivities != snapshot.activities
            || publishedActivityRevision != activities.activitiesRevision
        if activitiesChanged {
            // Actual edits/deletions still invalidate derived data and reconcile
            // selection/inspection. An identical cache reload leaves it intact.
            activities.activities = try snapshot.activities.map(StoredModelMapper.activity)
            publishedActivities = snapshot.activities
            publishedActivityRevision = activities.activitiesRevision
        }
        if activitiesChanged || publishedPhotos != snapshot.photos {
            let activityIDs = Set(activities.activities.map { String($0.id) })
            let mappedPhotos = snapshot.photos.map(StoredModelMapper.photo).filter { photo in
                activityIDs.contains(photo.activityID)
            }
            photos = mappedPhotos
            activities.photos = mappedPhotos
            publishedPhotos = snapshot.photos
            photoCacheConfigured = false
        }
        // Image-cache I/O failure must not invalidate committed metadata or sync.
        // Retry a failed configuration even if the metadata remains unchanged.
        if !photoCacheConfigured {
            let configured: Bool
            do {
                try await activities.photoImages.configure(scope: session.scope, photos: photos)
                configured = true
            } catch { configured = false }
            guard current == generation, !Task.isCancelled else { throw CancellationError() }
            photoCacheConfigured = configured
        }
        guard current == generation, !Task.isCancelled else { throw CancellationError() }
    }

    private func clearVisible() {
        firstSummaryCount = nil
        firstSummaryError = nil
        firstSummaryRetryable = true
        pendingFirstSummaryCount = nil
        fetchedInitialSummaries = false
        importingInitialSummaries = false
        summarySync.pause()
        publishedActivities = nil; publishedActivityRevision = nil; publishedPhotos = nil
        photoCacheConfigured = false
        summaries.reset()
        activities.clearScope()
        photos = []
        checkpoint = nil
    }
}

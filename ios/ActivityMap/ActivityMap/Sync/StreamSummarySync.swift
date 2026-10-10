import Foundation

nonisolated protocol StoredSummarySource: Sendable {
    func storedSummaryBatch(activityIDs: [String]) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummaries>
}
nonisolated extension StreamsAPI: StoredSummarySource {}

private actor StoredSummaryWorker {
    let source: any StoredSummarySource
    init(source: any StoredSummarySource) { self.source = source }
    func fetch(_ ids: [String]) async throws -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummaries> {
        try await source.storedSummaryBatch(activityIDs: ids)
    }
}

/// Opportunistic, stored-only catch-up after normal metadata sync. It never
/// requests Strava streams, expands samples, or delays publishing activities.
@MainActor
final class StreamSummarySync {
    private var session: SyncSession?
    private var work: Task<Void, Never>?
    private var epoch = 0
    private var retryAt: Date?
    private struct Attempt {
        let metadata: ActivityMapAPI.StreamMetadata
        let retryAt: Date
    }
    private var attempts: [String: Attempt] = [:]
    private let now: () -> Date
    private let source: (SyncSession) -> any StoredSummarySource
    private let invalidate: (String) -> Void

    init(now: @escaping () -> Date = Date.init,
         source: @escaping (SyncSession) -> any StoredSummarySource = {
             StreamsAPI(baseURL: $0.deployment, token: $0.token)
         }, invalidate: @escaping (String) -> Void) {
        self.now = now
        self.source = source
        self.invalidate = invalidate
    }

    deinit { work?.cancel() }

    func configure(_ next: SyncSession?) {
        pause()
        if session?.scope != next?.scope || session?.token != next?.token {
            attempts.removeAll()
            retryAt = nil
        }
        session = next
    }

    func pause() {
        epoch &+= 1
        work?.cancel()
        work = nil
    }

    func start(storage: LocalStore) {
        guard work == nil, let session, session.verified, session.user.stravaConnected,
              session.user.authentication.sessionExpiresAt > now(),
              retryAt.map({ $0 <= now() }) ?? true else { return }
        let current = epoch
        let worker = StoredSummaryWorker(source: source(session))
        work = Task { [weak self] in
            guard let self else { return }
            defer { if self.epoch == current { self.work = nil } }
            await self.run(session, storage: storage, worker: worker, epoch: current)
        }
    }

    /// Also useful for deterministic integration tests; ordinary refresh never
    /// waits for a library's summary catch-up to finish.
    func waitUntilIdle() async { await work?.value }

    private func valid(_ current: Int) -> Bool {
        epoch == current && !Task.isCancelled && session?.verified == true
            && session?.user.stravaConnected == true
            && (session?.user.authentication.sessionExpiresAt ?? .distantPast) > now()
    }

    private func run(_ session: SyncSession, storage: LocalStore, worker: StoredSummaryWorker, epoch current: Int) async {
        do {
            let all = try await storage.summarySyncCandidates(scope: session.scope)
            guard valid(current) else { return }
            let ids = Set(all.map(\.activityID))
            attempts = attempts.filter { ids.contains($0.key) }
            let candidates = all.filter { candidate in
                guard let attempted = attempts[candidate.activityID] else { return true }
                return attempted.metadata != candidate.metadata || attempted.retryAt <= now()
            }
            // One bounded request at a time, newest first; continue through old
            // libraries without waiting for another user-triggered refresh.
            for offset in stride(from: 0, to: candidates.count, by: StreamsAPI.maxSummaryBatch) {
                guard valid(current) else { return }
                let batch = Array(candidates[offset..<min(offset + StreamsAPI.maxSummaryBatch, candidates.count)])
                let requested = Set(batch.map(\.activityID))
                let fence = await storage.streamFence()
                guard valid(current) else { return }
                let response = try await worker.fetch(batch.map(\.activityID))
                guard valid(current) else { return }
                var changed = Set<String>()
                for dto in response.payload.summaries where requested.contains(dto.activityID) {
                    guard valid(current) else { return }
                    let result = try await storage.saveStreamSummary(dto, scope: session.scope, fence: fence,
                        now: now(), sessionExpiresAt: session.user.authentication.sessionExpiresAt)
                    if result == .stored { changed.insert(dto.activityID) }
                }
                guard valid(current) else { return }
                if !changed.isEmpty {
                    await storage.notifySummaryChange(scope: session.scope.key, activityIDs: changed, cancelsRequests: false)
                }
                guard valid(current) else { return }
                // Missing/not-current results are not empty charts. Give the
                // server time to finish storage; newer sync metadata bypasses
                // this cooldown immediately. Current cached results are skipped.
                let nextAttempt = now().addingTimeInterval(max(15 * 60, response.retryAfter ?? 0))
                for candidate in batch {
                    attempts[candidate.activityID] = Attempt(metadata: candidate.metadata, retryAt: nextAttempt)
                }
                await Task.yield()
            }
            retryAt = nil
        } catch {
            guard valid(current) else { return }
            if AuthController.isExplicitlyUnauthenticated(error) {
                pause()
                invalidate(session.token)
                try? await storage.clear(scope: session.scope)
                return
            }
            // Keep metadata sync successful and retry opportunistically on a
            // later ordinary pass, honoring server backoff across manual refresh.
            let delay: TimeInterval
            switch error as? APIClient.RequestError {
            case .rateLimited(let seconds, _): delay = seconds
            case .serviceUnavailable(let seconds, _): delay = seconds ?? 60
            case .server(_, _, _, _, _, let seconds): delay = seconds ?? 60
            default: delay = 60
            }
            retryAt = now().addingTimeInterval(max(1, delay))
        }
    }
}

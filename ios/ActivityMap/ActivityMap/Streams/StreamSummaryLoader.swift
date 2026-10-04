import Foundation
import Observation

nonisolated protocol CompactSummarySource: Sendable {
    func summary(activityID: String, mode: StreamFetchMode) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummary>
}
nonisolated extension StreamsAPI: CompactSummarySource {}

nonisolated struct SummaryFailure: Equatable, Sendable {
    let message: String
    let retryable: Bool
    let retryAt: Date?
    let requestID: String?
}
nonisolated enum StreamSummaryState: Equatable, Sendable {
    case notRequested, loading
    case pending(retryAt: Date, paused: Bool)
    case current(CachedStreamSummary), unavailable(CachedStreamSummary)
    case stale(CachedStreamSummary?)
    case failed(SummaryFailure)
}

/// Explicit actor isolation also applies when a protocol source implements its
/// async method with approachable-concurrency caller isolation.
private actor SummaryRequestWorker {
    let source: any CompactSummarySource
    init(source: any CompactSummarySource) { self.source = source }
    func fetch(_ id: String, mode: StreamFetchMode) async throws
        -> APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummary> {
        try await source.summary(activityID: id, mode: mode)
    }
}

/// #217 handoff: configure through SyncController, observe state(for:) for
/// progress/retry and currentSummary(for:) for a retained last-good encoded DTO.
/// Call load only while a profile consumer is visible; cancel on disappearance.
/// The chart decodes and validates samples off-main only while visible.
@MainActor @Observable
final class StreamSummaryLoader {
    private(set) var states: [String: StreamSummaryState] = [:]
    /// Progress/retry status does not discard a valid last-good profile payload.
    /// Known invalidation removes current presentation immediately; stale DTOs
    /// remain readable only through the explicit stale state.
    private(set) var cachedSummaries: [String: CachedStreamSummary] = [:]
    func currentSummary(for activityID: String) -> CachedStreamSummary? {
        guard let session, session.user.stravaConnected,
              session.user.authentication.sessionExpiresAt > now(),
              let cached = cachedSummaries[activityID], cached.isCurrent else { return nil }
        return cached
    }
    private(set) var sessionRevision = 0
    var isOffline: Bool { session?.verified == false }
    private var session: SyncSession?
    private var storage: LocalStore?
    private var worker: SummaryRequestWorker?
    private var epoch = 0
    @ObservationIgnored private var requests: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var consumers: [String: Set<UUID>] = [:]
    @ObservationIgnored private var requestVersions: [String: Int] = [:]
    @ObservationIgnored private var observer: Task<Void, Never>?
    @ObservationIgnored private let source: (SyncSession) -> any CompactSummarySource
    @ObservationIgnored private let invalidate: (String) -> Void
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let sleep: @Sendable (TimeInterval) async throws -> Void
    let pollingWindow: TimeInterval
    let maxAttempts: Int

    init(
        pollingWindow: TimeInterval = 30, maxAttempts: Int = 6,
        now: @escaping @Sendable () -> Date = Date.init,
        sleep: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) },
        source: @escaping (SyncSession) -> any CompactSummarySource = {
            StreamsAPI(baseURL: $0.deployment, token: $0.token)
        }, invalidate: @escaping (String) -> Void = { _ in }
    ) {
        self.pollingWindow = pollingWindow
        self.maxAttempts = max(1, maxAttempts)
        self.now = now
        self.sleep = sleep
        self.source = source
        self.invalidate = invalidate
    }

    func configure(_ next: SyncSession?, storage: LocalStore) async {
        if let next, !next.user.stravaConnected || next.user.authentication.sessionExpiresAt <= now() {
            reset()
            self.storage = storage
            if next.user.stravaConnected { invalidate(next.token) }
            try? await storage.clear(scope: next.scope)
            return
        }
        if session?.scope == next?.scope, session?.token == next?.token, self.storage === storage {
            if session != next { sessionRevision &+= 1 }
            session = next
            return
        }
        reset()
        self.storage = storage
        session = next
        guard let next else { return }
        worker = SummaryRequestWorker(source: source(next))
        let current = epoch
        let changes = await storage.summaryChanges()
        guard current == epoch else { return }
        observer = Task { [weak self] in
            for await change in changes {
                guard !Task.isCancelled else { return }
                await self?.committed(change, epoch: current)
            }
        }
    }

    deinit { observer?.cancel(); for task in requests.values { task.cancel() } }

    func state(for activityID: String) -> StreamSummaryState { states[activityID] ?? .notRequested }
    func reset() {
        epoch &+= 1
        sessionRevision &+= 1
        for task in requests.values { task.cancel() }
        requests.removeAll()
        consumers.removeAll()
        requestVersions.removeAll()
        observer?.cancel()
        observer = nil
        states.removeAll()
        cachedSummaries.removeAll()
        session = nil
        worker = nil
    }
    func pause() { for id in Array(requests.keys) { cancel(activityID: id) } }
    func cancel(activityID: String) {
        consumers[activityID] = nil
        requests.removeValue(forKey: activityID)?.cancel()
        requestVersions[activityID, default: 0] &+= 1
        switch state(for: activityID) {
        case .loading: states[activityID] = .notRequested
        case .pending(let retryAt, _): states[activityID] = .pending(retryAt: retryAt, paused: true)
        default: break
        }
    }

    /// Concurrent consumers join one request. Explicit refresh alone uses
    /// refresh=true. Subsequent polls use auto, never repeat forced refreshes.
    func load(activityID: String, refresh: Bool = false) async {
        // Security cleanup must precede terminal/retry guards: a server wait
        // never extends the authorization of a warm cached summary.
        guard let session, let storage else { return }
        guard session.user.stravaConnected, session.user.authentication.sessionExpiresAt > now() else {
            reset()
            if session.user.stravaConnected { invalidate(session.token) }
            try? await storage.clear(scope: session.scope)
            return
        }
        if let request = requests[activityID] { await consume(request, activityID: activityID); return }
        if !refresh, case .failed(let failure) = state(for: activityID), !failure.retryable { return }
        if let deadline = retryDeadline(state(for: activityID)), deadline > now() { return }
        guard let worker else { return }
        let current = epoch
        let version = (requestVersions[activityID] ?? 0) + 1
        requestVersions[activityID] = version
        let request = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.valid(current, activityID, version) {
                    self.requests[activityID] = nil
                    if case .loading = self.state(for: activityID) { self.states[activityID] = .notRequested }
                }
            }
            await self.perform(activityID, refresh: refresh, session: session, storage: storage,
                               worker: worker, epoch: current, version: version)
        }
        requests[activityID] = request
        await consume(request, activityID: activityID)
    }

    /// A departing detail releases only its own demand. A newly visible detail
    /// can join the same request during a Map/List transition without losing it
    /// to the old view's asynchronous cancellation handler.
    private func consume(_ request: Task<Void, Never>, activityID: String) async {
        let consumer = UUID()
        consumers[activityID, default: []].insert(consumer)
        await withTaskCancellationHandler { await request.value } onCancel: {
            Task { @MainActor [weak self] in self?.release(consumer, activityID: activityID, cancelUnused: true) }
        }
        release(consumer, activityID: activityID, cancelUnused: Task.isCancelled)
    }

    private func release(_ consumer: UUID, activityID: String, cancelUnused: Bool) {
        guard consumers[activityID]?.remove(consumer) != nil else { return }
        if consumers[activityID]?.isEmpty == true {
            consumers[activityID] = nil
            if cancelUnused { cancel(activityID: activityID) }
        }
    }

    private func valid(_ current: Int, _ id: String, _ version: Int) -> Bool {
        current == epoch && requestVersions[id] == version && !Task.isCancelled
    }
    private func retryDeadline(_ state: StreamSummaryState) -> Date? {
        switch state { case .pending(let date, _): date; case .failed(let failure): failure.retryAt; default: nil }
    }
    private func cachedState(_ cached: CachedStreamSummary?) -> StreamSummaryState {
        guard let cached else { return .notRequested }
        if !cached.isCurrent { return .stale(cached) }
        // Generic summary availability is independent of chart readiness. Time
        // summaries are current data; the elevation consumer marks them unavailable.
        let summary = cached.dto.summary
        return summary?.basis != nil && (summary?.count ?? 0) > 0
            && cached.codec == "polyline-v1" && cached.algorithmVersion == 1
            ? .current(cached) : .unavailable(cached)
    }

    private func perform(_ id: String, refresh: Bool, session: SyncSession, storage: LocalStore,
                         worker: SummaryRequestWorker, epoch current: Int, version: Int) async {
        do {
            guard valid(current, id, version) else { return }
            _ = try StreamsAPI.validated(id)
            guard session.user.authentication.sessionExpiresAt > now(), session.user.stravaConnected else {
                reset()
                if session.user.stravaConnected { invalidate(session.token) }
                try await storage.clear(scope: session.scope)
                return
            }
            guard try await storage.summaryActivityExists(activityID: id, scope: session.scope) else {
                if valid(current, id, version) { states[id] = .notRequested }
                return
            }
            let cached = try await storage.cachedStreamSummary(activityID: id, scope: session.scope)
            guard valid(current, id, version) else { return }
            cachedSummaries[id] = cached
            states[id] = cachedState(cached)
            if cached?.isCurrent == true && !refresh { return }
            guard session.verified else {
                if cached == nil { states[id] = .failed(.init(message: "Offline · reconnect to load this profile", retryable: true, retryAt: nil, requestID: nil)) }
                return
            }
            states[id] = .loading
            var fence = await storage.streamFence()
            let stopAt = now().addingTimeInterval(max(0, pollingWindow))
            for attempt in 0..<maxAttempts {
                try Task.checkCancellation()
                guard valid(current, id, version) else { return }
                guard self.session?.user.stravaConnected == true else {
                    reset()
                    try await storage.clear(scope: session.scope)
                    return
                }
                guard self.session?.verified == true else {
                    if case .pending(let retryAt, _) = state(for: id) { states[id] = .pending(retryAt: retryAt, paused: true) }
                    else { states[id] = .failed(.init(message: "Offline · reconnect to load this profile", retryable: true, retryAt: nil, requestID: nil)) }
                    return
                }
                guard (self.session?.user.authentication.sessionExpiresAt ?? .distantPast) > now() else {
                    reset()
                    invalidate(session.token)
                    try await storage.clear(scope: session.scope)
                    return
                }
                do {
                    let response = try await worker.fetch(id, mode: refresh && attempt == 0 ? .refresh : .auto)
                    guard valid(current, id, version) else { return }
                    let currentFence = await storage.summaryFenceIsCurrent(fence, activityID: id, scope: session.scope)
                    guard valid(current, id, version) else { return }
                    guard currentFence else { cachedSummaries[id] = nil; return }
                    guard (self.session?.user.authentication.sessionExpiresAt ?? .distantPast) > now() else {
                        reset()
                        invalidate(session.token)
                        try await storage.clear(scope: session.scope)
                        return
                    }
                    guard response.payload.activityID == id else { throw APIClient.RequestError.decoding("Summary identity mismatch") }
                    if response.isPending {
                        // Pending may carry a last-good current summary. Cache it,
                        // but readiness remains pending until the authoritative 200.
                        let pendingWrite = try await storage.saveStreamSummary(response.payload, scope: session.scope, fence: fence,
                            now: now(), sessionExpiresAt: self.session?.user.authentication.sessionExpiresAt, notifyInvalidation: false)
                        guard valid(current, id, version) else { return }
                        if pendingWrite == .fenced { cachedSummaries[id] = nil; return }
                        let pendingCache = try await storage.cachedStreamSummary(activityID: id, scope: session.scope)
                        guard valid(current, id, version) else { return }
                        cachedSummaries[id] = pendingCache
                        if pendingWrite == .superseded { states[id] = cachedState(pendingCache); return }
                        fence = await storage.streamFence()
                        guard valid(current, id, version) else { return }
                        let deadline = max(now().addingTimeInterval(max(1, response.retryAfter ?? 3)),
                                           response.payload.nextRetryAt ?? .distantPast)
                        let paused = self.session?.verified != true || attempt + 1 == maxAttempts || deadline > stopAt
                        states[id] = .pending(retryAt: deadline, paused: paused)
                        if paused { return }
                        try await sleep(max(0, deadline.timeIntervalSince(now())))
                        continue
                    }
                    let result = try await storage.saveStreamSummary(response.payload, scope: session.scope, fence: fence,
                        now: now(), sessionExpiresAt: self.session?.user.authentication.sessionExpiresAt, notifyInvalidation: false)
                    guard valid(current, id, version) else { return }
                    if result == .fenced { cachedSummaries[id] = nil; return }
                    if result == .notCacheable, let lastError = response.payload.lastError {
                        let cached = try await storage.cachedStreamSummary(activityID: id, scope: session.scope)
                        guard valid(current, id, version) else { return }
                        cachedSummaries[id] = cached
                        let headerDeadline = response.retryAfter.map { now().addingTimeInterval(max(1, $0)) }
                        let deadline = [headerDeadline, response.payload.nextRetryAt].compactMap { $0 }.max()
                        states[id] = .failed(.init(message: "Profile fetch failed (\(lastError.code.rawValue))",
                                                  retryable: lastError.retryable, retryAt: deadline, requestID: response.requestID))
                    } else {
                        let committedCache = try await storage.cachedStreamSummary(activityID: id, scope: session.scope)
                        guard valid(current, id, version) else { return }
                        cachedSummaries[id] = committedCache
                        states[id] = result == .notCacheable ? .stale(committedCache) : cachedState(committedCache)
                    }
                    return
                } catch {
                    if Task.isCancelled || error is CancellationError { throw CancellationError() }
                    if AuthController.isExplicitlyUnauthenticated(error) {
                        reset()
                        invalidate(session.token)
                        try await storage.clear(scope: session.scope)
                        return
                    }
                    guard valid(current, id, version) else { return }
                    let failure = failure(error)
                    states[id] = .failed(failure)
                    guard self.session?.verified == true, failure.retryable, let deadline = failure.retryAt, attempt + 1 < maxAttempts,
                          deadline <= stopAt else { return }
                    try await sleep(max(0, deadline.timeIntervalSince(now())))
                }
            }
        } catch {
            guard valid(current, id, version) else { return }
            if error is CancellationError { states[id] = .notRequested }
            else { states[id] = .failed(failure(error)) }
        }
    }

    private func failure(_ error: Error) -> SummaryFailure {
        var retryable = false
        var delay: TimeInterval?
        var requestID: String?
        switch error as? APIClient.RequestError {
        case .rateLimited(let seconds, let id): retryable = true; delay = seconds; requestID = id
        case .server(_, _, _, let id, let retry, let seconds): retryable = retry; delay = seconds; requestID = id
        case .serviceUnavailable(let seconds, let id): retryable = true; delay = seconds; requestID = id
        case .transport: retryable = true
        default: break
        }
        return .init(message: String(describing: error), retryable: retryable,
                     retryAt: delay.map { now().addingTimeInterval(max(1, $0)) }, requestID: requestID)
    }

    private func committed(_ change: SummaryStoreChange, epoch current: Int) async {
        guard current == epoch, let session, let storage,
              change.scope == nil || change.scope == session.scope.key else { return }
        let ids = change.activityIDs ?? Set(states.keys).union(requests.keys)
        for id in ids {
            let wasObserved = states[id] != nil || requests[id] != nil
            cancel(activityID: id)
            guard wasObserved else { continue }
            let version = requestVersions[id]
            cachedSummaries[id] = nil
            do {
                let cached = try await storage.cachedStreamSummary(activityID: id, scope: session.scope)
                guard current == epoch else { return }
                guard requestVersions[id] == version else { continue }
                cachedSummaries[id] = cached
                states[id] = cachedState(cached)
            } catch {
                if current == epoch, requestVersions[id] == version { states[id] = .failed(failure(error)) }
            }
        }
    }
}

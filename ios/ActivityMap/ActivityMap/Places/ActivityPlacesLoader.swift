import Foundation
import Observation

private actor PlacesWorker {
    let source: any ActivityPlacesSource
    init(_ source: any ActivityPlacesSource) { self.source = source }
    func places(_ id: String) async throws -> ActivityMapAPI.ActivityPlaces { try await source.places(activityID: id) }
}

@MainActor @Observable final class ActivityPlacesLoader {
    private(set) var results: [String: ActivityMapAPI.ActivityPlaces] = [:]
    private(set) var loading: Set<String> = []
    private(set) var failures: [String: String] = [:]
    private(set) var sessionRevision = 0
    var focus: PlaceFocus?
    @ObservationIgnored private var session: SyncSession?
    @ObservationIgnored private var storage: LocalStore?
    @ObservationIgnored private var worker: PlacesWorker?
    @ObservationIgnored private var epoch = 0
    @ObservationIgnored private var demands: [UUID: Set<String>] = [:]
    @ObservationIgnored private var priority: String?
    @ObservationIgnored private var queue: [String] = []
    @ObservationIgnored private var tasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var sourceRetries: Set<String> = []
    @ObservationIgnored private var retryAt: [String: Date] = [:]
    @ObservationIgnored private var observer: Task<Void, Never>?
    @ObservationIgnored private var validatedAt: [String: Date] = [:]
    private let now: @Sendable () -> Date
    private let source: (SyncSession) -> any ActivityPlacesSource
    private let invalidate: (String) -> Void

    init(now: @escaping @Sendable () -> Date = Date.init, source: @escaping (SyncSession) -> any ActivityPlacesSource = {
        ActivityPlacesAPI(baseURL: $0.deployment, token: $0.token)
    }, invalidate: @escaping (String) -> Void = { _ in }) {
        self.now = now; self.source = source; self.invalidate = invalidate
    }
    deinit { observer?.cancel(); for task in tasks.values { task.cancel() } }
    func reset() {
        epoch += 1; sessionRevision += 1
        tasks.values.forEach { $0.cancel() }; tasks.removeAll()
        observer?.cancel(); observer = nil;
        demands.removeAll(); queue.removeAll(); loading.removeAll(); failures.removeAll()
        results.removeAll(); retryAt.removeAll(); sourceRetries.removeAll(); focus = nil; session = nil; worker = nil
        validatedAt.removeAll()
    }
    func configure(_ next: SyncSession?, storage: LocalStore) async {
        if session?.scope == next?.scope, session?.token == next?.token, session != nil {
            session = next; self.storage = storage; sessionRevision += 1; return
        }
        reset(); self.storage = storage
        guard let next, next.user.stravaConnected, next.user.authentication.sessionExpiresAt > .now else { return }
        session = next; worker = PlacesWorker(source(next))
        let current = epoch
        guard current == epoch else { return }
        let changes = await storage.summaryChanges()
        observer = Task { [weak self] in
            for await change in changes {
                guard let self, !Task.isCancelled, self.epoch == current else { return }
                guard change.scope == nil || change.scope == next.scope.key else { continue }
                let ids = change.activityIDs ?? Set(self.results.keys).union(self.loading)
                if !change.cancelsRequests {
                    // A summary becoming available need not change its input.
                    // Preserve shared in-flight matching; its disk write checks
                    // the latest summary identity before publication.
                    for id in ids where self.results[id] != nil {
                        let cached = try? await storage.cachedActivityPlaces(activityID: id, scope: next.scope)
                        guard self.epoch == current, !Task.isCancelled else { return }
                        if cached == nil {
                            self.results[id] = nil; self.retryAt[id] = nil
                            if self.focus?.activityID == id { self.focus = nil }
                        }
                    }
                    self.enqueueDemand()
                    continue
                }
                for id in ids {
                    self.results[id] = nil; self.failures[id] = nil; self.retryAt[id] = nil
                    // Cancelled tasks still occupy a queue slot until they retire.
                    self.tasks[id]?.cancel()
                }
                if self.focus.map({ ids.contains($0.activityID) }) == true { self.focus = nil }
                self.enqueueDemand()
            }
        }
    }
    private var usable: Bool {
        session?.user.stravaConnected == true && (session?.user.authentication.sessionExpiresAt ?? .distantPast) > .now
    }
    func result(_ id: String) -> ActivityMapAPI.ActivityPlaces? { usable ? results[id] : nil }
    func demand(_ ids: Set<String>, owner: UUID, priority: String? = nil) {
        demands[owner] = ids; if let priority { self.priority = priority }
        cancelUndemanded()
        enqueueDemand()
    }
    func release(_ owner: UUID) {
        demands[owner] = nil
        cancelUndemanded()
    }
    private func cancelUndemanded() {
        let wanted = demanded
        queue.removeAll { !wanted.contains($0) }
        for (id, task) in tasks where !wanted.contains(id) { task.cancel() }
    }
    private var demanded: Set<String> { demands.values.reduce(into: Set<String>()) { $0.formUnion($1) } }
    private func enqueueDemand() {
        guard usable else { return }
        for id in demanded.sorted() where tasks[id] == nil && !queue.contains(id) {
            if results[id]?.status == .complete && (!(session?.verified ?? false) || validatedAt[id].map { now().timeIntervalSince($0) < 86400 } == true) { continue }
            if let retry = retryAt[id], retry > .now { continue }
            queue.append(id)
        }
        if let priority, let index = queue.firstIndex(of: priority) { queue.remove(at: index); queue.insert(priority, at: 0) }
        pump()
    }
    private func pump() {
        guard usable, let session, let storage, let worker else { return }
        while tasks.count < 2, !queue.isEmpty {
            let id = queue.removeFirst(); let current = epoch
            guard demanded.contains(id) else { continue }
            loading.insert(id)
            tasks[id] = Task { [weak self] in
                guard let self else { return }
                defer {
                    if current == self.epoch {
                        self.tasks[id] = nil; self.loading.remove(id)
                        // An invalidation may have cancelled this request while demand remained.
                        self.enqueueDemand()
                    }
                }
                do {
                    let cached = try await storage.cachedActivityPlaces(activityID: id, scope: session.scope)
                    try Task.checkCancellation()
                    if let cached {
                        guard current == self.epoch else { return }
                        self.results[id] = cached.dto; self.validatedAt[id] = cached.storedAt
                        if cached.dto.status == .complete {
                            if !session.verified || self.now().timeIntervalSince(cached.storedAt) < 86400 { return }
                        } else if cached.storedAt.addingTimeInterval(900) > .now {
                            self.retryAt[id] = cached.storedAt.addingTimeInterval(900); return
                        }
                    }
                    guard session.verified else {
                        self.failures[id] = "Places not saved offline. Connect to load them."
                        self.retryAt[id] = .now.addingTimeInterval(60); return
                    }
                    let fence = await storage.streamFence()
                    let dto = try await worker.places(id)
                    try Task.checkCancellation()
                    guard current == self.epoch, self.usable else { return }
                    guard dto.userID == session.scope.userID else {
                        self.failures[id] = "Couldn’t load places."
                        self.retryAt[id] = .now.addingTimeInterval(900)
                        return
                    }
                    let saved = try await storage.saveActivityPlaces(dto, scope: session.scope, fence: fence, now: self.now())
                    guard current == self.epoch, !Task.isCancelled else { return }
                    guard saved else {
                        let exists = try await storage.summaryActivityExists(activityID: id, scope: session.scope)
                        guard current == self.epoch, !Task.isCancelled else { return }
                        self.failures[id] = "Recorded route data changed. Try again."
                        if self.sourceRetries.insert(id).inserted && exists { self.retryAt[id] = nil }
                        else { self.retryAt[id] = .now.addingTimeInterval(60) }
                        return
                    }
                    guard current == self.epoch, !Task.isCancelled else { return }
                    if let identity = PlaceMatchingIdentity(dto) {
                        for (otherID, result) in self.results {
                            if let other = PlaceMatchingIdentity(result), other != identity {
                                self.results[otherID] = nil; self.validatedAt[otherID] = nil; self.retryAt[otherID] = nil
                                if self.focus?.activityID == otherID { self.focus = nil }
                            }
                        }
                    }
                    self.results[id] = dto; self.validatedAt[id] = self.now(); self.failures[id] = nil
                    if dto.status != .complete { self.retryAt[id] = .now.addingTimeInterval(900) }
                } catch is CancellationError {
                    // Scope/source fencing owns cancellation; no user-facing error.
                } catch {
                    guard current == self.epoch, !Task.isCancelled else { return }
                    if AuthController.isExplicitlyUnauthenticated(error) {
                        self.reset(); self.invalidate(session.token); try? await storage.clear(scope: session.scope); return
                    }
                    if let requestError = error as? APIClient.RequestError,
                       case .server(let code, _, _, _, _, _) = requestError,
                       code == "activity_changed", self.sourceRetries.insert(id).inserted {
                        self.retryAt[id] = nil
                        return
                    }
                    self.failures[id] = "Couldn’t load places."
                    self.retryAt[id] = .now.addingTimeInterval(max(60, APIClient.errorFacts(for: error).retryAfter ?? 0))
                }
            }
        }
    }
    /// Ordinary sync only rechecks demanded entries whose saved result is old.
    func revalidateDemanded() { enqueueDemand() }
}

nonisolated struct PlaceFocus: Equatable {
    let activityID: String
    let placeID: String
    var revealOnMap = false
}

import Foundation
import Observation

/// Reads synchronized place bundles from local storage. Backend jobs own all
/// matching and library sync delivers their results, so a demand never makes a
/// network request: missing or pending routes simply wait for a later sync.
@MainActor @Observable final class ActivityPlacesLoader {
    private(set) var results: [String: ActivityMapAPI.ActivityPlaces] = [:]
    private(set) var overviewResults: [String: ActivityMapAPI.ActivityPlaces] = [:]
    private(set) var overviewLoading = false
    private(set) var sessionRevision = 0
    var focus: PlaceFocus?
    @ObservationIgnored private var session: SyncSession?
    @ObservationIgnored private var storage: LocalStore?
    @ObservationIgnored private var epoch = 0
    @ObservationIgnored private var demands: [UUID: Set<String>] = [:]
    @ObservationIgnored private var overviewDemands: [UUID: Set<String>] = [:]
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var overviewTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var overviewGeneration = 0
    @ObservationIgnored private var observer: Task<Void, Never>?

    deinit { observer?.cancel(); task?.cancel(); overviewTask?.cancel() }
    func reset() {
        epoch += 1; sessionRevision += 1
        observer?.cancel(); observer = nil
        task?.cancel(); task = nil; generation += 1
        overviewTask?.cancel(); overviewTask = nil; overviewGeneration += 1
        demands.removeAll(); overviewDemands.removeAll()
        results.removeAll(); overviewResults.removeAll(); overviewLoading = false
        focus = nil; session = nil
    }
    func configure(_ next: SyncSession?, storage: LocalStore) async {
        if session?.scope == next?.scope, session?.token == next?.token, session != nil {
            session = next; self.storage = storage; sessionRevision += 1; return
        }
        reset(); self.storage = storage
        guard let next, next.user.stravaConnected, next.user.authentication.sessionExpiresAt > .now else { return }
        session = next
        let current = epoch
        let changes = await storage.summaryChanges()
        guard current == epoch else { return }
        observer = Task { [weak self] in
            for await change in changes {
                guard let self, !Task.isCancelled, self.epoch == current else { return }
                guard change.scope == nil || change.scope == next.scope.key else { continue }
                self.refresh(); self.refreshOverview()
            }
        }
    }
    private var usable: Bool {
        session?.user.stravaConnected == true && (session?.user.authentication.sessionExpiresAt ?? .distantPast) > .now
    }
    func result(_ id: String) -> ActivityMapAPI.ActivityPlaces? { usable ? (results[id] ?? overviewResults[id]) : nil }
    func demand(_ ids: Set<String>, owner: UUID, priority: String? = nil, cachedOnly: Set<String> = []) {
        if demands[owner] != ids { demands[owner] = ids; refresh() }
        if overviewDemands[owner] != cachedOnly { overviewDemands[owner] = cachedOnly; refreshOverview() }
    }
    func release(_ owner: UUID) {
        demands[owner] = nil; overviewDemands[owner] = nil
        refresh(); refreshOverview()
    }
    /// Sync completion rereads demanded routes; change notifications already
    /// cover committed bundles, so this is a cheap local catch-up.
    func revalidateDemanded() { refresh() }

    /// Selected routes keep every synchronized status, so pending, missing GPS
    /// and coverage results stay distinct from a completed zero.
    private func refresh() {
        generation += 1
        let generation = generation, current = epoch
        task?.cancel()
        let ids = demands.values.reduce(into: Set<String>()) { $0.formUnion($1) }
        results = results.filter { ids.contains($0.key) }
        guard usable, !ids.isEmpty, let session, let storage else { return }
        task = Task { [weak self] in
            var next: [String: ActivityMapAPI.ActivityPlaces] = [:]
            do {
                for id in ids {
                    try Task.checkCancellation()
                    if let dto = try await storage.cachedActivityPlaces(activityID: id, scope: session.scope) { next[id] = dto }
                }
            } catch { return /* Existing valid results stay available. */ }
            guard let self, current == self.epoch, generation == self.generation, self.usable else { return }
            self.results = next
            self.dropRemovedFocus()
        }
    }
    private func refreshOverview() {
        overviewGeneration += 1
        let generation = overviewGeneration, current = epoch
        overviewTask?.cancel()
        let ids = overviewDemands.values.reduce(into: Set<String>()) { $0.formUnion($1) }
        overviewResults = overviewResults.filter { ids.contains($0.key) }
        guard usable, !ids.isEmpty, let session, let storage else {
            overviewLoading = false
            return
        }
        overviewLoading = true
        overviewTask = Task { [weak self] in
            guard let self else { return }
            defer { if current == self.epoch, generation == self.overviewGeneration { self.overviewLoading = false } }
            do {
                let cached = try await storage.cachedMapPlaces(activityIDs: ids, scope: session.scope)
                try Task.checkCancellation()
                guard current == self.epoch, generation == self.overviewGeneration, self.usable else { return }
                self.overviewResults = cached
                self.dropRemovedFocus()
            } catch { /* Existing valid results stay available while offline. */ }
        }
    }
}

extension ActivityPlacesLoader {
    /// A replacement, zero result or invalidation removes a focused place.
    fileprivate func dropRemovedFocus() {
        guard let focus, result(focus.activityID)?.places.contains(where: { $0.id == focus.placeID }) != true else { return }
        self.focus = nil
    }
}

nonisolated struct PlaceFocus: Equatable {
    let activityID: String
    let placeID: String
    var revealOnMap = false
}

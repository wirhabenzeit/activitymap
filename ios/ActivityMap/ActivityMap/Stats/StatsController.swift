import Foundation
import Observation

/// All non-date predicates participate in the cache key. Date, selection,
/// sorting/density, chart dimensions and map camera deliberately do not.
struct StatsFilterScope: Hashable {
    let sports: Set<SportType>
    let search: String
    let distance: NumericFilter?
    let elevation: NumericFilter?
    let elapsed: NumericFilter?
    let commute: Bool?
    let isPrivate: Bool?
    let flagged: Bool?
    init(_ store: ActivityStore) {
        sports = store.activeSportTypes
        search = store.searchText.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping.lowercased()
        distance = store.distanceFilter; elevation = store.elevationFilter; elapsed = store.durationFilter
        commute = store.commuteOnly; isPrivate = store.privateFilter; flagged = store.flaggedFilter
    }
}

/// History completeness is separate from measured totals. Consumers may draw
/// incomplete/cached data with this disclosure, but must not certify zero
/// buckets as recorded inactivity when history is unavailable.
struct StatsPresentation: Equatable {
    enum State: Equatable { case unavailable, loading, noHistory, noMatches, ready, incomplete, cached, error }
    let state: State
    let hasContent: Bool
    let historyComplete: Bool
    let message: String?
    let retryAllowed: Bool

    /// Offline fixture/preview hosts have no sync controller. Production waits
    /// for its controller instead of flashing an empty completed library.
    init(store: ActivityStore, preparing: Bool) {
        historyComplete = !preparing
        retryAllowed = false
        hasContent = !preparing && store.stats.matchingActivityCount(for: store) > 0
        state = preparing ? .loading : store.activities.isEmpty ? .noHistory : hasContent ? .ready : .noMatches
        message = preparing ? "Loading activity history…" : state == .noHistory ? "No activity history" : state == .noMatches ? "No matching activities" : nil
    }

    init(store: ActivityStore, sync: SyncController) {
        let content = !store.activities.isEmpty
        let filtered = store.stats.matchingActivityCount(for: store) > 0
        historyComplete = sync.hasCompletedCache
        retryAllowed = sync.canRefresh
        switch sync.status {
        case .signedOut, .expired, .disconnected:
            state = .unavailable; hasContent = false; message = sync.status.title
        case .syncing, .paused:
            state = content ? .incomplete : .loading; hasContent = filtered
            message = content ? "History is still loading. Comparisons may be incomplete." : "Loading activity history…"
        case .offline, .rateLimited, .retryAfter:
            state = sync.hasCompletedCache ? .cached : .error; hasContent = filtered
            message = sync.status.title
        case .failed(let error):
            state = .error; hasContent = filtered; message = error
        case .ready:
            state = !content ? .noHistory : (!filtered ? .noMatches : .ready)
            hasContent = filtered; message = !content ? "No activity history" : (!filtered ? "No matching activities" : nil)
        }
    }
}

@MainActor @Observable final class StatsController {
    private struct Key: Hashable {
        let epoch: Int
        let revision: Int
        let filters: StatsFilterScope
    }
    private(set) var reportingDay = StatsDates.localToday()
    private(set) var aggregationCount = 0
    private(set) var indexedActivityCount = 0
    @ObservationIgnored private var epoch = 0
    @ObservationIgnored private var cached: (Key, StatsEngine)?
    @ObservationIgnored private var scoped: (Key, [StatsActivity])?
    @ObservationIgnored private var results: [ResultKey: StatsResult] = [:]
    @ObservationIgnored private var resultOrder: [ResultKey] = []
    @ObservationIgnored private var resultWork: (ResultKey, UUID, Task<StatsResult?, Never>)?
    private(set) var calculationCount = 0
    private struct ResultKey: Hashable { let source: Key; let today: Int; let query: StatsQuery }
    @ObservationIgnored private var draining: Task<StatsEngine, Never>?
    @ObservationIgnored private var drainingResult: Task<StatsResult?, Never>?
    @ObservationIgnored private var pending: (Key, UUID, Task<StatsEngine, Never>)?
    @ObservationIgnored private let build: @Sendable ([StatsActivity]) async -> StatsEngine

    init(build: @escaping @Sendable ([StatsActivity]) async -> StatsEngine = { StatsEngine(activities: $0) }) { self.build = build }

    /// Called on foreground and the existing minute refresh, and by consumers
    /// on demand. The index is reusable: a day rollover changes windows, not
    /// activity wall-clock dates or the metadata/filter revision.
    func refreshToday(now: Date = Date(), timeZone: TimeZone = .current) {
        let day = StatsDates.localToday(now: now, timeZone: timeZone)
        if reportingDay != day {
            reportingDay = day
            results = [:]; resultOrder = []
        }
    }
    func clearScope() {
        epoch &+= 1
        draining = pending?.2 ?? draining
        draining?.cancel(); pending = nil; cached = nil; scoped = nil
        indexedActivityCount = 0
        drainingResult = resultWork?.2 ?? drainingResult
        drainingResult?.cancel(); resultWork = nil; results = [:]; resultOrder = []
    }

    private func metadata(for store: ActivityStore, key: Key) -> [StatsActivity] {
        if scoped?.0 == key { return scoped!.1 }
        let metadata = store.statsActivities.map {
            StatsActivity(id: $0.id, name: $0.name, sport: $0.category, start: $0.startDateLocal,
                          distance: $0.distance, movingTime: $0.movingTime.map(Double.init), elevation: $0.totalElevationGain)
        }
        scoped = (key, metadata)
        return metadata
    }
    func matchingActivityCount(for store: ActivityStore) -> Int {
        metadata(for: store, key: Key(epoch: epoch, revision: store.activitiesRevision, filters: StatsFilterScope(store))).count
    }

    /// Single retained index and single in-flight job bound memory across
    /// filter edits. Requests coalesce; old account/filter/replacement results
    /// cannot be published after their asynchronous aggregation completes.
    func engine(for store: ActivityStore) async -> StatsEngine? {
        let key = Key(epoch: epoch, revision: store.activitiesRevision, filters: StatsFilterScope(store))
        if cached?.0 == key { return cached?.1 }
        let ticket: UUID, task: Task<StatsEngine, Never>
        if let work = pending, work.0 == key {
            ticket = work.1; task = work.2
        } else {
            let previous = pending?.2 ?? draining
            previous?.cancel()
            let build = build
            ticket = UUID()
            // Serialize expensive jobs. Cancelled waiters hold no copied
            // metadata; only the latest still-current request starts a build.
            task = Task {
                _ = await previous?.value
                guard !Task.isCancelled, epoch == key.epoch, store.activitiesRevision == key.revision,
                      StatsFilterScope(store) == key.filters else { return StatsEngine(activities: []) }
                let metadata = metadata(for: store, key: key)
                aggregationCount += 1
                let worker = Task.detached(priority: .userInitiated) { await build(metadata) }
                return await withTaskCancellationHandler { await worker.value } onCancel: { worker.cancel() }
            }
            pending = (key, ticket, task)
        }
        let engine = await task.value
        guard !Task.isCancelled else { return nil }
        guard epoch == key.epoch, store.activitiesRevision == key.revision,
              StatsFilterScope(store) == key.filters, pending?.1 == ticket else {
            if pending?.1 == ticket { pending = nil }
            // A coalesced caller can observe the already accepted index.
            return cached?.0 == key && epoch == key.epoch && store.activitiesRevision == key.revision
                && StatsFilterScope(store) == key.filters ? cached?.1 : nil
        }
        cached = (key, engine); pending = nil; draining = nil
        results = results.filter { $0.key.source == key }; resultOrder = resultOrder.filter { $0.source == key }
        indexedActivityCount = engine.indexedActivityCount
        return engine
    }
    /// Cached typed output for dashboard/history consumers. Sixteen requests
    /// cap retained chart/history buffers. Work is serialized and fenced by
    /// scope, metadata, non-date filters, reporting day and exact arguments.
    func result(_ query: StatsQuery, for store: ActivityStore) async -> StatsResult? {
        let source = Key(epoch: epoch, revision: store.activitiesRevision, filters: StatsFilterScope(store))
        let key = ResultKey(source: source, today: reportingDay, query: query)
        if let result = results[key] { return result }
        guard let engine = await engine(for: store), !Task.isCancelled, epoch == source.epoch,
              store.activitiesRevision == source.revision, StatsFilterScope(store) == source.filters,
              reportingDay == key.today else { return nil }
        let ticket: UUID, work: Task<StatsResult?, Never>
        if let pending = resultWork, pending.0 == key { ticket = pending.1; work = pending.2 }
        else {
            let previous = resultWork?.2 ?? drainingResult
            ticket = UUID()
            work = Task {
                _ = await previous?.value
                guard !Task.isCancelled, epoch == source.epoch, store.activitiesRevision == source.revision,
                      StatsFilterScope(store) == source.filters, reportingDay == key.today else { return nil }
                calculationCount += 1
                let worker = Task.detached(priority: .userInitiated) { engine.evaluate(query, today: key.today) }
                return await withTaskCancellationHandler { await worker.value } onCancel: { worker.cancel() }
            }
            resultWork = (key, ticket, work)
        }
        let result = await work.value
        guard let result, !Task.isCancelled, epoch == source.epoch, store.activitiesRevision == source.revision,
              StatsFilterScope(store) == source.filters, reportingDay == key.today else { return nil }
        if results[key] == nil {
            resultOrder.append(key)
            if resultOrder.count > 16 { results.removeValue(forKey: resultOrder.removeFirst()) }
        }
        results[key] = result
        if resultWork?.1 == ticket { resultWork = nil; drainingResult = nil }
        return result
    }
    var retainedResultCount: Int { results.count }
}

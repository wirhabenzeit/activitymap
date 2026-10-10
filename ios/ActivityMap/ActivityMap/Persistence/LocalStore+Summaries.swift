import Foundation
import SwiftData

nonisolated struct SummaryStoreChange: Sendable {
    let scope: String?
    /// nil denotes scope replacement/security cleanup; only observed IDs reload.
    let activityIDs: Set<String>?
    /// Invalidation must cancel demand. A prefetch publication must not cancel
    /// a user-requested refresh or pending foreground fetch already in flight.
    let cancelsRequests: Bool
}

nonisolated struct SummarySyncCandidate: Sendable {
    let activityID: String
    let metadata: ActivityMapAPI.StreamMetadata
    let startDate: Date
}

extension LocalStore {
    func summaryChanges() -> AsyncStream<SummaryStoreChange> {
        let id = UUID()
        return AsyncStream(bufferingPolicy: .unbounded) { continuation in
            summaryObservers[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { await self?.removeSummaryObserver(id) }
            }
        }
    }
    private func removeSummaryObserver(_ id: UUID) { summaryObservers[id] = nil }
    func notifySummaryChange(scope: String?, activityIDs: Set<String>? = nil, cancelsRequests: Bool = true) {
        for observer in summaryObservers.values {
            observer.yield(SummaryStoreChange(scope: scope, activityIDs: activityIDs, cancelsRequests: cancelsRequests))
        }
    }
    func streamFence() -> StreamFence { streamFences.capture() }

    /// Inspect identities only; compact series stay encoded during sync. This
    /// includes indoor activities with time, heart-rate or power summaries.
    func summarySyncCandidates(scope: StoreScope) throws -> [SummarySyncCandidate] {
        try Task.checkCancellation()
        let context = makeContext()
        let key = scope.key
        let cached = Dictionary(uniqueKeysWithValues: try context.fetch(FetchDescriptor<StoredStreamSummary>(
            predicate: #Predicate { $0.scope == key })).map { ($0.activityID, $0) })
        return try context.fetch(FetchDescriptor<StoredActivity>(predicate: #Predicate { $0.scope == key }))
            .compactMap { row in
                let activity = try row.decoded()
                guard let metadata = activity.streams, metadata.state == .current else { return nil }
                if let saved = cached[activity.id], !saved.invalidated, saved.summaryVersion != nil,
                   !StreamRevision.supersedes(metadata, generation: saved.generation, revision: saved.revision) { return nil }
                return SummarySyncCandidate(activityID: activity.id, metadata: metadata, startDate: activity.startDate)
            }.sorted {
                $0.startDate == $1.startDate ? $0.activityID < $1.activityID : $0.startDate > $1.startDate
            }
    }

    func cachedStreamSummary(activityID: String, scope: StoreScope) throws -> CachedStreamSummary? {
        let key = StoreScope.key([scope.key, activityID])
        return try makeContext().fetch(FetchDescriptor<StoredStreamSummary>(
            predicate: #Predicate { $0.key == key })).first?.decoded()
    }
    func summaryActivityExists(activityID: String, scope: StoreScope) throws -> Bool {
        let key = StoreScope.key([scope.key, activityID])
        return try makeContext().fetchCount(FetchDescriptor<StoredActivity>(
            predicate: #Predicate { $0.key == key })) > 0
    }
    func summaryFenceIsCurrent(_ fence: StreamFence, activityID: String, scope: StoreScope) -> Bool {
        streamFences.admits(fence, keys: [scope.key, StoreScope.key([scope.key, activityID])])
    }

    @discardableResult
    func saveStreamSummary(
        _ dto: ActivityMapAPI.ActivityCompactStreamSummary, scope: StoreScope,
        fence: StreamFence, now: Date = .now, sessionExpiresAt: Date? = nil, notifyInvalidation: Bool = true
    ) throws -> StreamCacheWrite {
        try Task.checkCancellation()
        guard sessionExpiresAt.map({ $0 > now }) ?? true else { return .fenced }
        let key = StoreScope.key([scope.key, dto.activityID])
        guard summaryFenceIsCurrent(fence, activityID: dto.activityID, scope: scope) else { return .fenced }
        let context = makeContext()
        guard let activity = try context.fetch(FetchDescriptor<StoredActivity>(
            predicate: #Predicate { $0.key == key })).first else { return .fenced }
        let synced = try activity.decoded().streams
        let existing = try context.fetch(FetchDescriptor<StoredStreamSummary>(
            predicate: #Predicate { $0.key == key })).first
        if let existing {
            let replacesRecreated = existing.invalidated && synced?.generation == dto.metadata.generation
                && existing.generation != dto.metadata.generation
            let order = StreamRevision.compare(dto.metadata.revision, existing.revision)
            if !replacesRecreated && (order == .orderedAscending || (order == .orderedSame && streamFences.wroteLater(than: fence, key: key))) {
                return .superseded
            }
        }
        guard dto.metadata.state == .current else {
            if let existing, !existing.invalidated, StreamRevision.supersedes(dto.metadata, generation: existing.generation, revision: existing.revision) {
                existing.invalidated = true
                try save(context)
                streamFences.invalidate(key)
                if notifyInvalidation { notifySummaryChange(scope: scope.key, activityIDs: [dto.activityID]) }
            }
            return .notCacheable
        }
        let invalidated = synced.map {
            StreamRevision.supersedes($0, generation: dto.metadata.generation, revision: dto.metadata.revision)
        } ?? false
        do {
            if let existing { try existing.update(dto: dto, invalidated: invalidated, now: now) }
            else { context.insert(try StoredStreamSummary(scope: scope.key, dto: dto, invalidated: invalidated, now: now)) }
            try Task.checkCancellation()
            try save(context)
        } catch { context.rollback(); throw error }
        streamFences.recordWrite(fence, key: key)
        return .stored
    }

    /// Runs inside the activity transaction. Never reads compact series or raw
    /// streams during ordinary sync. Compare identities against newer direct data.
    func reconcileSummaryUpsert(
        _ dto: ActivityMapAPI.Activity, previous: ActivityMapAPI.Activity?,
        scopeKey: String, context: ModelContext
    ) throws -> Bool {
        let key = StoreScope.key([scopeKey, dto.id])
        let cached = try context.fetch(FetchDescriptor<StoredStreamSummary>(
            predicate: #Predicate { $0.key == key })).first
        let invalidates: Bool
        if let metadata = dto.streams {
            if let cached {
                invalidates = StreamRevision.supersedes(metadata, generation: cached.generation, revision: cached.revision)
            } else if let old = previous?.streams {
                invalidates = StreamRevision.supersedes(metadata, generation: old.generation, revision: old.revision)
            } else { invalidates = metadata.state == .stale }
        } else {
            invalidates = previous.map { Self.summarySourceChanged($0, dto) } ?? false
        }
        if invalidates { cached?.invalidated = true }
        return invalidates
    }

    /// #213's atomic snapshot replacement calls this BEFORE its save. Existing
    /// summaries survive when the authoritative activity still agrees with them.
    func reconcileSummaryReplacement(
        _ activities: [ActivityMapAPI.Activity], scopeKey: String, context: ModelContext
    ) throws {
        let ids = Set(activities.map(\.id))
        for row in try context.fetch(FetchDescriptor<StoredStreamSummary>(
            predicate: #Predicate { $0.scope == scopeKey })) where !ids.contains(row.activityID) {
            context.delete(row)
        }
        for dto in activities {
            let key = StoreScope.key([scopeKey, dto.id])
            let previous = try context.fetch(FetchDescriptor<StoredActivity>(
                predicate: #Predicate { $0.key == key })).first?.decoded()
            let cached = try context.fetch(FetchDescriptor<StoredStreamSummary>(
                predicate: #Predicate { $0.key == key })).first
            // A changed authoritative ACTIVITY generation detects delete/recreate
            // with reset revision. A snapshot still matching the prior activity
            // generation may lag a newer direct response from a later generation.
            if let cached, let metadata = dto.streams, metadata.generation != cached.generation,
               previous?.streams?.generation != metadata.generation {
                cached.invalidated = true
            } else {
                _ = try reconcileSummaryUpsert(dto, previous: previous, scopeKey: scopeKey, context: context)
            }
        }
    }
    /// Called only AFTER an authoritative replacement has committed.
    func summaryReplacementCommitted(scopeKey: String) {
        streamFences.invalidate(scopeKey)
        notifySummaryChange(scope: scopeKey)
    }

    private static func summarySourceChanged(_ old: ActivityMapAPI.Activity, _ new: ActivityMapAPI.Activity) -> Bool {
        old.athlete != new.athlete || old.mapID != new.mapID || old.mapPolyline != new.mapPolyline
        || old.mapSummaryPolyline != new.mapSummaryPolyline || old.startDate != new.startDate
        || old.startDateLocal != new.startDateLocal || old.distance != new.distance
        || old.movingTime != new.movingTime || old.elapsedTime != new.elapsedTime
        || old.startLatlng != new.startLatlng || old.endLatlng != new.endLatlng
        || old.totalElevationGain != new.totalElevationGain || old.elevHigh != new.elevHigh || old.elevLow != new.elevLow
        || old.sportType != new.sportType || old.manual != new.manual || old.private != new.private
        || old.trainer != new.trainer || old.hasHeartrate != new.hasHeartrate
        || old.heartrateOptOut != new.heartrateOptOut || old.displayHideHeartrateOption != new.displayHideHeartrateOption
        || old.averageHeartrate != new.averageHeartrate || old.maxHeartrate != new.maxHeartrate
        || old.deviceWatts != new.deviceWatts || old.averageWatts != new.averageWatts || old.maxWatts != new.maxWatts
        || old.weightedAverageWatts != new.weightedAverageWatts || old.kilojoules != new.kilojoules
    }
}

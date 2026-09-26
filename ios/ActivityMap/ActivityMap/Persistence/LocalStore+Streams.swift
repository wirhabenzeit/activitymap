import Foundation
import SwiftData

/// On-demand stream cache. Raw samples and summaries are stored and read
/// independently; neither is touched by snapshots or sync pagination.
///
/// Writes are fenced: capture `streamFence()` before a request and pass it
/// with the response. A tombstone, a scope clear, an account/deployment
/// transition or a sync invalidation after the capture discards the write, so
/// a late response can never recreate deleted or superseded data — including
/// after an activity is deleted and recreated with the same ID.
extension LocalStore {
    func streamFence() -> StreamFence { streamFences.capture() }

    func cachedStreamSummary(activityID: String, scope: StoreScope) throws -> CachedStreamSummary? {
        let key = StoreScope.key([scope.key, activityID])
        return try makeContext().fetch(FetchDescriptor<StoredStreamSummary>(
            predicate: #Predicate { $0.key == key })).first?.decoded()
    }

    /// Cached summaries keyed by activity ID; uncached activities are absent.
    func cachedStreamSummaries(activityIDs: [String], scope: StoreScope) throws -> [String: CachedStreamSummary] {
        let scopeKey = scope.key
        let ids = Array(Set(activityIDs))
        var result: [String: CachedStreamSummary] = [:]
        for row in try makeContext().fetch(FetchDescriptor<StoredStreamSummary>(
            predicate: #Predicate { $0.scope == scopeKey && ids.contains($0.activityID) })) {
            result[row.activityID] = try row.decoded()
        }
        return result
    }

    func cachedRawStreams(activityID: String, scope: StoreScope) throws -> CachedRawStreams? {
        let key = StoreScope.key([scope.key, activityID])
        return try makeContext().fetch(FetchDescriptor<StoredRawStreams>(
            predicate: #Predicate { $0.key == key })).first?.decoded()
    }

    /// Identities of both representations, without reading either payload.
    func streamCacheStatus(activityID: String, scope: StoreScope) throws -> StreamCacheStatus {
        let key = StoreScope.key([scope.key, activityID])
        let context = makeContext()
        let raw = try context.fetch(FetchDescriptor<StoredRawStreams>(
            predicate: #Predicate { $0.key == key })).first
        let summary = try context.fetch(FetchDescriptor<StoredStreamSummary>(
            predicate: #Predicate { $0.key == key })).first
        return StreamCacheStatus(
            raw: raw.map { StreamCacheEntry(generation: $0.generation, revision: $0.revision, isCurrent: !$0.invalidated) },
            summary: summary.map { StreamCacheEntry(generation: $0.generation, revision: $0.revision, isCurrent: !$0.invalidated) },
            summaryVersion: summary?.summaryVersion)
    }

    /// Stores a `/streams` response. `responseBody` must be that response's
    /// exact bytes (`APIClient.Response.body`); it is what gets persisted.
    @discardableResult
    func saveRawStreams(
        _ dto: ActivityMapAPI.ActivityStreams, responseBody: Data,
        scope: StoreScope, fence: StreamFence, now: Date = .now
    ) throws -> StreamCacheWrite {
        guard dto.metadata.state == .current, dto.streams != nil else { return .notCacheable }
        let context = makeContext()
        let scopeKey = scope.key
        let key = StoreScope.key([scopeKey, dto.activityID])
        let writeKey = StoreScope.key([scopeKey, dto.activityID, "raw"])
        let existing = try context.fetch(FetchDescriptor<StoredRawStreams>(
            predicate: #Predicate { $0.key == key })).first
        if let verdict = admission(
            dto.metadata, existing: existing.map { (generation: $0.generation, revision: $0.revision) },
            fence: fence, scopeKey: scopeKey, activityKey: key, writeKey: writeKey) {
            return verdict
        }
        let invalidated = syncSupersedes(dto.metadata, activityKey: key, context: context)
        do {
            if let existing {
                try existing.update(dto: dto, responseBody: responseBody, invalidated: invalidated, now: now)
            } else {
                context.insert(try StoredRawStreams(
                    scope: scopeKey, dto: dto, responseBody: responseBody, invalidated: invalidated, now: now))
            }
            try save(context)
        } catch {
            context.rollback()
            throw error
        }
        streamFences.recordWrite(fence, key: writeKey)
        return .stored
    }

    @discardableResult
    func saveStreamSummary(
        _ dto: ActivityMapAPI.ActivityStreamSummary,
        scope: StoreScope, fence: StreamFence, now: Date = .now
    ) throws -> StreamCacheWrite {
        try saveStreamSummaries([dto], scope: scope, fence: fence, now: now)[dto.activityID] ?? .notCacheable
    }

    /// Stores several summaries (e.g. a `/stream-summaries` batch) in one save.
    /// Only `current` sets are cached, including ones with no usable summary.
    func saveStreamSummaries(
        _ dtos: [ActivityMapAPI.ActivityStreamSummary],
        scope: StoreScope, fence: StreamFence, now: Date = .now
    ) throws -> [String: StreamCacheWrite] {
        let context = makeContext()
        let scopeKey = scope.key
        var latest: [String: ActivityMapAPI.ActivityStreamSummary] = [:]
        for dto in dtos { latest[dto.activityID] = dto }
        var results: [String: StreamCacheWrite] = [:]
        var written: [String] = []
        do {
            for (activityID, dto) in latest {
                guard dto.metadata.state == .current else {
                    results[activityID] = .notCacheable
                    continue
                }
                let key = StoreScope.key([scopeKey, activityID])
                let writeKey = StoreScope.key([scopeKey, activityID, "summary"])
                let existing = try context.fetch(FetchDescriptor<StoredStreamSummary>(
                    predicate: #Predicate { $0.key == key })).first
                if let verdict = admission(
                    dto.metadata, existing: existing.map { (generation: $0.generation, revision: $0.revision) },
                    fence: fence, scopeKey: scopeKey, activityKey: key, writeKey: writeKey) {
                    results[activityID] = verdict
                    continue
                }
                let invalidated = syncSupersedes(dto.metadata, activityKey: key, context: context)
                // A new summary version replaces the old summary; raw data is untouched.
                if let existing {
                    try existing.update(dto: dto, invalidated: invalidated, now: now)
                } else {
                    context.insert(try StoredStreamSummary(scope: scopeKey, dto: dto, invalidated: invalidated, now: now))
                }
                results[activityID] = .stored
                written.append(writeKey)
            }
            if !written.isEmpty { try save(context) }
        } catch {
            context.rollback()
            throw error
        }
        for key in written { streamFences.recordWrite(fence, key: key) }
        return results
    }

    /// Marks both representations stale, e.g. when the server reports the set
    /// is no longer current. Also fences in-flight requests for the activity.
    func invalidateStreams(activityID: String, scope: StoreScope) throws {
        let key = StoreScope.key([scope.key, activityID])
        streamFences.invalidate(key)
        let context = makeContext()
        do {
            for row in try context.fetch(FetchDescriptor<StoredRawStreams>(
                predicate: #Predicate { $0.key == key })) { row.invalidated = true }
            for row in try context.fetch(FetchDescriptor<StoredStreamSummary>(
                predicate: #Predicate { $0.key == key })) { row.invalidated = true }
            try save(context)
        } catch {
            context.rollback()
            throw error
        }
    }

    /// Nil to proceed with a write, otherwise why it is rejected.
    ///
    /// Within one generation, revisions order sets, so an older revision never
    /// replaces a newer one. Generations are unordered, so across them the
    /// response to the later request wins.
    private func admission(
        _ incoming: ActivityMapAPI.StreamMetadata,
        existing: (generation: String?, revision: String)?,
        fence: StreamFence, scopeKey: String, activityKey: String, writeKey: String
    ) -> StreamCacheWrite? {
        guard streamFences.admits(fence, keys: [scopeKey, activityKey]) else { return .fenced }
        guard let existing else { return nil }
        if existing.generation == incoming.generation {
            switch StreamRevision.compare(incoming.revision, existing.revision) {
            case .orderedAscending: return .superseded
            case .orderedDescending: return nil
            case .orderedSame: break
            }
        }
        return streamFences.wroteLater(than: fence, key: writeKey) ? .superseded : nil
    }

    /// Whether committed sync metadata for the activity already describes a
    /// newer or invalidated set of the same generation. A different generation
    /// is not evidence either way (sync may lag a direct response), so the
    /// fresh response is kept as current; a later sync change still wins.
    private func syncSupersedes(
        _ incoming: ActivityMapAPI.StreamMetadata, activityKey: String, context: ModelContext
    ) -> Bool {
        guard let row = try? context.fetch(FetchDescriptor<StoredActivity>(
                  predicate: #Predicate { $0.key == activityKey })).first,
              let synced = try? row.decoded().streams,
              synced.generation == incoming.generation else { return false }
        return StreamRevision.supersedes(synced, generation: incoming.generation, revision: incoming.revision)
    }
}

import Foundation
import SwiftData

/// Raw samples for one activity. The raw set and its summary are separate
/// models so that reading a summary never loads or decodes raw arrays.
@Model
nonisolated final class StoredRawStreams {
    @Attribute(.unique) var key: String
    var scope: String
    var activityID: String
    var generation: String?
    var revision: String
    /// Set when sync reports a newer revision or an invalidation of this one.
    /// Kept for offline display, but never presented as current.
    var invalidated: Bool
    var storedAt: Date
    /// `StreamMetadata`, encoded with `StoreCodec`.
    var streamMetadata: Data
    /// The exact `/streams` response body. Keeping the server's bytes preserves
    /// sample values, ordering, missing keys and per-stream metadata the typed
    /// DTO does not model. External storage keeps metadata-only reads (e.g.
    /// sync invalidation) from loading it.
    @Attribute(.externalStorage) var responseBody: Data

    init(scope: String, dto: ActivityMapAPI.ActivityStreams, responseBody: Data, invalidated: Bool, now: Date) throws {
        self.key = StoreScope.key([scope, dto.activityID])
        self.scope = scope
        self.activityID = dto.activityID
        self.generation = dto.metadata.generation
        self.revision = dto.metadata.revision
        self.invalidated = invalidated
        self.storedAt = now
        self.streamMetadata = try StoreCodec.encode(dto.metadata)
        self.responseBody = responseBody
    }

    func update(dto: ActivityMapAPI.ActivityStreams, responseBody: Data, invalidated: Bool, now: Date) throws {
        generation = dto.metadata.generation
        revision = dto.metadata.revision
        self.invalidated = invalidated
        storedAt = now
        streamMetadata = try StoreCodec.encode(dto.metadata)
        self.responseBody = responseBody
    }

    func decoded() throws -> CachedRawStreams {
        CachedRawStreams(
            activityID: activityID,
            metadata: try StoreCodec.decode(ActivityMapAPI.StreamMetadata.self, from: streamMetadata),
            isCurrent: !invalidated, storedAt: storedAt, responseBody: responseBody)
    }
}

/// The server's downsampled summary for one activity, as returned.
@Model
nonisolated final class StoredStreamSummary {
    @Attribute(.unique) var key: String
    var scope: String
    var activityID: String
    var generation: String?
    var revision: String
    /// `summary.version`; nil when the current set has no summary.
    var summaryVersion: Int?
    var invalidated: Bool
    var storedAt: Date
    /// `ActivityStreamSummary`, encoded with `StoreCodec`.
    var payload: Data

    init(scope: String, dto: ActivityMapAPI.ActivityStreamSummary, invalidated: Bool, now: Date) throws {
        self.key = StoreScope.key([scope, dto.activityID])
        self.scope = scope
        self.activityID = dto.activityID
        self.generation = dto.metadata.generation
        self.revision = dto.metadata.revision
        self.summaryVersion = dto.summary?.version
        self.invalidated = invalidated
        self.storedAt = now
        self.payload = try StoreCodec.encode(dto)
    }

    func update(dto: ActivityMapAPI.ActivityStreamSummary, invalidated: Bool, now: Date) throws {
        generation = dto.metadata.generation
        revision = dto.metadata.revision
        summaryVersion = dto.summary?.version
        self.invalidated = invalidated
        storedAt = now
        payload = try StoreCodec.encode(dto)
    }

    func decoded() throws -> CachedStreamSummary {
        let dto = try StoreCodec.decode(ActivityMapAPI.ActivityStreamSummary.self, from: payload)
        return CachedStreamSummary(
            activityID: activityID, metadata: dto.metadata, summary: dto.summary,
            isCurrent: !invalidated, storedAt: storedAt)
    }
}

// MARK: - Values crossing the actor boundary

nonisolated struct CachedStreamSummary: Hashable, Sendable {
    let activityID: String
    let metadata: ActivityMapAPI.StreamMetadata
    /// Nil means the current set has no usable summary. That is a distinct,
    /// valid state: not missing data and not a reason to retry.
    let summary: ActivityMapAPI.StreamSummary?
    /// False once sync reported that this entry was superseded.
    let isCurrent: Bool
    let storedAt: Date
}

nonisolated struct CachedRawStreams: Sendable {
    let activityID: String
    let metadata: ActivityMapAPI.StreamMetadata
    let isCurrent: Bool
    let storedAt: Date
    /// The `/streams` response body exactly as the server sent it.
    let responseBody: Data

    /// Typed samples. Decode off the main actor; raw sets can be large.
    func streams() throws -> ActivityMapAPI.RawStreams {
        let envelope = try ActivityMapAPI.makeDecoder().decode(
            ActivityMapAPI.Envelope<ActivityMapAPI.ActivityStreams>.self, from: responseBody)
        guard let streams = envelope.data.streams else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: [], debugDescription: "Cached stream response has no samples"))
        }
        return streams
    }

    /// The untyped `streams` object, including metadata unknown to this build.
    func streamsJSON() throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: responseBody) as? [String: Any]
        guard let data = object?["data"] as? [String: Any],
              let streams = data["streams"] as? [String: Any] else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: [], debugDescription: "Cached stream response has no samples"))
        }
        return streams
    }
}

/// Identity of the cached representations, read without their payloads.
nonisolated struct StreamCacheStatus: Hashable, Sendable {
    let raw: StreamCacheEntry?
    let summary: StreamCacheEntry?
    let summaryVersion: Int?
}

nonisolated struct StreamCacheEntry: Hashable, Sendable {
    let generation: String?
    let revision: String
    let isCurrent: Bool
}

nonisolated enum StreamCacheWrite: Hashable, Sendable {
    case stored
    /// Only current sets are cached; pending, stale and never-fetched
    /// responses are shown from memory and then discarded.
    case notCacheable
    /// A newer revision, or a response to a later request, is already stored.
    case superseded
    /// The activity, scope or store was invalidated after the request started
    /// (tombstone, logout, account/deployment change, sync invalidation).
    case fenced
}

/// Captured before a stream request and presented with its result.
nonisolated struct StreamFence: Hashable, Sendable {
    fileprivate let token: UInt64
}

/// In-memory fencing for stream writes. Every capture and invalidation takes
/// the next value of one counter, so fences are ordered with respect to both.
/// Requests do not survive a relaunch, so neither needs this state.
nonisolated struct StreamFences: Sendable {
    private var counter: UInt64 = 0
    private var allInvalidatedAt: UInt64 = 0
    private var invalidatedAt: [String: UInt64] = [:]
    private var lastWrite: [String: UInt64] = [:]

    mutating func capture() -> StreamFence {
        counter += 1
        return StreamFence(token: counter)
    }

    /// Rejects every fence captured before now for `key` (a scope or activity key).
    mutating func invalidate(_ key: String) {
        counter += 1
        invalidatedAt[key] = counter
    }

    mutating func invalidateAll() {
        counter += 1
        allInvalidatedAt = counter
        invalidatedAt.removeAll()
        lastWrite.removeAll()
    }

    func admits(_ fence: StreamFence, keys: [String]) -> Bool {
        fence.token > allInvalidatedAt && keys.allSatisfy { fence.token > invalidatedAt[$0] ?? 0 }
    }

    /// Whether a request captured after `fence` already wrote `key`.
    func wroteLater(than fence: StreamFence, key: String) -> Bool {
        (lastWrite[key] ?? 0) > fence.token
    }

    mutating func recordWrite(_ fence: StreamFence, key: String) {
        lastWrite[key] = max(lastWrite[key] ?? 0, fence.token)
    }
}

nonisolated enum StreamRevision {
    /// Revisions are unbounded decimal strings (PostgreSQL bigint on the server).
    static func compare(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let left = lhs.drop(while: { $0 == "0" })
        let right = rhs.drop(while: { $0 == "0" })
        if left.count != right.count { return left.count < right.count ? .orderedAscending : .orderedDescending }
        return left == right ? .orderedSame : (left < right ? .orderedAscending : .orderedDescending)
    }

    /// Whether `metadata` (from sync) describes a newer set than the cached
    /// current `generation`/`revision`.
    ///
    /// Relies on a server invariant (docs/activity-streams.md): for as long as
    /// an activity exists, a successful fetch increments `revision` and keeps
    /// the generation, while invalidation rotates the generation and keeps the
    /// revision. Revision therefore orders sets across generations; at equal
    /// revision, a different generation or `stale` state is a later
    /// invalidation. A reset (deletion and recreation) reaches the client as a
    /// tombstone or a re-bootstrap, both of which clear the cache first.
    static func supersedes(_ metadata: ActivityMapAPI.StreamMetadata, generation: String?, revision: String) -> Bool {
        switch compare(metadata.revision, revision) {
        case .orderedDescending: true
        case .orderedSame: metadata.generation != generation || metadata.state == .stale
        // Delayed sync; never regress a newer cache entry.
        case .orderedAscending: false
        }
    }
}

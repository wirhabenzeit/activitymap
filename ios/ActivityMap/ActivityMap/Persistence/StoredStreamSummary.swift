import Foundation
import SwiftData

/// The server's downsampled summary for one activity, as returned.
@Model
nonisolated final class StoredStreamSummary {
    @Attribute(.unique) var key: String
    var scope: String
    var activityID: String
    var generation: String?
    var revision: String
    /// `summary.algorithm_version`; nil when the current set has no summary.
    var summaryVersion: Int?
    var codec: String?
    var invalidated: Bool
    var storedAt: Date
    /// `ActivityCompactStreamSummary`, encoded with `StoreCodec`.
    var payload: Data

    init(scope: String, dto: ActivityMapAPI.ActivityCompactStreamSummary, invalidated: Bool, now: Date) throws {
        self.key = StoreScope.key([scope, dto.activityID])
        self.scope = scope
        self.activityID = dto.activityID
        self.generation = dto.metadata.generation
        self.revision = dto.metadata.revision
        self.summaryVersion = dto.summary?.algorithmVersion
        self.codec = dto.summary?.codec
        self.invalidated = invalidated
        self.storedAt = now
        self.payload = try StoreCodec.encode(dto)
    }

    func update(dto: ActivityMapAPI.ActivityCompactStreamSummary, invalidated: Bool, now: Date) throws {
        generation = dto.metadata.generation
        revision = dto.metadata.revision
        summaryVersion = dto.summary?.algorithmVersion
        codec = dto.summary?.codec
        self.invalidated = invalidated
        storedAt = now
        payload = try StoreCodec.encode(dto)
    }

    func decoded() throws -> CachedStreamSummary {
        let dto = try StoreCodec.decode(ActivityMapAPI.ActivityCompactStreamSummary.self, from: payload)
        return CachedStreamSummary(
            dto: dto, codec: codec, algorithmVersion: summaryVersion,
            isCurrent: !invalidated, storedAt: storedAt)
    }
}

/// Encoded DTO only: no expanded samples cross persistence/loader boundaries.
nonisolated struct CachedStreamSummary: Hashable, Sendable {
    let dto: ActivityMapAPI.ActivityCompactStreamSummary
    let codec: String?
    let algorithmVersion: Int?
    let isCurrent: Bool
    let storedAt: Date
    var activityID: String { dto.activityID }
    var metadata: ActivityMapAPI.StreamMetadata { dto.metadata }
    /// Candidate only: ElevationProfile validates aligned altitude, forward
    /// recorded distance and positive span off-main before rendering. The
    /// sampling basis may be time, but time values never substitute for distance.
    var hasElevationProfileCandidate: Bool {
        guard let summary = dto.summary else { return false }
        return codec == "polyline-v1" && algorithmVersion == 1 && summary.basis != nil
            && summary.count > 1 && summary.distance?.isEmpty == false && summary.altitude?.isEmpty == false
    }
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
    /// tombstone or authoritative re-bootstrap, which removes or invalidates
    /// affected entries before advancing request fences.
    static func supersedes(_ metadata: ActivityMapAPI.StreamMetadata, generation: String?, revision: String) -> Bool {
        switch compare(metadata.revision, revision) {
        case .orderedDescending: true
        case .orderedSame: metadata.generation != generation || metadata.state == .stale
        // Delayed sync; never regress a newer cache entry.
        case .orderedAscending: false
        }
    }
}

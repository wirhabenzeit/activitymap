import Foundation
import SwiftData

/// Value crossing the actor boundary. An unfinished bootstrap must restart;
/// its snapshot cursor is not a usable delta cursor until both resources finish.
nonisolated struct SyncCheckpoint: Codable, Equatable, Sendable {
    var bootstrapCursor: String?
    var bootstrapComplete = false
    var changesCursor: String?
    var lastSyncAt: Date?
    var retention: ActivityMapAPI.SyncRetentionMeta?
    var freshness: ActivityMapAPI.SyncFreshnessMeta?
}

@Model
nonisolated final class SyncState {
    @Attribute(.unique) var scope: String
    var payload: Data

    init(scope: String, checkpoint: SyncCheckpoint) throws {
        self.scope = scope
        self.payload = try StoreCodec.encode(checkpoint)
    }

    func decoded() throws -> SyncCheckpoint {
        try StoreCodec.decode(SyncCheckpoint.self, from: payload)
    }
}

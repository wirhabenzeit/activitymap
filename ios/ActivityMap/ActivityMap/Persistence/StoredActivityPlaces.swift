import Foundation
import SwiftData

/// Legacy direct-response cache from before backend-only matching. Nothing
/// reads or writes it; it stays in the schema so existing stores open without
/// a migration, and sync or scope cleanup deletes the old rows.
@Model nonisolated final class StoredActivityPlaces {
    @Attribute(.unique) var key: String
    var scope: String
    var activityID: String
    var payload: Data
    var storedAt: Date
    var invalidated: Bool
    init(scope: String, dto: ActivityMapAPI.ActivityPlaces, now: Date) throws {
        key = StoreScope.key([scope, dto.activityID]); self.scope = scope
        activityID = dto.activityID; payload = try StoreCodec.encode(dto)
        storedAt = now; invalidated = false
    }
}

@Model nonisolated final class StoredPlacesContext {
    @Attribute(.unique) var scope: String
    var payload: Data
    init(scope: String, dto: PlaceMatchingIdentity) throws {
        self.scope = scope; payload = try StoreCodec.encode(dto)
    }
}

/// Global matching identity from the sync manifest.
/// Optional version preserves decoding of the first Dev build's cached identity.
nonisolated struct PlaceMatchingIdentity: Codable, Equatable, Sendable {
    let catalogueSnapshotID: String
    let matcherVersion: String
    var matchingVersion: String?
    enum CodingKeys: String, CodingKey {
        case catalogueSnapshotID = "catalogueSnapshotId"
        case matcherVersion, matchingVersion
    }
    init?(_ dto: ActivityMapAPI.ActivityPlaces) {
        guard dto.catalogueSnapshotID != nil || dto.matchingVersion != nil else { return nil }
        catalogueSnapshotID = dto.catalogueSnapshotID ?? ""; matcherVersion = dto.matcherVersion
        matchingVersion = dto.matchingVersion
    }
    init(version: String) {
        catalogueSnapshotID = ""; matcherVersion = ""; matchingVersion = version
    }
    static func == (lhs: Self, rhs: Self) -> Bool {
        if lhs.matchingVersion != nil || rhs.matchingVersion != nil { return lhs.matchingVersion == rhs.matchingVersion }
        return lhs.catalogueSnapshotID == rhs.catalogueSnapshotID && lhs.matcherVersion == rhs.matcherVersion
    }
}

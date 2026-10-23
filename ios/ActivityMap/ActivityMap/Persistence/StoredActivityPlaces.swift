import Foundation
import SwiftData

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

nonisolated struct CachedActivityPlaces: Sendable {
    let dto: ActivityMapAPI.ActivityPlaces
    let storedAt: Date
}

/// Last identity observed in a response, not an independent server manifest.
/// Keeping the persisted model/keys also preserves the first Dev build's store.
nonisolated struct PlaceMatchingIdentity: Codable, Equatable, Sendable {
    let catalogueSnapshotID: String
    let matcherVersion: String
    enum CodingKeys: String, CodingKey {
        case catalogueSnapshotID = "catalogueSnapshotId"
        case matcherVersion
    }
    init?(_ dto: ActivityMapAPI.ActivityPlaces) {
        guard let snapshot = dto.catalogueSnapshotID else { return nil }
        catalogueSnapshotID = snapshot; matcherVersion = dto.matcherVersion
    }
}

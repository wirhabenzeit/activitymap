import Foundation
import SwiftData

/// Persist scoped identity alongside the complete, losslessly encoded DTO.
/// Filtering and presentation operate on decoded values, not SwiftData models.
@Model
nonisolated final class StoredActivity {
    @Attribute(.unique) var key: String
    var scope: String
    var activityID: String
    var payload: Data

    init(scope: String, dto: ActivityMapAPI.Activity) throws {
        self.key = StoreScope.key([scope, dto.id])
        self.scope = scope
        self.activityID = dto.id
        self.payload = try StoreCodec.encode(dto)
    }

    func decoded() throws -> ActivityMapAPI.Activity {
        try StoreCodec.decode(ActivityMapAPI.Activity.self, from: payload)
    }
}

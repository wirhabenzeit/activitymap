import Foundation
import SwiftData

@Model
nonisolated final class StoredPhoto {
    @Attribute(.unique) var key: String
    var scope: String
    var photoID: String
    var activityID: String
    var payload: Data

    init(scope: String, dto: ActivityMapAPI.Photo) throws {
        self.key = StoreScope.key([scope, dto.uniqueID])
        self.scope = scope
        self.photoID = dto.uniqueID
        self.activityID = dto.activityID
        self.payload = try StoreCodec.encode(dto)
    }

    func decoded() throws -> ActivityMapAPI.Photo {
        try StoreCodec.decode(ActivityMapAPI.Photo.self, from: payload)
    }
}

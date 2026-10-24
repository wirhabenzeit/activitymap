import Foundation
import SwiftData

extension LocalStore {
    enum ReplacementError: Error { case incompleteSnapshot }

    /// Commit a completed authoritative snapshot, its photos and checkpoint in
    /// one transaction. A failed/cancelled replacement leaves the last usable
    /// cache/cursor intact; rows absent from a successful replacement disappear.
    func replaceSnapshot(_ snapshot: StoreSnapshot, scope: StoreScope) throws {
        try Task.checkCancellation()
        guard let checkpoint = snapshot.checkpoint, checkpoint.bootstrapComplete,
              checkpoint.lastSyncAt != nil else { throw ReplacementError.incompleteSnapshot }
        let context = makeContext()
        let key = scope.key
        do {
            let existingActivities = try context.fetch(FetchDescriptor<StoredActivity>(
                predicate: #Predicate { $0.scope == key }))
            let existingPhotos = try context.fetch(FetchDescriptor<StoredPhoto>(
                predicate: #Predicate { $0.scope == key }))
            for dto in snapshot.activities {
                if let matches = dto.placeMatches, matches.userID != scope.userID || matches.activityID != dto.id {
                    throw PlacesSyncError.invalidScope
                }
            }
            let activityIDs = Set(snapshot.activities.map(\.id))
            let eligiblePhotos = snapshot.photos.filter { activityIDs.contains($0.activityID) }
            let photoIDs = Set(eligiblePhotos.map(\.uniqueID))
            // Update retained rows in place to avoid unique-key collisions
            // between pending deletes and inserts in a single SwiftData save.
            let activitiesByID = Dictionary(uniqueKeysWithValues: existingActivities.map { ($0.activityID, $0) })
            let currentActivities = try snapshot.activities.map { dto in
                if let row = activitiesByID[dto.id] {
                    let saved = try row.decoded()
                    if Self.activityIsOlder(dto, than: saved) { return saved }
                }
                return dto
            }
            try reconcileSummaryReplacement(currentActivities, scopeKey: key, context: context)
            try reconcilePlacesReplacement(currentActivities, scopeKey: key, context: context)
            let photosByID = Dictionary(uniqueKeysWithValues: existingPhotos.map { ($0.photoID, $0) })
            for row in existingActivities where !activityIDs.contains(row.activityID) { context.delete(row) }
            for row in existingPhotos where !photoIDs.contains(row.photoID) { context.delete(row) }
            for dto in currentActivities {
                if let row = activitiesByID[dto.id] { row.payload = try StoreCodec.encode(dto) }
                else { context.insert(try StoredActivity(scope: key, dto: dto)) }
            }
            for dto in eligiblePhotos {
                if let row = photosByID[dto.uniqueID] {
                    row.activityID = dto.activityID
                    row.payload = try StoreCodec.encode(dto)
                } else { context.insert(try StoredPhoto(scope: key, dto: dto)) }
            }
            _ = try reconcilePlacesVersion(checkpoint.freshness?.placeMatchingVersion, scopeKey: key, context: context)
            if let state = try context.fetch(FetchDescriptor<SyncState>(
                predicate: #Predicate { $0.scope == key })).first {
                state.payload = try StoreCodec.encode(checkpoint)
            } else { context.insert(try SyncState(scope: key, checkpoint: checkpoint)) }
            try Task.checkCancellation()
            try save(context)
            summaryReplacementCommitted(scopeKey: key)
        } catch {
            context.rollback()
            throw error
        }
    }
}

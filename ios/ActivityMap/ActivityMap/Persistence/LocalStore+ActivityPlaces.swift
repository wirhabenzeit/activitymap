import Foundation
import SwiftData

extension LocalStore {
    private static func placesMetadataSupersedes(_ metadata: ActivityMapAPI.StreamMetadata, dto: ActivityMapAPI.ActivityPlaces) -> Bool {
        if dto.status == .complete { return StreamRevision.supersedes(metadata, generation: dto.streamGeneration, revision: dto.streamRevision) }
        let order = StreamRevision.compare(metadata.revision, dto.streamRevision)
        return order == .orderedDescending || (order == .orderedSame && metadata.generation != dto.streamGeneration)
    }
    // Places deliberately share the stream fence: activity source invalidation,
    // replacement, deletion and scope cleanup invalidate both derived read models.
    func cachedActivityPlaces(activityID: String, scope: StoreScope) throws -> CachedActivityPlaces? {
        let context = makeContext()
        let key = StoreScope.key([scope.key, activityID])
        guard let row = try context.fetch(FetchDescriptor<StoredActivityPlaces>(predicate: #Predicate { $0.key == key })).first,
              !row.invalidated else { return nil }
        let dto = try StoreCodec.decode(ActivityMapAPI.ActivityPlaces.self, from: row.payload)
        guard try placesInputCurrent(dto, scope: scope, context: context) else { return nil }
        return CachedActivityPlaces(dto: dto, storedAt: row.storedAt)
    }
    private func placesInputCurrent(_ dto: ActivityMapAPI.ActivityPlaces, scope: StoreScope, context: ModelContext, checkIdentity: Bool = true) throws -> Bool {
        let key = StoreScope.key([scope.key, dto.activityID])
        guard let row = try context.fetch(FetchDescriptor<StoredActivity>(predicate: #Predicate { $0.key == key })).first,
              dto.userID == scope.userID else { return false }
        if let metadata = try row.decoded().streams,
           Self.placesMetadataSupersedes(metadata, dto: dto) { return false }
        if let summary = try context.fetch(FetchDescriptor<StoredStreamSummary>(predicate: #Predicate { $0.key == key })).first,
           !summary.invalidated {
            let metadata = try summary.decoded().metadata
            if Self.placesMetadataSupersedes(metadata, dto: dto) { return false }
        }
        if checkIdentity, let identity = PlaceMatchingIdentity(dto),
           let known = try cachedPlacesContext(scope: scope), known != identity { return false }
        return true
    }
    func cachedPlacesContext(scope: StoreScope) throws -> PlaceMatchingIdentity? {
        let key = scope.key
        guard let row = try makeContext().fetch(FetchDescriptor<StoredPlacesContext>(predicate: #Predicate { $0.scope == key })).first else { return nil }
        return try? StoreCodec.decode(PlaceMatchingIdentity.self, from: row.payload)
    }
    func saveActivityPlaces(_ dto: ActivityMapAPI.ActivityPlaces, scope: StoreScope, fence: StreamFence, now: Date) throws -> Bool {
        guard summaryFenceIsCurrent(fence, activityID: dto.activityID, scope: scope) else { return false }
        let context = makeContext(); let key = StoreScope.key([scope.key, dto.activityID])
        guard try placesInputCurrent(dto, scope: scope, context: context, checkIdentity: false) else { return false }
        let identityKey = StoreScope.key([scope.key, "places-identity"])
        let identity = PlaceMatchingIdentity(dto)
        if let identity {
            let scopeKey = scope.key
            let row = try context.fetch(FetchDescriptor<StoredPlacesContext>(predicate: #Predicate { $0.scope == scopeKey })).first
            let known = row.flatMap { try? StoreCodec.decode(PlaceMatchingIdentity.self, from: $0.payload) }
            if known != identity && streamFences.wroteLater(than: fence, key: identityKey) { return false }
            if let row { row.payload = try StoreCodec.encode(identity) }
            else { context.insert(try StoredPlacesContext(scope: scopeKey, dto: identity)) }
        }
        let existing = try context.fetch(FetchDescriptor<StoredActivityPlaces>(predicate: #Predicate { $0.key == key })).first
        if let existing {
            existing.payload = try StoreCodec.encode(dto); existing.storedAt = now; existing.invalidated = false
        } else { context.insert(try StoredActivityPlaces(scope: scope.key, dto: dto, now: now)) }
        try Task.checkCancellation()
        try save(context)
        if identity != nil { streamFences.recordWrite(fence, key: identityKey) }
        return true
    }
    func reconcilePlacesUpsert(_ dto: ActivityMapAPI.Activity, previous: ActivityMapAPI.Activity?, scopeKey: String, context: ModelContext) throws -> Bool {
        let key = StoreScope.key([scopeKey, dto.id])
        guard let cached = try context.fetch(FetchDescriptor<StoredActivityPlaces>(predicate: #Predicate { $0.key == key })).first else { return false }
        let places = try StoreCodec.decode(ActivityMapAPI.ActivityPlaces.self, from: cached.payload)
        let invalidates = dto.streams.map { Self.placesMetadataSupersedes($0, dto: places) }
            ?? previous.map { Self.summarySourceChanged($0, dto) } ?? false
        if invalidates { cached.invalidated = true }
        return invalidates
    }
    func reconcilePlacesReplacement(_ activities: [ActivityMapAPI.Activity], scopeKey: String, context: ModelContext) throws {
        let ids = Set(activities.map(\.id))
        for row in try context.fetch(FetchDescriptor<StoredActivityPlaces>(predicate: #Predicate { $0.scope == scopeKey })) {
            if !ids.contains(row.activityID) { context.delete(row) }
        }
        for dto in activities {
            let key = StoreScope.key([scopeKey, dto.id])
            let previous = try context.fetch(FetchDescriptor<StoredActivity>(predicate: #Predicate { $0.key == key })).first?.decoded()
            if let row = try context.fetch(FetchDescriptor<StoredActivityPlaces>(predicate: #Predicate { $0.key == key })).first,
               let metadata = dto.streams {
                let cached = try StoreCodec.decode(ActivityMapAPI.ActivityPlaces.self, from: row.payload)
                if metadata.generation != cached.streamGeneration, previous?.streams?.generation != metadata.generation {
                    row.invalidated = true
                }
            }
            _ = try reconcilePlacesUpsert(dto, previous: previous, scopeKey: scopeKey, context: context)
        }
    }
}

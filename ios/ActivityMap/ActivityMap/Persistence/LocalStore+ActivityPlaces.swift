import Foundation
import SwiftData

extension LocalStore {
    private static func placesMetadataSupersedes(_ metadata: ActivityMapAPI.StreamMetadata, dto: ActivityMapAPI.ActivityPlaces) -> Bool {
        if dto.status == .complete { return StreamRevision.supersedes(metadata, generation: dto.streamGeneration, revision: dto.streamRevision) }
        let order = StreamRevision.compare(metadata.revision, dto.streamRevision)
        return order == .orderedDescending || (order == .orderedSame && metadata.generation != dto.streamGeneration)
    }
    /// Called only after the place bundle/version and its checkpoint are saved.
    func placesChangesCommitted(scopeKey: String, activityIDs: Set<String>? = nil) {
        notifySummaryChange(scope: scopeKey, activityIDs: activityIDs, affectsSummaries: false)
    }

    /// The synchronized bundle for current inputs, including pending and
    /// incomplete statuses. Nil means no current result has been synchronized.
    func cachedActivityPlaces(activityID: String, scope: StoreScope) throws -> ActivityMapAPI.ActivityPlaces? {
        let context = makeContext()
        let key = StoreScope.key([scope.key, activityID])
        guard let dto = try context.fetch(FetchDescriptor<StoredActivity>(predicate: #Predicate { $0.key == key })).first?.decoded().placeMatches,
              try placesInputCurrent(dto, scope: scope, context: context) else { return nil }
        return dto
    }

    /// One scoped read for the map overview: completed synchronized visits only.
    func cachedMapPlaces(activityIDs: Set<String>, scope: StoreScope) throws -> [String: ActivityMapAPI.ActivityPlaces] {
        try Task.checkCancellation()
        guard !activityIDs.isEmpty else { return [:] }
        let context = makeContext(), scopeKey = scope.key
        let identity = try cachedPlacesContext(scope: scope)
        let activities = try context.fetch(FetchDescriptor<StoredActivity>(predicate: #Predicate { $0.scope == scopeKey }))
        let summaries = try context.fetch(FetchDescriptor<StoredStreamSummary>(predicate: #Predicate { $0.scope == scopeKey }))
        let summaryByID = Dictionary(uniqueKeysWithValues: summaries.filter { activityIDs.contains($0.activityID) && !$0.invalidated }.map { ($0.activityID, $0) })
        var results: [String: ActivityMapAPI.ActivityPlaces] = [:]
        for row in activities where activityIDs.contains(row.activityID) {
            try Task.checkCancellation()
            let activity = try row.decoded()
            let summary = try summaryByID[row.activityID]?.decoded().metadata
            func valid(_ dto: ActivityMapAPI.ActivityPlaces) -> Bool {
                guard dto.userID == scope.userID, dto.activityID == row.activityID else { return false }
                if let metadata = activity.streams, Self.placesMetadataSupersedes(metadata, dto: dto) { return false }
                if let summary, Self.placesMetadataSupersedes(summary, dto: dto) { return false }
                if let current = PlaceMatchingIdentity(dto), let identity, current != identity { return false }
                return true
            }
            if let synced = activity.placeMatches, synced.status == .complete, valid(synced) { results[row.activityID] = synced }
        }
        return results
    }

    private func placesInputCurrent(_ dto: ActivityMapAPI.ActivityPlaces, scope: StoreScope, context: ModelContext) throws -> Bool {
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
        if let identity = PlaceMatchingIdentity(dto),
           let known = try cachedPlacesContext(scope: scope), known != identity { return false }
        return true
    }
    func cachedPlacesContext(scope: StoreScope) throws -> PlaceMatchingIdentity? {
        let key = scope.key
        guard let row = try makeContext().fetch(FetchDescriptor<StoredPlacesContext>(predicate: #Predicate { $0.scope == key })).first else { return nil }
        return try? StoreCodec.decode(PlaceMatchingIdentity.self, from: row.payload)
    }
    /// Bundles travel inside the activity row; changed streams change which
    /// bundle is current. Legacy direct-response rows are dropped on contact.
    func reconcilePlacesUpsert(_ dto: ActivityMapAPI.Activity, previous: ActivityMapAPI.Activity?, scopeKey: String, context: ModelContext) throws -> Bool {
        let key = StoreScope.key([scopeKey, dto.id])
        for row in try context.fetch(FetchDescriptor<StoredActivityPlaces>(predicate: #Predicate { $0.key == key })) { context.delete(row) }
        return dto.placeMatches != previous?.placeMatches || dto.streams != previous?.streams
    }
    /// The sync manifest invalidates old bundles even on an empty feed page.
    /// Called inside the same save as the page and its cursor.
    func reconcilePlacesVersion(_ version: String?, scopeKey: String, context: ModelContext) throws -> Bool {
        guard let version else { return false }
        let identity = PlaceMatchingIdentity(version: version)
        if let row = try context.fetch(FetchDescriptor<StoredPlacesContext>(predicate: #Predicate { $0.scope == scopeKey })).first {
            let previous = try? StoreCodec.decode(PlaceMatchingIdentity.self, from: row.payload)
            guard previous != identity else { return false }
            row.payload = try StoreCodec.encode(identity)
        } else { context.insert(try StoredPlacesContext(scope: scopeKey, dto: identity)) }
        return true
    }
    func reconcilePlacesReplacement(_ activities: [ActivityMapAPI.Activity], scopeKey: String, context: ModelContext) throws {
        for row in try context.fetch(FetchDescriptor<StoredActivityPlaces>(predicate: #Predicate { $0.scope == scopeKey })) { context.delete(row) }
    }
}

import Foundation
import SwiftData

extension LocalStore {
    /// Direct writes never acknowledge unseen feed events or resurrect a tombstone.
    func commitActivityEdit(_ dto: ActivityMapAPI.Activity, scope: StoreScope,
                            fence: StreamFence, sessionExpiresAt: Date, now: Date) throws {
        try Task.checkCancellation()
        guard sessionExpiresAt > now, summaryFenceIsCurrent(fence, activityID: dto.id, scope: scope) else {
            throw CancellationError()
        }
        let context = makeContext()
        let key = StoreScope.key([scope.key, dto.id])
        guard let row = try context.fetch(FetchDescriptor<StoredActivity>(
            predicate: #Predicate { $0.key == key })).first else { throw CancellationError() }
        let previous = try row.decoded()
        guard !Self.activityIsOlder(dto, than: previous) else { throw ActivityEditingError.reconciliation }
        do {
            let invalidates = try reconcileSummaryUpsert(dto, previous: previous, scopeKey: scope.key, context: context)
            row.payload = try StoreCodec.encode(dto)
            try Task.checkCancellation()
            try save(context)
            if invalidates {
                streamFences.invalidate(key)
                notifySummaryChange(scope: scope.key, activityIDs: [dto.id])
            }
        } catch { context.rollback(); throw error }
    }

    /// The server's committed timestamp orders direct results and delayed feed pages.
    nonisolated static func activityIsOlder(_ incoming: ActivityMapAPI.Activity, than saved: ActivityMapAPI.Activity) -> Bool {
        guard let savedDate = saved.lastUpdated else { return false }
        guard let incomingDate = incoming.lastUpdated else { return true }
        return incomingDate < savedDate
    }
}

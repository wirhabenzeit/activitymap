import Foundation

nonisolated struct SyncEngine: Sendable {
    enum ProtocolError: Error { case invalidPage, stalledCursor, missingSnapshot }

    let source: any SyncPageSource
    let store: LocalStore
    let scope: StoreScope
    var now: @Sendable () -> Date = { Date() }

    func run() async throws -> SyncCheckpoint {
        do {
            let checkpoint = try await store.snapshot(scope: scope).checkpoint
            if let checkpoint, checkpoint.bootstrapComplete, let cursor = checkpoint.changesCursor, !cursor.isEmpty {
                return try await catchUp(checkpoint)
            }
            return try await bootstrap()
        } catch let error as APIClient.RequestError {
            guard case .server("sync_rebootstrap_required", _, 409, _, _, _) = error else { throw error }
            // Exactly one fresh attempt; any second 409 escapes to the caller.
            return try await bootstrap()
        }
    }

    private func bootstrap() async throws -> SyncCheckpoint {
        try Task.checkCancellation()
        // A replacement must not erase an authorized completed cache if a
        // later snapshot page/catch-up fails. Initial bootstrap still commits
        // partial pages so its existing restart behavior is unchanged.
        let previous = try await store.snapshot(scope: scope).checkpoint
        let replacing = previous?.bootstrapComplete == true && previous?.lastSyncAt != nil
        let destination = replacing
            ? try LocalStore(container: LocalStore.makeContainer(inMemory: true))
            : store
        try await destination.clear(scope: scope)
        var checkpoint = SyncCheckpoint()
        for resource in [ActivityMapAPI.SyncResource.activities, .photos] {
            var cursor: String?
            var seen = Set<String>()
            repeat {
                try Task.checkCancellation()
                let page = try await source.bootstrap(resource: resource, cursor: cursor)
                try Task.checkCancellation()
                let mutations: [StoreMutation]
                let next: String?
                let snapshot: String?
                switch (resource, page) {
                case (.activities, .activities(let page)):
                    mutations = page.items.map(StoreMutation.upsertActivity)
                    (next, snapshot) = (page.nextCursor, page.snapshotCursor)
                    checkpoint.retention = page.retention
                    checkpoint.freshness = page.freshness
                case (.photos, .photos(let page)):
                    mutations = page.items.map(StoreMutation.upsertPhoto)
                    (next, snapshot) = (page.nextCursor, page.snapshotCursor)
                    checkpoint.retention = page.retention
                    checkpoint.freshness = page.freshness
                default: throw ProtocolError.invalidPage
                }
                if resource == .activities && cursor == nil {
                    guard let snapshot, !snapshot.isEmpty else { throw ProtocolError.missingSnapshot }
                    checkpoint.bootstrapCursor = snapshot
                } else if snapshot != nil {
                    throw ProtocolError.invalidPage
                }
                if let next {
                    guard !next.isEmpty, next != cursor, seen.insert(next).inserted else {
                        throw ProtocolError.stalledCursor
                    }
                }
                // Persist partial bootstrap data with bootstrapComplete=false.
                // On interruption the next pass clears it and starts again.
                try await destination.apply(mutations, checkpoint: checkpoint, scope: scope)
                cursor = next
            } while cursor != nil
        }
        checkpoint.bootstrapComplete = true
        checkpoint.changesCursor = checkpoint.bootstrapCursor
        try await destination.apply([], checkpoint: checkpoint, scope: scope)
        // Mutations during pagination are reconciled from the FIRST snapshot.
        let completed = try await catchUp(checkpoint, destination: destination)
        if replacing {
            let snapshot = try await destination.snapshot(scope: scope)
            try await store.replaceSnapshot(snapshot, scope: scope)
        }
        return completed
    }

    private func catchUp(_ initial: SyncCheckpoint, destination: LocalStore? = nil) async throws -> SyncCheckpoint {
        let destination = destination ?? store
        var checkpoint = initial
        var seen = Set(initial.changesCursor.map { [$0] } ?? [])
        while true {
            try Task.checkCancellation()
            guard let cursor = checkpoint.changesCursor else { throw ProtocolError.missingSnapshot }
            let page = try await source.changes(cursor: cursor)
            try Task.checkCancellation()
            guard !page.nextCursor.isEmpty else { throw ProtocolError.invalidPage }
            // The server may omit superseded upserts from a page while still
            // advancing its cursor. Only an empty page at the same cursor is
            // caught up; an empty advancing page still has successors to read.
            let caughtUp = page.items.isEmpty && page.nextCursor == cursor
            if !caughtUp {
                guard page.nextCursor != cursor, seen.insert(page.nextCursor).inserted else {
                    throw ProtocolError.stalledCursor
                }
            }
            // Validate the entire page before mutating storage or acknowledging it.
            let mutations = try page.items.map(Self.mutation)
            checkpoint.changesCursor = page.nextCursor
            checkpoint.retention = page.retention
            checkpoint.freshness = page.freshness
            if caughtUp { checkpoint.lastSyncAt = now() }
            try await destination.apply(mutations, checkpoint: checkpoint, scope: scope)
            if caughtUp { return checkpoint }
        }
    }

    private static func mutation(_ item: ActivityMapAPI.SyncChangeItem) throws -> StoreMutation {
        switch (item.entityType, item.operation) {
        case (.activity, .upsert):
            guard let dto = item.activity, dto.id == item.id, item.photo == nil else { throw ProtocolError.invalidPage }
            return .upsertActivity(dto)
        case (.photo, .upsert):
            guard let dto = item.photo, dto.uniqueID == item.id, item.activity == nil else { throw ProtocolError.invalidPage }
            return .upsertPhoto(dto)
        case (.activity, .delete):
            guard item.activity == nil, item.photo == nil else { throw ProtocolError.invalidPage }
            return .deleteActivity(item.id)
        case (.photo, .delete):
            guard item.activity == nil, item.photo == nil else { throw ProtocolError.invalidPage }
            return .deletePhoto(item.id)
        }
    }
}

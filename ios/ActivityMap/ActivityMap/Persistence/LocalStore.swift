import Foundation
import SwiftData

nonisolated enum StoreMutation: Sendable {
    case upsertActivity(ActivityMapAPI.Activity)
    case upsertPhoto(ActivityMapAPI.Photo)
    case deleteActivity(String)
    case deletePhoto(String)
}

nonisolated struct StoreSnapshot: Sendable {
    let activities: [ActivityMapAPI.Activity]
    let photos: [ActivityMapAPI.Photo]
    let checkpoint: SyncCheckpoint?
}

/// One writer per container. Model objects and contexts never leave this actor.
/// Each operation uses a fresh context with autosave disabled: all mutations and
/// the checkpoint reach disk in one save, or are rolled back together.
actor LocalStore {
    private let container: ModelContainer
    private let save: @Sendable (ModelContext) throws -> Void

    init(
        container: ModelContainer,
        save: @escaping @Sendable (ModelContext) throws -> Void = { try $0.save() }
    ) {
        self.container = container
        self.save = save
    }

    nonisolated static func makeContainer(
        inMemory: Bool = false, url: URL? = nil
    ) throws -> ModelContainer {
        let schema = Schema([StoredActivity.self, StoredPhoto.self, SyncState.self])
        let configuration: ModelConfiguration
        if let url {
            configuration = ModelConfiguration(schema: schema, url: url, cloudKitDatabase: .none)
        } else {
            configuration = ModelConfiguration(
                schema: schema, isStoredInMemoryOnly: inMemory, cloudKitDatabase: .none)
        }
        return try ModelContainer(for: schema, configurations: [configuration])
    }

    func snapshot(scope: StoreScope) throws -> StoreSnapshot {
        let context = makeContext()
        let key = scope.key
        let activities = try context.fetch(FetchDescriptor<StoredActivity>(
            predicate: #Predicate { $0.scope == key }))
        let photos = try context.fetch(FetchDescriptor<StoredPhoto>(
            predicate: #Predicate { $0.scope == key }))
        let state = try context.fetch(FetchDescriptor<SyncState>(
            predicate: #Predicate { $0.scope == key })).first
        return try StoreSnapshot(
            activities: activities.map { try $0.decoded() }.sorted {
                $0.startDate == $1.startDate ? $0.id < $1.id : $0.startDate > $1.startDate
            },
            photos: photos.map { try $0.decoded() }.sorted { $0.uniqueID < $1.uniqueID },
            checkpoint: state?.decoded())
    }

    /// A nil checkpoint preserves current sync state (e.g. a bootstrap page).
    /// The caller supplies a checkpoint only with the data it acknowledges.
    func apply(
        _ mutations: [StoreMutation], checkpoint: SyncCheckpoint? = nil, scope: StoreScope
    ) throws {
        let context = makeContext()
        let scopeKey = scope.key
        do {
            // Preserve feed order, including multiple operations on one entity.
            for mutation in mutations {
                switch mutation {
                case .upsertActivity(let dto):
                    let key = StoreScope.key([scopeKey, dto.id])
                    if let row = try context.fetch(FetchDescriptor<StoredActivity>(
                        predicate: #Predicate { $0.key == key })).first {
                        row.payload = try StoreCodec.encode(dto)
                    } else {
                        context.insert(try StoredActivity(scope: scopeKey, dto: dto))
                    }
                case .upsertPhoto(let dto):
                    let key = StoreScope.key([scopeKey, dto.uniqueID])
                    if let row = try context.fetch(FetchDescriptor<StoredPhoto>(
                        predicate: #Predicate { $0.key == key })).first {
                        row.activityID = dto.activityID
                        row.payload = try StoreCodec.encode(dto)
                    } else {
                        context.insert(try StoredPhoto(scope: scopeKey, dto: dto))
                    }
                case .deleteActivity(let id):
                    for row in try context.fetch(FetchDescriptor<StoredActivity>(
                        predicate: #Predicate { $0.scope == scopeKey && $0.activityID == id })) {
                        context.delete(row)
                    }
                    // The server's cascade need not emit individual photo tombstones.
                    for row in try context.fetch(FetchDescriptor<StoredPhoto>(
                        predicate: #Predicate { $0.scope == scopeKey && $0.activityID == id })) {
                        context.delete(row)
                    }
                case .deletePhoto(let id):
                    for row in try context.fetch(FetchDescriptor<StoredPhoto>(
                        predicate: #Predicate { $0.scope == scopeKey && $0.photoID == id })) {
                        context.delete(row)
                    }
                }
            }
            if let checkpoint {
                if let state = try context.fetch(FetchDescriptor<SyncState>(
                    predicate: #Predicate { $0.scope == scopeKey })).first {
                    state.payload = try StoreCodec.encode(checkpoint)
                } else {
                    context.insert(try SyncState(scope: scopeKey, checkpoint: checkpoint))
                }
            }
            try save(context)
        } catch {
            context.rollback()
            throw error
        }
    }

    func clear(scope: StoreScope) throws {
        let context = makeContext()
        let key = scope.key
        do {
            // Use tracked deletes so rows and sync state share the same save.
            for row in try context.fetch(FetchDescriptor<StoredActivity>(
                predicate: #Predicate { $0.scope == key })) { context.delete(row) }
            for row in try context.fetch(FetchDescriptor<StoredPhoto>(
                predicate: #Predicate { $0.scope == key })) { context.delete(row) }
            for row in try context.fetch(FetchDescriptor<SyncState>(
                predicate: #Predicate { $0.scope == key })) { context.delete(row) }
            try save(context)
        } catch {
            context.rollback()
            throw error
        }
    }

    private func makeContext() -> ModelContext {
        let context = ModelContext(container)
        context.autosaveEnabled = false
        return context
    }
}

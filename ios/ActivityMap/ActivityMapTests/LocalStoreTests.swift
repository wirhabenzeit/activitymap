import Foundation
import SwiftData
import Testing
@testable import ActivityMap

@MainActor
struct LocalStoreTests {
    @Test func emptyStoreHasNoSampleData() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let snapshot = try await store.snapshot(scope: Fixtures.scope)
        #expect(snapshot.activities.isEmpty)
        #expect(snapshot.photos.isEmpty)
        #expect(snapshot.checkpoint == nil)
        #expect(ActivityStore().activities.isEmpty)
    }

    @Test func diskStoreReopensWithExactDTOsAndCursor() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "test.store")
        let activity = try Fixtures.activity()
        let photo = try Fixtures.photo()
        // The helper releases the first container before opening another SQLite connection.
        try await writeDiskFixture(url: url, activity: activity, photo: photo)
        let reopened = try LocalStore(container: LocalStore.makeContainer(url: url))
        let snapshot = try await reopened.snapshot(scope: Fixtures.scope)
        #expect(snapshot.activities == [activity])
        #expect(snapshot.photos == [photo])
        #expect(snapshot.checkpoint == Fixtures.checkpoint)
    }

    private func writeDiskFixture(
        url: URL, activity: ActivityMapAPI.Activity, photo: ActivityMapAPI.Photo
    ) async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(url: url))
        try await store.apply([.upsertActivity(activity), .upsertPhoto(photo)],
                              checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
    }

    @Test func replayAndUpdatesDoNotDuplicateRows() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let initial = try Fixtures.activity()
        let updated = try Fixtures.activity(["name": "Updated", "description": "New description"])
        let photo = try Fixtures.photo()
        let mutations: [StoreMutation] = [.upsertActivity(initial), .upsertPhoto(photo), .upsertActivity(updated)]
        for _ in 0..<2 {
            try await store.apply(mutations, checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        }
        let snapshot = try await store.snapshot(scope: Fixtures.scope)
        #expect(snapshot.activities == [updated])
        #expect(snapshot.photos == [photo])
        #expect(snapshot.checkpoint == Fixtures.checkpoint)
    }

    @Test func accountAndDeploymentScopesAreIndependent() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let bob = StoreScope(deployment: Fixtures.scope.deployment, userID: "bob")
        let dev = StoreScope(deployment: URL(string: "http://localhost:3000")!, userID: "alice")
        let mutations: [StoreMutation] = [.upsertActivity(try Fixtures.activity()), .upsertPhoto(try Fixtures.photo())]
        for scope in [Fixtures.scope, bob, dev] {
            try await store.apply(mutations, checkpoint: Fixtures.checkpoint, scope: scope)
        }
        try await store.clear(scope: Fixtures.scope)
        let cleared = try await store.snapshot(scope: Fixtures.scope)
        #expect(cleared.activities.isEmpty && cleared.photos.isEmpty && cleared.checkpoint == nil)
        for scope in [bob, dev] {
            let snapshot = try await store.snapshot(scope: scope)
            #expect(snapshot.activities.count == 1 && snapshot.photos.count == 1)
            #expect(snapshot.checkpoint == Fixtures.checkpoint)
        }
        #expect(StoreScope(deployment: URL(string: "https://example.test/")!, userID: "alice").key == Fixtures.scope.key)
        #expect(StoreScope.key(["a:b", "c"]) != StoreScope.key(["a", "b:c"]))
    }

    @Test func activityDeleteCascadesPhotosOnlyInItsScope() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let bob = StoreScope(deployment: Fixtures.scope.deployment, userID: "bob")
        let activity = try Fixtures.activity()
        let photo = try Fixtures.photo()
        let otherPhoto = try Fixtures.photo(["unique_id": "unrelated", "activity_id": "2"])
        for scope in [Fixtures.scope, bob] {
            try await store.apply([.upsertActivity(activity), .upsertPhoto(photo), .upsertPhoto(otherPhoto)], scope: scope)
        }
        try await store.apply([.deleteActivity(activity.id)], scope: Fixtures.scope)
        let alice = try await store.snapshot(scope: Fixtures.scope)
        #expect(alice.activities.isEmpty)
        #expect(alice.photos == [otherPhoto])
        let untouched = try await store.snapshot(scope: bob)
        #expect(untouched.activities.count == 1 && untouched.photos.count == 2)
    }

    @Test func photoReassignmentAndFeedOrderArePreserved() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let activity = try Fixtures.activity()
        let photo = try Fixtures.photo()
        let reassigned = try Fixtures.photo(["activity_id": "2"])
        try await store.apply([
            .upsertActivity(activity), .deleteActivity(activity.id), .upsertActivity(activity),
            .upsertPhoto(photo), .upsertPhoto(reassigned), .deleteActivity(activity.id),
        ], scope: Fixtures.scope)
        let snapshot = try await store.snapshot(scope: Fixtures.scope)
        #expect(snapshot.activities.isEmpty)
        #expect(snapshot.photos == [reassigned])
        try await store.apply([.deletePhoto(photo.uniqueID), .deletePhoto("missing")], scope: Fixtures.scope)
        #expect(try await store.snapshot(scope: Fixtures.scope).photos.isEmpty)
    }

    @Test func failedSaveCommitsNeitherMutationsNorCursor() async throws {
        enum DiskError: Error { case full }
        let container = try LocalStore.makeContainer(inMemory: true)
        let store = LocalStore(container: container)
        let initial = try Fixtures.activity()
        let photo = try Fixtures.photo()
        try await store.apply([.upsertActivity(initial), .upsertPhoto(photo)],
                              checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let failingStore = LocalStore(container: container, save: { _ in throw DiskError.full })
        var advanced = Fixtures.checkpoint
        advanced.changesCursor = "must-not-commit"
        await #expect(throws: DiskError.self) {
            try await failingStore.apply([
                .deleteActivity(initial.id), .upsertActivity(try Fixtures.activity(["id": "2"]))
            ], checkpoint: advanced, scope: Fixtures.scope)
        }
        let freshReader = LocalStore(container: container)
        let snapshot = try await freshReader.snapshot(scope: Fixtures.scope)
        #expect(snapshot.activities == [initial])
        #expect(snapshot.photos == [photo])
        #expect(snapshot.checkpoint == Fixtures.checkpoint)
        // A later successful save cannot accidentally flush the failed page.
        try await store.apply([], scope: Fixtures.scope)
        #expect(try await freshReader.snapshot(scope: Fixtures.scope).activities == [initial])
        await #expect(throws: DiskError.self) { try await failingStore.clear(scope: Fixtures.scope) }
        #expect(try await freshReader.snapshot(scope: Fixtures.scope).checkpoint == Fixtures.checkpoint)
    }

    @Test func emptyPageAdvancesCursorAndBootstrapPagesPreserveIt() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await store.apply([], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        try await store.apply([.upsertActivity(try Fixtures.activity())], scope: Fixtures.scope)
        #expect(try await store.snapshot(scope: Fixtures.scope).checkpoint == Fixtures.checkpoint)
        var advanced = Fixtures.checkpoint
        advanced.changesCursor = "empty-page-cursor"
        try await store.apply([], checkpoint: advanced, scope: Fixtures.scope)
        #expect(try await store.snapshot(scope: Fixtures.scope).checkpoint == advanced)
    }

    @Test func activityStoreReadsCommittedModels() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity()
        try await store.apply([.upsertActivity(dto)], scope: Fixtures.scope)
        let viewStore = ActivityStore()
        try await viewStore.load(from: store, scope: Fixtures.scope)
        #expect(viewStore.activities.map(\.name) == [dto.name])
        #expect(viewStore.activities.first?.coordinates.count == 3)
    }
}

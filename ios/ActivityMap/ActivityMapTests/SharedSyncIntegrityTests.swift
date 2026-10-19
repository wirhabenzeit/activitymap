import Foundation
import Testing
@testable import ActivityMap

nonisolated private struct SyncIntegrityFixtures: Decodable {
    let version: Int
    let activity: ActivityMapAPI.Activity
    let photo: ActivityMapAPI.Photo
    let vectors: [Vector]
    struct Vector: Decodable, Sendable {
        let id: String
        let initialComplete: Bool
        let rounds: [Round]
    }
    struct Round: Decodable, Sendable {
        let steps: [Step]
        let expected: Expected
        let failSave: Bool
    }
    struct Step: Decodable, Sendable {
        let kind: String
        let cursor: String?
        let resource: String?
        let body: JSONValue?
        let error: String?
    }
    struct Expected: Decodable, Sendable {
        let activities: [String]
        let photos: [String]
        let cursor: String?
        let complete: Bool
        let success: Bool
        let error: Bool
    }
}

/// A separate URLProtocol avoids sharing mutable transport scripts with other
/// suites. Requests still use production SyncAPI/APIClient envelope decoding.
nonisolated private final class IntegrityURLProtocol: URLProtocol, @unchecked Sendable {
    final class Script: @unchecked Sendable {
        let lock = NSLock()
        var steps: [SyncIntegrityFixtures.Step] = []
        var consumed = 0
        func set(_ steps: [SyncIntegrityFixtures.Step]) {
            lock.lock(); defer { lock.unlock() }
            self.steps = steps; consumed = 0
        }
        func respond(_ request: URLRequest) throws -> (HTTPURLResponse, Data) {
            lock.lock(); defer { lock.unlock() }
            guard !steps.isEmpty else { throw URLError(.badServerResponse) }
            let step = steps.removeFirst()
            consumed += 1
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
            #expect(components.path == "/api/v1/sync/\(step.kind)")
            #expect(components.queryItems?.first(where: { $0.name == "cursor" })?.value == step.cursor)
            if let resource = step.resource {
                #expect(components.queryItems?.first(where: { $0.name == "resource" })?.value == resource)
            }
            if step.error == "network" { throw URLError(.notConnectedToInternet) }
            if step.error == "cancel" { throw URLError(.cancelled) }
            let status = step.error == "rebootstrap" ? 409 : 200
            let body: JSONValue = status == 409
                ? .object(["error": .object([
                    "code": .string("sync_rebootstrap_required"), "message": .string("Expired"),
                    "retryable": .bool(false), "requestId": .string("test")])])
                : .object(["schemaVersion": .string("1"), "serverTime": .string("2026-10-18T00:00:00.000Z"), "data": step.body!])
            return (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!,
                    try JSONEncoder().encode(body))
        }
    }
    static let script = Script()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try Self.script.respond(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@Suite(.serialized)
@MainActor
struct SharedSyncIntegrityTests {
    @Test func sharedWireVectorsExerciseProductionHTTPClientEngineAndStore() async throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appending(path: "shared/sync-integrity-fixtures.v1.json")
        let fixtures = try ActivityMapAPI.makeDecoder().decode(SyncIntegrityFixtures.self, from: Data(contentsOf: url))
        #expect(fixtures.version == 1)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IntegrityURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let api = SyncAPI(baseURL: Fixtures.scope.deployment, token: "test", session: session)
        enum SaveError: Error { case injected }
        for vector in fixtures.vectors {
            let container = try LocalStore.makeContainer(inMemory: true)
            let store = LocalStore(container: container)
            var checkpoint = Fixtures.checkpoint
            checkpoint.changesCursor = "old"
            if vector.initialComplete {
                try await store.apply([.upsertActivity(fixtures.activity), .upsertPhoto(fixtures.photo)],
                                      checkpoint: checkpoint, scope: Fixtures.scope)
            }
            for round in vector.rounds {
                IntegrityURLProtocol.script.set(round.steps)
                let destination = round.failSave
                    ? LocalStore(container: container, save: { _ in throw SaveError.injected }) : store
                var failed = false
                do { _ = try await SyncEngine(source: api, store: destination, scope: Fixtures.scope).run() }
                catch { failed = true }
                #expect(failed == round.expected.error, "\(vector.id): expected error")
                #expect(IntegrityURLProtocol.script.consumed == round.steps.count, "\(vector.id): requests")
                let snapshot = try await LocalStore(container: container).snapshot(scope: Fixtures.scope)
                #expect(snapshot.activities.map(\.id).sorted() == round.expected.activities, "\(vector.id): activities")
                #expect(snapshot.photos.map(\.uniqueID).sorted() == round.expected.photos, "\(vector.id): photos")
                if vector.initialComplete && round.expected.error && round.expected.cursor == "old" {
                    #expect(snapshot.checkpoint == checkpoint, "\(vector.id): full checkpoint unchanged")
                }
                #expect(snapshot.checkpoint?.changesCursor == round.expected.cursor, "\(vector.id): cursor")
                #expect((snapshot.checkpoint?.bootstrapComplete ?? false) == round.expected.complete, "\(vector.id): complete")
                #expect((snapshot.checkpoint?.lastSyncAt != nil) == round.expected.success, "\(vector.id): success")
            }
        }
    }
}

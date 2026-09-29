import Foundation
import Testing
@testable import ActivityMap

/// Integration with #213's real atomic authoritative snapshot replacement.
@MainActor struct StreamSummaryReplacementTests {
    private func activity(_ id: String, generation: String = "g1", revision: String = "1") throws -> ActivityMapAPI.Activity {
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON(generation: generation, revision: revision).utf8))
        return try Fixtures.activity(["id": id, "streams": metadata])
    }
    private func summary(_ id: String, generation: String = "g1", revision: String = "1") throws -> ActivityMapAPI.ActivityCompactStreamSummary {
        try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.ActivityCompactStreamSummary.self,
            from: Data(StreamFixtures.summaryJSON(id: id, generation: generation, revision: revision).utf8))
    }

    @Test func authoritativeReplacementRetainsValidDataAndFencesResetGenerationAndOrphans() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let scope = Fixtures.scope
        for id in ["1", "2", "3", "4", "5"] {
            try await store.apply([.upsertActivity(try activity(id))], scope: scope)
            let fence = await store.streamFence()
            let revision = id == "2" ? "99" : id == "1" || id == "5" ? "5" : "1"
            #expect(try await store.saveStreamSummary(summary(id, generation: id == "5" ? "g2" : "g1", revision: revision), scope: scope, fence: fence) == .stored)
        }
        let inFlight = await store.streamFence()
        let snapshot = StoreSnapshot(activities: [try activity("1", revision: "4"), try activity("2", generation: "recreated", revision: "0"), try activity("4"), try activity("5", revision: "4")],
            photos: [], checkpoint: Fixtures.checkpoint)
        try await store.replaceSnapshot(snapshot, scope: scope)
        #expect(try await store.cachedStreamSummary(activityID: "1", scope: scope)?.isCurrent == true,
                "Same-generation newer direct summary survives lagging snapshot metadata")
        #expect(try await store.cachedStreamSummary(activityID: "4", scope: scope)?.isCurrent == true)
        #expect(try await store.cachedStreamSummary(activityID: "5", scope: scope)?.isCurrent == true,
                "Snapshot matching prior activity generation must not regress a newer direct generation")
        #expect(try await store.cachedStreamSummary(activityID: "2", scope: scope)?.isCurrent == false,
                "Changed authoritative generation beats an old high revision after delete/recreate")
        #expect(try await store.cachedStreamSummary(activityID: "3", scope: scope) == nil)
        #expect(try await store.saveStreamSummary(summary("2", revision: "100"), scope: scope, fence: inFlight) == .fenced)
        let next = await store.streamFence()
        #expect(try await store.saveStreamSummary(summary("2", generation: "recreated", revision: "1"), scope: scope, fence: next) == .stored)
        #expect(try await store.cachedStreamSummary(activityID: "2", scope: scope)?.isCurrent == true)
    }

    @Test func failedAuthoritativeReplacementPreservesSummaryAndRequestFences() async throws {
        enum Failure: Error { case save }
        let container = try LocalStore.makeContainer(inMemory: true)
        let good = LocalStore(container: container)
        try await good.apply([.upsertActivity(try activity("1"))], scope: Fixtures.scope)
        let initial = await good.streamFence()
        #expect(try await good.saveStreamSummary(summary("1"), scope: Fixtures.scope, fence: initial) == .stored)
        let failing = LocalStore(container: container, save: { _ in throw Failure.save })
        let ticket = await failing.streamFence()
        await #expect(throws: Failure.self) {
            try await failing.replaceSnapshot(.init(activities: [], photos: [], checkpoint: Fixtures.checkpoint), scope: Fixtures.scope)
        }
        #expect(try await failing.cachedStreamSummary(activityID: "1", scope: Fixtures.scope)?.isCurrent == true)
        #expect(await failing.summaryFenceIsCurrent(ticket, activityID: "1", scope: Fixtures.scope))
    }
}

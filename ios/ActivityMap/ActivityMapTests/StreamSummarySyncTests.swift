import Foundation
import Testing
@testable import ActivityMap

private actor StoredSummaryProbe: StoredSummarySource {
    typealias Response = APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummaries>
    private(set) var batches: [[String]] = []
    var entries: [ActivityMapAPI.ActivityCompactStreamSummary]
    let error: APIClient.RequestError?
    let hold: Bool
    private var continuation: CheckedContinuation<Response, Never>?
    private var requested: CheckedContinuation<Void, Never>?

    init(_ entries: [ActivityMapAPI.ActivityCompactStreamSummary] = [], error: APIClient.RequestError? = nil, hold: Bool = false) {
        self.entries = entries; self.error = error; self.hold = hold
    }
    func storedSummaryBatch(activityIDs: [String]) async throws -> Response {
        batches.append(activityIDs)
        if hold {
            return await withCheckedContinuation { continuation in
                self.continuation = continuation
                requested?.resume(); requested = nil
            }
        }
        if let error { throw error }
        return response(activityIDs)
    }
    private func response(_ ids: [String]) -> Response {
        .init(payload: .init(summaries: entries.filter { ids.contains($0.activityID) }),
              statusCode: 200, retryAfter: nil, requestID: "batch", body: Data())
    }
    func waitForRequest() async {
        if !batches.isEmpty { return }
        await withCheckedContinuation { requested = $0 }
    }
    func release() { continuation?.resume(returning: response(batches.last ?? [])); continuation = nil }
}

@MainActor
struct StreamSummarySyncTests {
    private let scope = Fixtures.scope
    private func activity(_ id: String, revision: String = "1", state: String = "current", date: String = "2026-09-22T12:00:00.000Z") throws -> ActivityMapAPI.Activity {
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON(revision: revision, state: state).utf8))
        return try Fixtures.activity(["id": id, "streams": metadata, "start_date": date, "map_summary_polyline": NSNull(), "trainer": true])
    }
    private func summary(_ id: String, revision: String = "1", content: String? = StreamFixtures.distanceSummary) throws -> ActivityMapAPI.ActivityCompactStreamSummary {
        try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.ActivityCompactStreamSummary.self,
            from: Data(StreamFixtures.summaryJSON(id: id, summary: content, revision: revision).utf8))
    }
    private func store(_ activities: [ActivityMapAPI.Activity]) async throws -> LocalStore {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply(activities.map(StoreMutation.upsertActivity), scope: scope)
        return storage
    }
    private func sync(_ probe: StoredSummaryProbe, clock: SummaryClock = SummaryClock()) -> StreamSummarySync {
        let sync = StreamSummarySync(now: { clock.now() }, source: { _ in probe }, invalidate: { _ in })
        sync.configure(SyncFixtures.session())
        return sync
    }

    @Test(arguments: [206, 5_000])
    func existingLibraryCatchesUpNewestFirstInBoundedBatchesAndReadsOffline(_ count: Int) async throws {
        let newest = String(count)
        let rows = try (1..<count).map { try activity(String($0)) }
            + [activity(newest, date: "2026-10-01T12:00:00.000Z")]
        let storage = try await store(rows)
        let probe = StoredSummaryProbe(try rows.map { try summary($0.id, content: StreamFixtures.timeSummary) })
        let sync = sync(probe)
        sync.start(storage: storage)
        await sync.waitUntilIdle()
        let batches = await probe.batches
        #expect(batches.count == (count + 99) / 100)
        #expect(batches.allSatisfy { !$0.isEmpty && $0.count <= 100 })
        #expect(batches.first?.first == newest)
        #expect(Set(batches.flatMap { $0 }).count == count)
        #expect(try await storage.summarySyncCandidates(scope: scope).isEmpty)
        sync.start(storage: storage)
        await sync.waitUntilIdle()
        #expect(await probe.batches.count == batches.count)
        let foreground = SummarySourceProbe([])
        let loader = StreamSummaryLoader(source: { _ in foreground })
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        await loader.load(activityID: newest)
        #expect(loader.currentSummary(for: newest)?.dto.summary?.basis == .time)
        #expect(await foreground.calls == 0)
    }

    @Test func metadataSyncPublishesBeforeSummaryCatchupAndChangedRevisionDownloadsAgain() async throws {
        let row = try activity("1")
        let storage = try await store([])
        let probe = StoredSummaryProbe([try summary("1")], hold: true)
        let source = SyncFixtures.complete([row])
        let controller = SyncController(activities: ActivityStore(), source: { _ in source },
            storedSummarySource: { _ in probe }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        await probe.waitForRequest()
        #expect(controller.status == .ready && controller.activities.activities.count == 1)
        #expect(controller.checkpoint?.bootstrapComplete == true)
        await probe.release()
        await controller.summarySync.waitUntilIdle()
        #expect(try await storage.cachedStreamSummary(activityID: "1", scope: scope)?.isCurrent == true)
        try await storage.apply([.upsertActivity(try activity("1", revision: "2"))], scope: scope)
        #expect(try await storage.summarySyncCandidates(scope: scope).map(\.activityID) == ["1"])
        let newer = StoredSummaryProbe([try summary("1", revision: "2")])
        let next = sync(newer)
        next.start(storage: storage)
        await next.waitUntilIdle()
        #expect(try await storage.cachedStreamSummary(activityID: "1", scope: scope)?.metadata.revision == "2")
    }

    @Test func emptySummaryIsCompleteButOmittedAndNullSummaryRetryLaterOrOnMetadataChange() async throws {
        let storage = try await store([activity("1"), activity("2"), activity("3"), activity("4", state: "not_fetched")])
        let probe = StoredSummaryProbe(try [summary("1", content: StreamFixtures.noAxisSummary), summary("2", content: nil)])
        let clock = SummaryClock()
        let sync = sync(probe, clock: clock)
        sync.start(storage: storage)
        await sync.waitUntilIdle()
        #expect(await probe.batches.first == ["1", "2", "3"])
        #expect(try await storage.summarySyncCandidates(scope: scope).map(\.activityID) == ["2", "3"])
        sync.start(storage: storage)
        await sync.waitUntilIdle()
        #expect(await probe.batches.count == 1)
        try await storage.apply([.upsertActivity(try activity("3", revision: "2"))], scope: scope)
        sync.start(storage: storage)
        await sync.waitUntilIdle()
        #expect(await probe.batches.last == ["3"])
        clock.advance(901)
        sync.start(storage: storage)
        await sync.waitUntilIdle()
        #expect(await probe.batches.last == ["2", "3"])
    }

    @Test func rateLimitDoesNotFailMetadataSyncAndHonorsDeadline() async throws {
        let storage = try await store([])
        let probe = StoredSummaryProbe(error: .rateLimited(retryAfter: 120, requestID: "batch"))
        let clock = SummaryClock()
        let controller = SyncController(activities: ActivityStore(), now: { clock.now() }, source: { _ in SyncFixtures.complete([try! activity("1")]) },
            storedSummarySource: { _ in probe }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        await controller.summarySync.waitUntilIdle()
        #expect(controller.status == .ready && controller.checkpoint?.bootstrapComplete == true)
        controller.summarySync.start(storage: storage)
        await controller.summarySync.waitUntilIdle()
        #expect(await probe.batches.count == 1)
        clock.advance(120)
        controller.summarySync.start(storage: storage)
        await controller.summarySync.waitUntilIdle()
        #expect(await probe.batches.count == 2)
    }

    @Test(arguments: ["pause", "delete", "invalidation", "scope"])
    func lateBatchCannotReviveCancelledOrInvalidatedData(_ transition: String) async throws {
        let storage = try await store([activity("1")])
        let probe = StoredSummaryProbe([try summary("1")], hold: true)
        let sync = sync(probe)
        sync.start(storage: storage)
        await probe.waitForRequest()
        // Capture the original task even when pause removes it from the owner.
        let completion = Task { await sync.waitUntilIdle() }
        await Task.yield()
        switch transition {
        case "pause": sync.pause()
        case "delete": try await storage.apply([.deleteActivity("1")], scope: scope)
        case "invalidation": try await storage.apply([.upsertActivity(try activity("1", revision: "2"))], scope: scope)
        default: sync.configure(SyncFixtures.session(id: "bob")); try await storage.clear(scope: scope)
        }
        await probe.release()
        await completion.value
        #expect(try await storage.cachedStreamSummary(activityID: "1", scope: scope) == nil)
    }

    @Test func offlineSessionNeverStartsBatchRequests() async throws {
        let storage = try await store([activity("1")])
        let probe = StoredSummaryProbe()
        let sync = sync(probe)
        sync.configure(SyncFixtures.session(verified: false))
        sync.start(storage: storage)
        await sync.waitUntilIdle()
        #expect(await probe.batches.isEmpty)
    }

    @Test func completedBackgroundBatchUpdatesAnAlreadyVisibleFailedDetail() async throws {
        let row = try activity("1")
        let storage = try await store([])
        let probe = StoredSummaryProbe([try summary("1")], hold: true)
        let foreground = SummarySourceProbe([.failure(.transport("offline"))])
        let controller = SyncController(activities: ActivityStore(), source: { _ in SyncFixtures.complete([row]) },
            summarySource: { _ in foreground }, storedSummarySource: { _ in probe }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        await probe.waitForRequest()
        await controller.summaries.load(activityID: "1")
        if case .failed = controller.summaries.state(for: "1") {} else { Issue.record("Expected foreground transport failure") }
        await probe.release()
        await controller.summarySync.waitUntilIdle()
        let deadline = Date().addingTimeInterval(5)
        while controller.summaries.currentSummary(for: "1") == nil, Date() < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        #expect(controller.summaries.currentSummary(for: "1")?.isCurrent == true)
        #expect(await foreground.calls == 1)
    }

    @Test(arguments: ["pause", "logout", "account"])
    func controllerTransitionsCancelLateSummaryResponses(_ transition: String) async throws {
        let row = try activity("1")
        let storage = try await store([])
        let probe = StoredSummaryProbe([try summary("1")], hold: true)
        let controller = SyncController(activities: ActivityStore(), source: { session in
            SyncFixtures.complete(session.user.id == "alice" ? [row] : [])
        }, storedSummarySource: { _ in probe }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        await probe.waitForRequest()
        let completion = Task { await controller.summarySync.waitUntilIdle() }
        await Task.yield()
        if transition == "pause" { controller.pause() }
        else {
            controller.setSession(transition == "logout" ? nil : SyncFixtures.session(id: "bob"), storage: storage)
            await controller.refresh()
        }
        await probe.release()
        await completion.value
        #expect(try await storage.cachedStreamSummary(activityID: "1", scope: scope) == nil)
        if transition != "pause" { #expect(controller.activities.activities.isEmpty) }
    }

    @Test func backgroundPublicationDoesNotCancelAnExplicitForegroundRefresh() async throws {
        let row = try activity("1")
        let storage = try await store([])
        let probe = StoredSummaryProbe([try summary("1")], hold: true)
        let foreground = SummarySourceProbe([], hold: true)
        let controller = SyncController(activities: ActivityStore(), source: { _ in SyncFixtures.complete([row]) },
            summarySource: { _ in foreground }, storedSummarySource: { _ in probe }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        await probe.waitForRequest()
        let refresh = Task { await controller.summaries.load(activityID: "1", refresh: true) }
        let deadline = Date().addingTimeInterval(5)
        while await foreground.calls == 0, Date() < deadline { try await Task.sleep(for: .milliseconds(5)) }
        #expect(await foreground.calls == 1)
        await probe.release()
        await controller.summarySync.waitUntilIdle()
        // Deliver the async store publication while the detail request is held.
        try await Task.sleep(for: .milliseconds(20))
        #expect(controller.summaries.state(for: "1") == .loading)
        await foreground.resolve(.init(payload: try summary("1", revision: "2"), statusCode: 200,
                                       retryAfter: nil, requestID: "foreground", body: Data()))
        await refresh.value
        #expect(controller.summaries.currentSummary(for: "1")?.metadata.revision == "2")
        #expect(try await storage.cachedStreamSummary(activityID: "1", scope: scope)?.metadata.revision == "2")
    }
}

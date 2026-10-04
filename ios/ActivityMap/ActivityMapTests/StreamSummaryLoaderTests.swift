import Foundation
import Testing
@testable import ActivityMap

actor SummarySourceProbe: CompactSummarySource {
    typealias Response = APIClient.Response<ActivityMapAPI.ActivityCompactStreamSummary>
    var steps: [Result<Response, APIClient.RequestError>]
    private(set) var calls = 0
    private(set) var modes: [StreamFetchMode] = []
    private var continuation: CheckedContinuation<Response, Error>?
    let hold: Bool
    init(_ steps: [Result<Response, APIClient.RequestError>], hold: Bool = false) { self.steps = steps; self.hold = hold }
    func summary(activityID: String, mode: StreamFetchMode) async throws -> Response {
        calls += 1
        modes.append(mode)
        if hold && calls == 1 { return try await withCheckedThrowingContinuation { continuation = $0 } }
        guard !steps.isEmpty else { throw APIClient.RequestError.transport("Unexpected request") }
        return try steps.removeFirst().get()
    }
    func resolve(_ response: Response) { continuation?.resume(returning: response); continuation = nil }
}
nonisolated final class SummaryClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded(.down))
    private var delays: [TimeInterval] = []
    func now() -> Date { lock.lock(); defer { lock.unlock() }; return value }
    func advance(_ delay: TimeInterval) { lock.lock(); defer { lock.unlock() }; delays.append(delay); value.addTimeInterval(delay) }
    var sleeps: [TimeInterval] { lock.lock(); defer { lock.unlock() }; return delays }
}

@MainActor struct StreamSummaryLoaderTests {
    private let id = StreamFixtures.activityID
    private func setup(_ source: SummarySourceProbe, clock: SummaryClock = SummaryClock(), window: TimeInterval = 30,
                       verified: Bool = true) async throws -> (LocalStore, StreamSummaryLoader, SyncSession) {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await store.apply([.upsertActivity(try Fixtures.activity(["id": id]))], scope: Fixtures.scope)
        let session = SyncFixtures.session(verified: verified)
        let loader = StreamSummaryLoader(pollingWindow: window, now: { clock.now() }, sleep: { clock.advance($0); try Task.checkCancellation() },
            source: { _ in source })
        await loader.configure(session, storage: store)
        return (store, loader, session)
    }
    private func response(_ status: Int = 200, delay: TimeInterval? = nil, next: Date? = nil,
                          state: String = "current", retryableError: Bool? = nil) throws -> SummarySourceProbe.Response {
        var json = StreamFixtures.summaryJSON(state: state)
        if let next { json = json.replacingOccurrences(of: "\"next_retry_at\":null", with: "\"next_retry_at\":\"\(next.ISO8601Format())\"") }
        if let retryableError {
            json = json.replacingOccurrences(of: "\"last_error\":null",
                with: "\"last_error\":{\"code\":\"upstream_error\",\"retryable\":\(retryableError)}")
        }
        let body = StreamFixtures.envelope(json)
        let payload = try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.Envelope<ActivityMapAPI.ActivityCompactStreamSummary>.self, from: body).data
        return .init(payload: payload, statusCode: status, retryAfter: delay, requestID: "r", body: body)
    }
    private func waitFor(_ predicate: () async -> Bool) async throws {
        let stop = Date().addingTimeInterval(5)
        while !(await predicate()), Date() < stop { try await Task.sleep(for: .milliseconds(5)) }
        #expect(await predicate())
    }

    @Test func demandIsDeduplicatedAndDoesNotNeedRawRequests() async throws {
        let probe = SummarySourceProbe([], hold: true)
        let (store, loader, _) = try await setup(probe)
        let first = Task { await loader.load(activityID: id) }
        try await waitFor { await probe.calls == 1 }
        let second = Task { await loader.load(activityID: id) }
        await probe.resolve(try response())
        await first.value; await second.value
        #expect(await probe.calls == 1)
        if case .current(let cached) = loader.state(for: id) { #expect(cached.dto.summary?.altitude != nil) }
        else { Issue.record("Expected cached current summary") }
        #expect(try await store.snapshot(scope: Fixtures.scope).activities.count == 1)
    }


    @Test func departingConsumerDoesNotCancelAnotherVisibleDetail() async throws {
        let probe = SummarySourceProbe([], hold: true)
        let (_, loader, _) = try await setup(probe)
        let first = Task { await loader.load(activityID: id) }
        try await waitFor { await probe.calls == 1 }
        let second = Task { await loader.load(activityID: id) }
        // Let the second consumer join the in-flight request before leaving.
        try await Task.sleep(for: .milliseconds(20))
        first.cancel()
        try await Task.sleep(for: .milliseconds(20))
        await probe.resolve(try response())
        await first.value; await second.value
        #expect(loader.currentSummary(for: id) != nil)
        #expect(await probe.calls == 1)
    }

    @Test func pendingPollingHonorsHeaderAndBodyDeadlineAndRefreshOnlyOnce() async throws {
        let clock = SummaryClock()
        let probe = SummarySourceProbe([.success(try response(202, delay: 3, state: "not_fetched")), .success(try response())])
        let (_, loader, _) = try await setup(probe, clock: clock)
        await loader.load(activityID: id, refresh: true)
        #expect(clock.sleeps == [3])
        #expect(await probe.modes == [.refresh, .auto])
        if case .current = loader.state(for: id) {} else { Issue.record("Expected ready after pending") }

        let delayed = SummarySourceProbe([.success(try response(202, delay: 3, next: clock.now().addingTimeInterval(120), state: "not_fetched"))])
        let (_, paused, _) = try await setup(delayed, clock: clock)
        await paused.load(activityID: id)
        if case .pending(let deadline, let isPaused) = paused.state(for: id) {
            #expect(deadline == clock.now().addingTimeInterval(120) && isPaused)
        } else { Issue.record("Expected bounded pending pause") }
        await paused.load(activityID: id, refresh: true)
        #expect(await delayed.calls == 1, "Manual refresh cannot shorten a server retry guard")
    }

    @Test(arguments: [429, 503])
    func retryableFailuresHonorFullServerDelay(status: Int) async throws {
        let clock = SummaryClock()
        let error: APIClient.RequestError = status == 429 ? .rateLimited(retryAfter: 120, requestID: "r")
            : .server(code: "upstream", message: "Later", status: 503, requestID: "r", retryable: true, retryAfter: 120)
        let probe = SummarySourceProbe([.failure(error)])
        let (_, loader, _) = try await setup(probe, clock: clock)
        await loader.load(activityID: id)
        if case .failed(let failure) = loader.state(for: id) {
            #expect(failure.retryAt == clock.now().addingTimeInterval(120) && failure.retryable)
        } else { Issue.record("Expected guarded retryable failure") }
        #expect(clock.sleeps.isEmpty)
        await loader.load(activityID: id)
        #expect(await probe.calls == 1)
    }

    @Test func cancellationDeletionAndLateResponsesCannotRepublishOrWrite() async throws {
        let probe = SummarySourceProbe([], hold: true)
        let (store, loader, _) = try await setup(probe)
        let task = Task { await loader.load(activityID: id) }
        try await waitFor { await probe.calls == 1 }
        try await store.apply([.deleteActivity(id), .upsertActivity(try Fixtures.activity(["id": id]))], scope: Fixtures.scope)
        await probe.resolve(try response())
        await task.value
        #expect(try await store.cachedStreamSummary(activityID: id, scope: Fixtures.scope) == nil)
        #expect(loader.state(for: id) != .loading)
    }

    @Test func logoutRejectsResponseEvenWhenSourceIgnoresCancellation() async throws {
        let probe = SummarySourceProbe([], hold: true)
        let (store, loader, _) = try await setup(probe)
        let task = Task { await loader.load(activityID: id) }
        try await waitFor { await probe.calls == 1 }
        loader.reset()
        try await store.clearExcept(scope: nil)
        await probe.resolve(try response())
        await task.value
        #expect(loader.states.isEmpty)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: Fixtures.scope) == nil)
    }

    @Test func sameScopeVerificationChangeStopsPendingNetworkPolling() async throws {
        let probe = SummarySourceProbe([], hold: true)
        let (store, loader, session) = try await setup(probe)
        let task = Task { await loader.load(activityID: id) }
        try await waitFor { await probe.calls == 1 }
        await loader.configure(.init(user: session.user, token: session.token, deployment: session.deployment, verified: false), storage: store)
        await probe.resolve(try response(202, delay: 3, state: "not_fetched"))
        await task.value
        #expect(await probe.calls == 1)
        if case .pending(_, let paused) = loader.state(for: id) { #expect(paused) }
        else { Issue.record("Pending work pauses while offline") }
    }

    @Test func persistedBodyFailureDeadlineAndTerminalErrorsPreventAutomaticRetry() async throws {
        let clock = SummaryClock()
        let probe = SummarySourceProbe([.success(try response(delay: 3, next: clock.now().addingTimeInterval(120),
                                                             state: "stale", retryableError: true))])
        let (_, loader, _) = try await setup(probe, clock: clock)
        await loader.load(activityID: id)
        if case .failed(let failure) = loader.state(for: id) {
            #expect(failure.retryable && failure.retryAt == clock.now().addingTimeInterval(120))
        } else { Issue.record("Expected body retry deadline to survive") }
        await loader.load(activityID: id, refresh: true)
        #expect(await probe.calls == 1)

        let terminal = SummarySourceProbe([.failure(.server(code: "activity_unavailable", message: "Gone", status: 404, requestID: "r", retryable: false))])
        let (_, stopped, _) = try await setup(terminal)
        await stopped.load(activityID: id)
        await stopped.load(activityID: id)
        #expect(await terminal.calls == 1)
    }

    @Test func explicit401ClearsPublicationAndNotifiesOwningAuthentication() async throws {
        let probe = SummarySourceProbe([.failure(.server(code: "not_authenticated", message: "Expired", status: 401, requestID: "r", retryable: false))])
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await store.apply([.upsertActivity(try Fixtures.activity(["id": id]))], scope: Fixtures.scope)
        var invalidated: String?
        let loader = StreamSummaryLoader(source: { _ in probe }, invalidate: { invalidated = $0 })
        let session = SyncFixtures.session()
        await loader.configure(session, storage: store)
        await loader.load(activityID: id)
        #expect(invalidated == session.token && loader.states.isEmpty)
        #expect(try await store.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func initialTrueExpiryClearsCacheAndInvalidatesAuthentication() async throws {
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await store.apply([.upsertActivity(try Fixtures.activity(["id": id]))], scope: Fixtures.scope)
        let expired = SyncSession(user: .init(id: Fixtures.scope.userID, name: "Expired", email: nil, image: nil, athleteID: "42", stravaConnected: true,
            authentication: .init(method: .bearer, sessionExpiresAt: .distantPast)), token: "expired", deployment: Fixtures.scope.deployment, verified: true)
        var invalidated: String?
        let loader = StreamSummaryLoader(invalidate: { invalidated = $0 })
        await loader.configure(expired, storage: store)
        await loader.load(activityID: id)
        #expect(invalidated == expired.token && loader.states.isEmpty)
        #expect(try await store.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func trueExpiryDuringWarmRetryClearsCacheBeforeServerDeadline() async throws {
        let clock = SummaryClock()
        let probe = SummarySourceProbe([.success(try response()), .failure(.rateLimited(retryAfter: 60, requestID: "r"))])
        let store = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await store.apply([.upsertActivity(try Fixtures.activity(["id": id]))], scope: Fixtures.scope)
        let session = SyncSession(user: .init(id: Fixtures.scope.userID, name: "Valid", email: nil, image: nil, athleteID: "42", stravaConnected: true,
            authentication: .init(method: .bearer, sessionExpiresAt: clock.now().addingTimeInterval(10))),
            token: "short-lived", deployment: Fixtures.scope.deployment, verified: true)
        var invalidated: String?
        let loader = StreamSummaryLoader(now: { clock.now() }, source: { _ in probe }, invalidate: { invalidated = $0 })
        await loader.configure(session, storage: store)
        await loader.load(activityID: id)
        #expect(loader.currentSummary(for: id) != nil)
        await loader.load(activityID: id, refresh: true)
        if case .failed(let failure) = loader.state(for: id) { #expect(failure.retryAt == clock.now().addingTimeInterval(60)) }
        else { Issue.record("Expected server retry guard") }
        clock.advance(11)
        await loader.load(activityID: id, refresh: true)
        #expect(invalidated == session.token && loader.states.isEmpty && loader.cachedSummaries.isEmpty)
        #expect(try await store.snapshot(scope: Fixtures.scope).activities.isEmpty)
        #expect(try await store.cachedStreamSummary(activityID: id, scope: Fixtures.scope) == nil)
        #expect(await probe.calls == 2, "Expiry cleanup must not wait for or bypass the server retry deadline")
    }

    @Test func committedSyncInvalidationUpdatesObservedCurrentSummaryWithoutFetching() async throws {
        let probe = SummarySourceProbe([.success(try response())])
        let (store, loader, _) = try await setup(probe)
        await loader.load(activityID: id)
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON(generation: "g2", state: "stale").utf8))
        try await store.apply([.upsertActivity(try Fixtures.activity(["id": id, "streams": metadata]))], scope: Fixtures.scope)
        try await waitFor {
            if case .stale = loader.state(for: id) { return true }
            return false
        }
        #expect(await probe.calls == 1, "Sync invalidation updates state without eagerly requesting profiles")
    }

    @Test(arguments: ["pending", "transport", "429", "503"])
    func warmRefreshPreservesCurrentEncodedDataWithProgressOrRetry(scenario: String) async throws {
        let second: Result<SummarySourceProbe.Response, APIClient.RequestError>
        switch scenario {
        case "pending": second = .success(try response(202, delay: 120))
        case "transport": second = .failure(.transport("Offline"))
        case "429": second = .failure(.rateLimited(retryAfter: 120, requestID: "r"))
        default: second = .failure(.server(code: "upstream", message: "Later", status: 503, requestID: "r", retryable: true, retryAfter: 120))
        }
        let probe = SummarySourceProbe([.success(try response()), second])
        let (_, loader, _) = try await setup(probe)
        await loader.load(activityID: id)
        let before = try #require(loader.currentSummary(for: id))
        await loader.load(activityID: id, refresh: true)
        let retained = try #require(loader.currentSummary(for: id))
        #expect(retained.dto == before.dto && retained.isCurrent)
        if scenario == "pending" {
            if case .pending(_, let paused) = loader.state(for: id) { #expect(paused) }
            else { Issue.record("Expected pending progress alongside cached data") }
        } else {
            if case .failed(let failure) = loader.state(for: id) { #expect(failure.retryable) }
            else { Issue.record("Expected retry status alongside cached data") }
        }
        #expect(await probe.calls == 2)
    }
}

import Foundation
import Testing
@testable import ActivityMap

actor ScriptedShareLinksSource: ShareLinksSource {
    private(set) var requests: [ActivityMapAPI.CreateShareLinkRequest] = []
    var failure: APIClient.RequestError?
    let gated: Bool
    private var response: CheckedContinuation<ActivityMapAPI.CreatedShareLink, Never>?
    private var requested: CheckedContinuation<Void, Never>?
    init(gated: Bool = false, failure: APIClient.RequestError? = nil) { self.gated = gated; self.failure = failure }
    static var link: ActivityMapAPI.CreatedShareLink {
        .init(id: "8f75ec62-e2e8-4a0e-93aa-bc06268a72cb", token: "test_capability-123", expiresAt: .now.addingTimeInterval(86400))
    }
    func create(_ request: ActivityMapAPI.CreateShareLinkRequest) async throws -> ActivityMapAPI.CreatedShareLink {
        requests.append(request)
        if let failure { throw failure }
        if gated { return await withCheckedContinuation { response = $0; requested?.resume(); requested = nil } }
        return Self.link
    }
    func waitForRequest() async {
        if !requests.isEmpty { return }
        await withCheckedContinuation { requested = $0 }
    }
    func release() { response?.resume(returning: Self.link); response = nil }
    func list() -> [ActivityMapAPI.ShareLinkSummary] { [] }
    func revoke(id: String) { }
}

@MainActor
struct ActivitySharingTests {
    private func activity(_ id: Int) throws -> Activity {
        try StoredModelMapper.activity(Fixtures.activity(["id": String(id)]))
    }
    private func service(_ source: any ShareLinksSource) -> ActivitySharingService {
        let service = ActivitySharingService()
        service.session = { SyncFixtures.session() }
        service.source = { _ in source }
        return service
    }

    @Test func creationDirectlyPreservesExactScopeAndPrivacyDefaults() async throws {
        let store = ActivityStore(activities: try [activity(1), activity(2), activity(3)])
        store.replaceSelection(with: [1, 2])
        let model = ActivityShareModel(activities: store.activities.filter { store.selectedActivityIDs.contains($0.id) })
        store.replaceSelection(with: [3])
        let source = ScriptedShareLinksSource()
        let service = service(source)
        #expect(await source.requests.isEmpty && model.url == nil)
        await model.create(using: service)
        let request = try #require(await source.requests.first)
        #expect(request.activityIds == ["1", "2"])
        #expect(!request.fields.showRouteEnds && request.expiresInMs == 604800000)
        #expect(model.url?.absoluteString == "https://example.test/share/test_capability-123")
        #expect(model.step == .created && !model.isBusy && model.errorMessage == nil)
        await model.create(using: service)
        #expect(await source.requests.count == 1)
        #expect(store.selectedActivityIDs == [3] && store.activeActivityID == 3)
    }

    @Test func duplicateCreationAndLateAccountResponseAreFenced() async throws {
        let model = ActivityShareModel(activities: try [activity(1)])
        let source = ScriptedShareLinksSource(gated: true)
        let service = service(source)
        let task = Task { await model.create(using: service) }
        await source.waitForRequest()
        #expect(model.isBusy)
        await model.create(using: service)
        #expect(await source.requests.count == 1)
        service.session = { SyncFixtures.session(id: "bob") }
        await source.release()
        await task.value
        #expect(model.url == nil && model.created == nil && !model.isBusy)
    }

    @Test func mapSharingFollowsDetailAndExplicitSelectionMode() {
        let store = ActivityStore(activities: (1...3).map { ActivityStoreSelectionTests.activity($0) })
        let picker = RoutePicker()
        picker.apply(ids: [1, 2], adding: false, request: picker.invalidateQuery(), store: store)
        #expect(store.selectedActivityIDs == [1, 2] && picker.detailID == nil)
        #expect(picker.activitiesToShare(in: store).isEmpty, "A map hit list alone must not expose group sharing")
        store.setCombine(true)
        #expect(Set(picker.activitiesToShare(in: store).map(\.id)) == [1, 2])
        picker.showDetail(2, store: store)
        #expect(picker.activitiesToShare(in: store).map(\.id) == [2], "An open detail narrows even a multi-selection share")
        store.setCombine(false)
        #expect(picker.activitiesToShare(in: store).map(\.id) == [2])
        picker.showResults()
        #expect(picker.activitiesToShare(in: store).isEmpty)
        store.clearSelection(); picker.reconcile(with: store); store.setCombine(true)
        #expect(picker.activitiesToShare(in: store).isEmpty)
        picker.apply(ids: [3], adding: true, request: picker.invalidateQuery(), store: store)
        #expect(picker.activitiesToShare(in: store).map(\.id) == [3])
        store.setCombine(false)
        picker.apply(ids: [1], adding: false, request: picker.invalidateQuery(), store: store)
        #expect(picker.detailID == 1 && picker.activitiesToShare(in: store).map(\.id) == [1])
    }

    @Test func scopeLimitsSignInAndRateLimitKeepDraftAvailable() async throws {
        let source = ScriptedShareLinksSource(failure: .rateLimited(retryAfter: 60, requestID: nil))
        let service = service(source)
        let empty = ActivityShareModel(activities: [])
        let oversized = ActivityShareModel(activities: try (1...201).map(activity))
        #expect(empty.scopeError != nil && oversized.scopeError != nil)
        let model = ActivityShareModel(activities: try [activity(1)])
        model.showRouteEnds = true; model.expiresInHours = 24
        await model.create(using: service)
        #expect(model.errorMessage != nil && model.retryAt != nil && model.step == .configure && model.showRouteEnds)
        await model.create(using: service)
        #expect(await source.requests.count == 1)
        let request = try #require(await source.requests.first)
        #expect(request.fields.showRouteEnds && request.expiresInMs == 86400000)
        service.session = { nil }
        #expect(service.unavailableReason != nil)
    }
}

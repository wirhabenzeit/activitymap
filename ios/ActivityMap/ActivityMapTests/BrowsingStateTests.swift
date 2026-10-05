import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct BrowsingStateTests {
    @Test func emptyStatesHaveDistinctCopyAndRecovery() {
        func presentation(_ status: SyncController.Status?, cache: Bool = false, activities: Int = 0,
                          filtered: Int = 0, routes: Int = 0, tab: AppTab = .map, retry: Bool = true) -> BrowsingPresentation {
            BrowsingPresentation(tab: tab, activityCount: activities, filteredCount: filtered,
                                 routeCount: routes, status: status, hasCompletedCache: cache, canRetry: retry)
        }
        let states: [(BrowsingPresentation, BrowsingPresentation.EmptyKind, BrowsingPresentation.Recovery?)] = [
            (presentation(nil), .preparing, nil),
            (presentation(.syncing), .firstSync, .cancelSync),
            (presentation(.ready, cache: true), .emptyLibrary, .retry),
            (presentation(.ready, cache: true, activities: 2), .noMatches, .clearFilters),
            (presentation(.ready, cache: true, activities: 2, filtered: 2), .noRoutes, .showList),
            (presentation(.signedOut), .signedOut, .account),
            (presentation(.expired), .expired, .account),
            (presentation(.disconnected), .disconnected, .account),
            (presentation(.offline), .offline, .retry),
            (presentation(.failed("503")), .failed, .retry),
            (presentation(.paused), .paused, .retry),
            (presentation(.rateLimited(Date()), retry: false), .waiting, nil),
        ]
        for (state, kind, action) in states {
            #expect(state.empty?.kind == kind && state.empty?.recovery == action)
            #expect(state.empty?.title.isEmpty == false && state.empty?.message.isEmpty == false)
        }
        #expect(presentation(.ready, cache: true, activities: 2, filtered: 2, tab: .list).empty == nil)

        // #304: a connection in progress replaces the signed-out empty state.
        let connecting = BrowsingPresentation(tab: .map, activityCount: 0, filteredCount: 0, routeCount: 0,
                                              status: .signedOut, hasCompletedCache: false, canRetry: false,
                                              isSigningIn: true)
        #expect(connecting.empty?.kind == .signingIn && connecting.empty?.recovery == nil)
        #expect(presentation(.offline, cache: true, activities: 2, filtered: 2, routes: 1).empty == nil)
        #expect(presentation(.failed("503"), cache: true, activities: 2, filtered: 2, routes: 1).empty == nil)
    }

    @Test func syncAndReconciliationTimesAreIndependentAndMissingIsVisible() {
        let oldSync = Date().addingTimeInterval(-30 * 86400)
        let state = BrowsingPresentation(tab: .list, activityCount: 2, filteredCount: 2, routeCount: 0,
                                         status: .offline, hasCompletedCache: true, canRetry: true,
                                         lastSync: oldSync, reconciliation: nil, photoMetadataCount: 3)
        #expect(state.empty == nil && state.recovery == .retry)
        #expect(state.lastSync == oldSync && state.reconciliation == nil)
        #expect(state.photoMetadataCount == 3)
        #expect(state.statusTitle.contains("saved activities"))
    }

    @Test func sharedCacheFixturesUseProductionControllerAndPresentation() async throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appending(path: "shared/parity/state-fixtures.v1.json")
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let cases = try #require(root["cachePresentationCases"] as? [[String: Any]])
        #expect(cases.count >= 5)
        var handled = 0
        for fields in cases {
            let outcome = try #require(fields["expected"] as? String)
            // Profile freshness/current-chart acceptance is owned by #215/#217;
            // it does not expire or block the ordinary activity library.
            if outcome == "profile_not_current" { continue }
            handled += 1
            let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
            let dto = try Fixtures.activity(["id": "1"])
            let photo = try Fixtures.photo(["activity_id": "1"])
            let reference = Date()
            var checkpoint = Fixtures.checkpoint
            checkpoint.lastSyncAt = reference.addingTimeInterval(-Double(fields["last_sync_age_days"] as? Int ?? 0) * 86400)
            checkpoint.freshness = .init(lastSummaryReconciledAt: nil)
            try await storage.apply([.upsertActivity(dto), .upsertPhoto(photo)], checkpoint: checkpoint, scope: Fixtures.scope)
            let steps: [ScriptedSyncSource.Step]
            if outcome == "show_cached_with_retry" {
                steps = [.changes("cursor-1", .failure(.serviceUnavailable(retryAfter: 120, requestID: "fixture")))]
            } else if outcome == "rebootstrap_once_reconcile_orphan_data" {
                steps = [
                    .changes("cursor-1", .failure(SyncFixtures.rebootstrap)),
                    .bootstrap(.activities, nil, .success(SyncFixtures.activities())),
                    .bootstrap(.photos, nil, .success(SyncFixtures.photos())),
                    .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
                ]
            } else { steps = [] }
            let source = ScriptedSyncSource(steps)
            var invalidations = 0
            let controller = SyncController(activities: ActivityStore(), now: { reference }, source: { _ in source }, invalidate: { _ in invalidations += 1 })
            let valid = fields["session_valid"] as? Bool ?? true
            let base = SyncFixtures.session(verified: outcome != "show_cached_offline")
            var user = base.user
            if !valid { user = expiredUser(user, now: reference) }
            controller.setSession(SyncSession(user: user, token: base.token, deployment: base.deployment, verified: base.verified), storage: storage)
            await controller.refresh()
            controller.activities.selectedTab = .list
            let state = BrowsingPresentation(store: controller.activities, sync: controller)
            let snapshot = try await storage.snapshot(scope: Fixtures.scope)
            switch outcome {
            case "show_cached_offline":
                #expect(state.empty == nil && state.statusTitle.contains("saved activities"))
                #expect(controller.activities.activities.map(\.id) == [1] && snapshot.activities == [dto])
                #expect(state.lastSync == checkpoint.lastSyncAt && state.reconciliation == nil)
                #expect(await source.calls == 0 && invalidations == 0)
            case "show_cached_with_retry":
                #expect(state.empty == nil && state.retryAfter == reference.addingTimeInterval(120))
                #expect(state.recovery == nil && !controller.canRefresh)
                await controller.refresh()
                #expect(await source.calls == 1 && invalidations == 0)
                #expect(snapshot.activities == [dto] && snapshot.photos == [photo])
            case "clear_scoped_data_sign_in_expired":
                #expect(state.empty?.kind == .expired && state.recovery == .account)
                #expect(controller.activities.activities.isEmpty && snapshot.activities.isEmpty && snapshot.photos.isEmpty)
            case "rebootstrap_once_reconcile_orphan_data":
                #expect(controller.status == .ready && state.empty?.kind == .emptyLibrary)
                #expect(snapshot.activities.isEmpty && snapshot.photos.isEmpty)
                #expect(await source.calls == 4 && invalidations == 0)
            default: Issue.record("Unexpected shared cache outcome: \(outcome)")
            }
        }
        #expect(handled == 4)
    }

    @Test func retryableServerWaitDoesNotExpireSelectionOrPermitEarlyRetries() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity(["id": "1"])
        try await storage.apply([.upsertActivity(dto)], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([
            .changes("cursor-1", .failure(.server(code: "busy", message: "Wait", status: 503, requestID: nil, retryable: true, retryAfter: 120))),
            .changes("cursor-1", .success(SyncFixtures.changes(next: "cursor-1"))),
        ])
        var reference = Date()
        let store = ActivityStore()
        let controller = SyncController(activities: store, now: { reference }, source: { _ in source }, invalidate: { _ in Issue.record("Transient failure invalidated sign-in") })
        controller.setSession(SyncFixtures.session(verified: false), storage: storage)
        await controller.refresh()
        store.replaceSelection(with: [1])
        store.inspect(1)
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        #expect(controller.status == .retryAfter(reference.addingTimeInterval(120)))
        #expect(!controller.canRefresh && store.selectedActivityIDs == [1] && store.inspectedActivityID == 1)
        await controller.refresh()
        #expect(await source.calls == 1)
        reference = reference.addingTimeInterval(121)
        #expect(controller.canRefresh)
        await controller.refresh()
        #expect(controller.status == .ready && controller.retryNotBefore == nil)
        #expect(store.selectedActivityIDs == [1] && store.inspectedActivityID == 1)
        #expect(await source.calls == 2)
    }

    @Test func routeAvailabilityTracksCommittedGeometryAndFilterIDs() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2, route: false)])
        #expect(store.routableActivityIDs == [1])
        store.searchText = "Activity 2"
        #expect(store.routableActivityIDs == [1])
        #expect(BrowsingPresentation(store: store, sync: nil).empty?.kind == .noRoutes)
        store.resetFilters()
        #expect(BrowsingPresentation(store: store, sync: nil).empty == nil)
        var changed = store.activities[0]
        changed.coordinates = []
        store.activities = [changed, store.activities[1]]
        #expect(store.routableActivityIDs.isEmpty)
        #expect(BrowsingPresentation(store: store, sync: nil).empty?.kind == .noRoutes)
    }

    @Test func explicit401KeepsExpiredPresentationAfterCredentialRemoval() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try Fixtures.activity())], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([.changes("cursor-1", .failure(.unexpectedStatus(401)))])
        var controller: SyncController!
        controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { _ in
            controller.setSession(nil, storage: storage)
        })
        controller.setSession(SyncFixtures.session(), storage: storage)
        await controller.refresh()
        await controller.refresh()
        #expect(controller.status == .expired && controller.session == nil)
        #expect(BrowsingPresentation(store: controller.activities, sync: controller).empty?.kind == .expired)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
    }

    @Test func signInExpiryCleansCacheEvenDuringServerBackoff() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        try await storage.apply([.upsertActivity(try Fixtures.activity())], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([.changes("cursor-1", .failure(.rateLimited(retryAfter: 120, requestID: nil)))])
        var reference = Date()
        let base = SyncFixtures.session()
        let user = ActivityMapAPI.CurrentUser(id: base.user.id, name: nil, email: nil, image: nil, athleteID: nil,
                                              stravaConnected: true, authentication: .init(method: .bearer, sessionExpiresAt: reference.addingTimeInterval(1)))
        let controller = SyncController(activities: ActivityStore(), now: { reference }, source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncSession(user: user, token: base.token, deployment: base.deployment, verified: true), storage: storage)
        await controller.refresh()
        #expect(controller.activities.activities.count == 1 && !controller.canRefresh)
        reference = reference.addingTimeInterval(2)
        await controller.refresh()
        #expect(controller.status == .expired && controller.activities.activities.isEmpty)
        #expect(try await storage.snapshot(scope: Fixtures.scope).activities.isEmpty)
        #expect(await source.calls == 1)
    }

    @Test func firstLoadAndPauseHaveFiniteRecoverableStates() async throws {
        let source = GatedSyncSource()
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let controller = SyncController(activities: ActivityStore(), source: { _ in source }, invalidate: { _ in })
        controller.setSession(SyncFixtures.session(), storage: storage)
        #expect(controller.status == .syncing)
        await source.waitForRequest()
        let loading = BrowsingPresentation(store: controller.activities, sync: controller)
        #expect(loading.empty?.kind == .firstSync && loading.empty?.progress == true)
        #expect(loading.recovery == .cancelSync)
        controller.pause()
        #expect(controller.status == .paused && controller.canRefresh)
        #expect(BrowsingPresentation(store: controller.activities, sync: controller).empty?.progress == false)
        await source.release(SyncFixtures.activities())
        // Finish cancellation without starting another network pass.
        await Task.yield()
    }

    private func expiredUser(_ user: ActivityMapAPI.CurrentUser, now: Date) -> ActivityMapAPI.CurrentUser {
        .init(id: user.id, name: user.name, email: user.email, image: user.image, athleteID: user.athleteID,
              stravaConnected: user.stravaConnected, authentication: .init(method: .bearer, sessionExpiresAt: now.addingTimeInterval(-1)))
    }
}

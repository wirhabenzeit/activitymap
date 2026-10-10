import Foundation
import Testing
@testable import ActivityMap

actor GatedStatsBuild {
    private var gate: CheckedContinuation<Void, Never>?
    private var started: CheckedContinuation<Void, Never>?
    private(set) var calls = 0
    private(set) var active = 0
    private(set) var maximumActive = 0
    func wait() async { if calls > 0 { return }; await withCheckedContinuation { started = $0 } }
    func release() { gate?.resume(); gate = nil }
    func build(_ rows: [StatsActivity]) async -> StatsEngine {
        calls += 1; active += 1; maximumActive = max(maximumActive, active)
        if calls == 1 { await withCheckedContinuation { gate = $0; started?.resume(); started = nil } }
        defer { active -= 1 }
        // Intentionally completes after cancellation to test real fencing.
        return StatsEngine(activities: rows)
    }
}

@MainActor struct StatsScopeTests {
    @Test(arguments: ["empty", "replayed-activity", "photo-only"])
    func unchangedActivitySyncKeepsStatsAndBrowsingCaches(scenario: String) async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity(), photo = try Fixtures.photo()
        try await storage.apply([.upsertActivity(dto)], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let changes: [ActivityMapAPI.SyncChangeItem]
        switch scenario {
        case "replayed-activity": changes = [SyncFixtures.upsert(dto)]
        case "photo-only": changes = [.init(sequence: "1", entityType: .photo, operation: .upsert,
                                            id: photo.uniqueID, activity: nil, photo: photo)]
        default: changes = []
        }
        let source = ScriptedSyncSource([
            .changes("cursor-1", .success(SyncFixtures.changes(changes, next: "polled"))),
            .changes("polled", .success(SyncFixtures.changes(next: "polled"))),
            .changes("polled", .success(SyncFixtures.changes(next: "polled"))),
        ])
        let store = ActivityStore(), sync = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        sync.setSession(SyncFixtures.session(verified: false), storage: storage); await sync.refresh()
        store.replaceSelection(with: [Int(dto.id)!]); store.inspect(Int(dto.id)!)
        _ = await store.stats.result(.totals, for: store)
        _ = store.filteredActivities; _ = store.listedActivities
        let revision = store.activitiesRevision, builds = store.filterBuildCount, sorts = store.sortBuildCount
        let imageRevision = store.photoImages.revision
        sync.setSession(SyncFixtures.session(), storage: storage); await sync.refresh()
        sync.pause(); await sync.refresh()
        _ = await store.stats.result(.totals, for: store)
        _ = store.filteredActivities; _ = store.listedActivities
        #expect(sync.status == .ready && sync.lastSyncAt != Fixtures.checkpoint.lastSyncAt)
        #expect(store.activitiesRevision == revision && store.filterBuildCount == builds && store.sortBuildCount == sorts)
        #expect(store.stats.aggregationCount == 1 && store.stats.calculationCount == 1)
        #expect(store.selectedActivityIDs == [Int(dto.id)!] && store.inspectedActivityID == Int(dto.id)!)
        #expect((store.photoImages.revision != imageRevision) == (scenario == "photo-only"))
        #expect(store.photos.count == (scenario == "photo-only" ? 1 : 0))
        #expect(await source.calls == 3)
    }

    @Test func statsResetPreservesDatesSelectionCameraAndListSettings() async throws {
        let fixture = try StatsFixtureTests.json("stats-parity-fixtures.v1.json")
        let sparse = (fixture["fixtures"] as! [[String: Any]])[1]
        let store = ActivityStore(activities: try StatsFixtureTests.source(sparse["activities"] as! [[String: Any]]))
        let filter = (sparse["cases"] as! [[String: Any]]).first { $0["operation"] as? String == "filterActivities" }!["args"] as! [String: Any]
        StatsFixtureTests.apply(filter["filter"] as! [String: Any], to: store)
        let visible = try #require(store.filteredActivities.first?.id)
        store.replaceSelection(with: [visible]); store.inspect(visible)
        let selection = store.selection, range = store.dateDayRange, camera = store.mapContext.scopeRevision
        let list = store.listPresentation.settings
        let scoped = try #require(await store.stats.engine(for: store))
        #expect(scoped.activities.contains { $0.day < StatsDates.day("2026-03-01") })
        store.resetStatsActivityFilters()
        #expect(store.dateDayRange == range)
        #expect(store.selectedActivityIDs == selection.selectedIDs && store.activeActivityID == selection.activeID && store.inspectedActivityID == selection.inspectedID)
        #expect(store.mapContext.scopeRevision == camera && store.listPresentation.settings == list)
        #expect(store.activeFilterCount == 1)
        #expect(store.filteredActivities.allSatisfy { range!.contains($0.localDayKey) })
        #expect(try #require(await store.stats.engine(for: store)).activities.count == store.activities.count)
    }
    @Test func largeLibraryReusesIndexAndBoundsOutputCache() async throws {
        let today = StatsDates.day("2026-09-30")
        let rows = (0..<20_000).map { index in
            var row = ActivityStoreSelectionTests.activity(index + 1, sport: index % 2 == 0 ? .run : .ride, route: false)
            row.startDateLocal = StatsDates.date(today - index % 3650)
            return row
        }
        let store = ActivityStore(activities: rows)
        store.stats.refreshToday(now: StatsDates.date(today), timeZone: .gmt)
        let revision = store.activitiesRevision, geometryRevision = store.mapContext.scopeRevision
        for _ in 0..<30 { _ = await store.stats.result(.records(.allTime), for: store) }
        #expect(store.stats.aggregationCount == 1 && store.stats.calculationCount == 1)
        #expect(store.stats.indexedActivityCount == 20_000)
        store.dateDayRange = ActivityDayRange(start: "2026-09-01", end: "2026-09-30")
        store.replaceSelection(with: [1]); store.selectedTab = .list
        _ = await store.stats.result(.records(.allTime), for: store)
        #expect(store.stats.aggregationCount == 1 && store.stats.calculationCount == 1)
        for page in 0..<30 { _ = await store.stats.result(.volumeHistory(.distance, .months, page: page), for: store) }
        #expect(store.stats.retainedResultCount == 16 && store.stats.aggregationCount == 1)
        #expect(store.activitiesRevision == revision && store.mapContext.scopeRevision == geometryRevision)
        #expect(store.activities.allSatisfy { $0.coordinates.isEmpty && $0.streams == nil && $0.photosState == nil })
        store.distanceFilter = NumericFilter(value: 2000)
        if case .totals(let totals) = await store.stats.result(.totals, for: store) { #expect(totals.count == 0) } else { Issue.record("Missing filtered totals") }
        #expect(store.stats.aggregationCount == 2)
    }
    @Test func concurrentIdenticalDemandCoalescesAndRapidChangesFenceOldWork() async throws {
        let gate = GatedStatsBuild(), controller = StatsController(build: { await gate.build($0) })
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)], stats: controller)
        let first = Task { await controller.engine(for: store) }
        await gate.wait()
        let same = Task { await controller.engine(for: store) }
        await Task.yield()
        #expect(controller.aggregationCount == 1)
        var obsolete: [Task<StatsEngine?, Never>] = []
        for value in 0..<30 {
            store.searchText = "filter \(value)"
            obsolete.append(Task { await controller.engine(for: store) })
            await Task.yield()
        }
        controller.clearScope()
        store.searchText = ""
        store.activities = [ActivityStoreSelectionTests.activity(2)]
        let latest = Task { await controller.engine(for: store) }
        await gate.release()
        let firstValue = await first.value, sameValue = await same.value
        #expect(firstValue == nil && sameValue == nil)
        for work in obsolete { #expect(await work.value == nil) }
        #expect(try #require(await latest.value).activities.map(\.id) == [2])
        #expect(await gate.maximumActive == 1, "Cancelled requests never start overlapping library builds")
        #expect(await gate.calls == 2 && controller.aggregationCount == 2)
    }
    @Test func foregroundMidnightAndTimezoneRecomputeWindowsWithoutReindexingActivities() async throws {
        var row = ActivityStoreSelectionTests.activity(1)
        row.startDateLocal = StatsDates.date(StatsDates.day("2024-03-01"))
        let store = ActivityStore(activities: [row]), instant = try #require(ISO8601DateFormatter().date(from: "2024-03-01T00:30:00Z"))
        store.stats.refreshToday(now: instant, timeZone: TimeZone(identifier: "America/Los_Angeles")!)
        if case .totals(let totals) = await store.stats.result(.totals, for: store) { #expect(totals.count == 0) } else { Issue.record("Missing totals") }
        store.stats.refreshToday(now: instant, timeZone: TimeZone(identifier: "Europe/Zurich")!)
        if case .totals(let totals) = await store.stats.result(.totals, for: store) { #expect(totals.count == 1) } else { Issue.record("Missing totals") }
        #expect(store.stats.aggregationCount == 1 && store.stats.calculationCount == 2)
        #expect(store.activities[0].localDayKey == "2024-03-01")
    }
    @Test func realSyncEditsTombstonesAndReplacementInvalidateResults() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let old = try Fixtures.activity(["id": "1", "distance": 1000])
        try await storage.apply([.upsertActivity(old)], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let edited = try Fixtures.activity(["id": "1", "distance": 8000])
        let replacement = try Fixtures.activity(["id": "2", "distance": 5000])
        let source = ScriptedSyncSource([
            .changes("cursor-1", .success(SyncFixtures.changes([SyncFixtures.upsert(edited)], next: "edited"))),
            .changes("edited", .success(SyncFixtures.changes(next: "edited"))),
            .changes("edited", .success(SyncFixtures.changes([.init(sequence: "2", entityType: .activity, operation: .delete, id: "1", activity: nil, photo: nil)], next: "deleted"))),
            .changes("deleted", .success(SyncFixtures.changes(next: "deleted"))),
            .changes("deleted", .failure(SyncFixtures.rebootstrap)),
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([replacement]))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos())),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
        ])
        let store = ActivityStore(), sync = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-09-30")), timeZone: .gmt)
        sync.setSession(SyncFixtures.session(verified: false), storage: storage); await sync.refresh()
        if case .totals(let value) = await store.stats.result(.totals, for: store) { #expect(value.distance == 1) } else { Issue.record("Missing cache") }
        #expect(StatsPresentation(store: store, sync: sync).state == .cached)
        sync.setSession(SyncFixtures.session(), storage: storage); await sync.refresh()
        if case .totals(let value) = await store.stats.result(.totals, for: store) { #expect(value.distance == 8) } else { Issue.record("Missing edited cache") }
        await sync.refresh()
        #expect(StatsPresentation(store: store, sync: sync).state == .noHistory)
        if case .totals(let value) = await store.stats.result(.totals, for: store) { #expect(value.count == 0) } else { Issue.record("Missing deleted cache") }
        await sync.refresh()
        if case .totals(let value) = await store.stats.result(.totals, for: store) { #expect(value.distance == 5) } else { Issue.record("Missing replacement cache") }
        #expect(store.activities.map(\.id) == [2])
        #expect(await source.calls == 8)
        #expect(store.stats.aggregationCount == 4)
    }
    @Test func lateStatsOutputCannotCrossRealAccountOrDeploymentTransition() async throws {
        for changeDeployment in [false, true] {
            let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true)), gate = GatedStatsBuild()
            try await storage.apply([.upsertActivity(try Fixtures.activity(["id": "1"]))], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
            let stats = StatsController(build: { await gate.build($0) }), store = ActivityStore(stats: stats)
            let source = SyncFixtures.complete([try Fixtures.activity(["id": "2"])])
            let sync = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
            sync.setSession(SyncFixtures.session(verified: false), storage: storage); await sync.refresh()
            let old = Task { await stats.engine(for: store) }; await gate.wait()
            var next = SyncFixtures.session(id: changeDeployment ? "alice" : "bob")
            if changeDeployment { next = SyncSession(user: next.user, token: next.token, deployment: URL(string: "https://another.test")!, verified: true) }
            sync.setSession(next, storage: storage)
            #expect(store.activities.isEmpty && StatsPresentation(store: store, sync: sync).state == .loading)
            await sync.refresh(); await gate.release()
            #expect(await old.value == nil)
            #expect(try #require(await stats.engine(for: store)).activities.map(\.id) == [2])
        }
    }
    @Test func oldAuthorizedCacheAndFailureStatesKeepContentWithoutInventingCoverage() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        var checkpoint = Fixtures.checkpoint; checkpoint.lastSyncAt = Date(timeIntervalSince1970: 1)
        try await storage.apply([.upsertActivity(try Fixtures.activity(["id": "1"]))], checkpoint: checkpoint, scope: Fixtures.scope)
        let source = ScriptedSyncSource([.changes("cursor-1", .failure(.server(code: "temporary", message: "Try later", status: 500, requestID: nil, retryable: false)))])
        let store = ActivityStore(), sync = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        #expect(StatsPresentation(store: store, sync: sync).state == .unavailable)
        sync.setSession(SyncFixtures.session(verified: false), storage: storage); await sync.refresh()
        let cached = StatsPresentation(store: store, sync: sync)
        #expect(cached.state == .cached && cached.hasContent && cached.historyComplete)
        sync.setSession(SyncFixtures.session(), storage: storage); await sync.refresh()
        let failed = StatsPresentation(store: store, sync: sync)
        #expect(failed.state == .error && failed.hasContent && failed.historyComplete && failed.retryAllowed)
        sync.setSession(SyncFixtures.session(connected: false), storage: storage)
        #expect(StatsPresentation(store: store, sync: sync).state == .unavailable && store.activities.isEmpty)
        await sync.refresh()
    }
    @Test func pausedIncompleteHistoryAndNoMatchesAreDistinct() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true)), source = GatedSyncSource()
        let store = ActivityStore(), sync = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        sync.setSession(SyncFixtures.session(), storage: storage); await source.waitForRequest()
        #expect(StatsPresentation(store: store, sync: sync).state == .loading)
        store.activities = [ActivityStoreSelectionTests.activity(1)]
        sync.pause()
        let partial = StatsPresentation(store: store, sync: sync)
        #expect(partial.state == .incomplete && partial.hasContent && !partial.historyComplete)
        await source.release(SyncFixtures.activities()); await Task.yield()
        let completed = SyncFixtures.complete([try Fixtures.activity(["id": "2"])])
        let ready = SyncController(activities: store, source: { _ in completed }, invalidate: { _ in })
        ready.setSession(SyncFixtures.session(id: "bob"), storage: storage); await ready.refresh()
        store.activeSportTypes = []
        #expect(StatsPresentation(store: store, sync: ready).state == .noMatches)
    }
    @Test func anonymousRecordTiesAndHillOrderUseTheirOwnContracts() {
        let date = StatsDates.date(StatsDates.day("2026-09-30"))
        func row(_ id: Int?, name: String, sport: ActivityCategory = .ride) -> StatsActivity {
            .init(id: id, name: name, sport: sport, start: date, distance: 5000, movingTime: 3600, elevation: 500)
        }
        let engine = StatsEngine(activities: [row(nil, name: "anonymous first"), row(9, name: "nine"), row(2, name: "two"), row(nil, name: "anonymous last")])
        let today = StatsDates.day(date)
        #expect(engine.records(today: today).activities[.distance]?.activityID == 2)
        #expect(engine.calendarDays(first: today, last: today)[today]?.activities.map(\.name) == ["two", "nine", "anonymous first", "anonymous last"])
        #expect(engine.hilliestActivities(today: today).map { $0.activity.name } == ["anonymous first", "nine", "two", "anonymous last"])
        #expect(engine.hillPoints(first: today, last: today).map { $0.activity.name } == ["anonymous first", "nine", "two", "anonymous last"])
        #expect(StatsPeriodComparison(current: 1, previous: 0).percentageChange == nil)
        #expect(StatsPeriodComparison(current: 3, previous: 2).percentageChange == 50)
    }
    @Test func binaryUnknownsDoNotMatchNoAndElapsedFiltersDoNotChangeMovingTime() async throws {
        var unknown = ActivityStoreSelectionTests.activity(1), known = ActivityStoreSelectionTests.activity(2)
        unknown.commute = nil; unknown.isPrivate = nil; unknown.flagged = nil
        known.commute = false; known.isPrivate = false; known.flagged = false
        known.elapsedTime = 7200; known.movingTime = 1800
        let store = ActivityStore(activities: [unknown, known])
        store.commuteOnly = false; store.privateFilter = false; store.flaggedFilter = false
        store.durationFilter = NumericFilter(value: 7000)
        let engine = try #require(await store.stats.engine(for: store))
        #expect(engine.activities.map(\.id) == [2])
        #expect(engine.totals(today: StatsDates.day(known.startDateLocal)).time == 0.5)
    }

    @Test func reportingDayChangeRejectsInFlightOldWindowButReusesCompletedIndex() async throws {
        let gate = GatedStatsBuild(), stats = StatsController(build: { await gate.build($0) })
        var row = ActivityStoreSelectionTests.activity(1)
        row.startDateLocal = StatsDates.date(StatsDates.day("2024-03-01"))
        let store = ActivityStore(activities: [row], stats: stats)
        stats.refreshToday(now: StatsDates.date(StatsDates.day("2024-02-29")), timeZone: .gmt)
        let old = Task { await stats.result(.totals, for: store) }
        await gate.wait()
        stats.refreshToday(now: StatsDates.date(StatsDates.day("2024-03-01")), timeZone: .gmt)
        await gate.release()
        #expect(await old.value == nil)
        if case .totals(let totals) = await stats.result(.totals, for: store) { #expect(totals.count == 1) }
        else { Issue.record("Expected new-day totals") }
        #expect(stats.aggregationCount == 1 && stats.calculationCount == 1)
    }
    @Test func authoritativeReplacementFencesInFlightStatsWithoutTransientEmptyOutput() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true)), gate = GatedStatsBuild()
        try await storage.apply([.upsertActivity(try Fixtures.activity(["id": "1", "distance": 1000]))], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let replacement = try Fixtures.activity(["id": "2", "distance": 9000])
        let source = ScriptedSyncSource([
            .changes("cursor-1", .failure(SyncFixtures.rebootstrap)),
            .bootstrap(.activities, nil, .success(SyncFixtures.activities([replacement]))),
            .bootstrap(.photos, nil, .success(SyncFixtures.photos())),
            .changes("snapshot", .success(SyncFixtures.changes(next: "snapshot"))),
        ])
        let stats = StatsController(build: { await gate.build($0) }), store = ActivityStore(stats: stats)
        let sync = SyncController(activities: store, source: { _ in source }, invalidate: { _ in })
        sync.setSession(SyncFixtures.session(verified: false), storage: storage); await sync.refresh()
        let old = Task { await stats.engine(for: store) }; await gate.wait()
        sync.setSession(SyncFixtures.session(), storage: storage); await sync.refresh()
        #expect(store.activities.map(\.id) == [2] && StatsPresentation(store: store, sync: sync).state == .ready)
        await gate.release()
        #expect(await old.value == nil)
        let engine = try #require(await stats.engine(for: store))
        #expect(engine.activities.map(\.id) == [2] && engine.totals(today: StatsDates.day("2026-09-30")).distance == 9)
    }
    @Test func ordinaryStatsAndHistoryDemandDoNotLoadEligibleStreamsOrBuildGeometry() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON().utf8))
        try await storage.apply([.upsertActivity(try Fixtures.activity(["id": "1", "streams": metadata]))], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let probe = SummarySourceProbe([]), source = ScriptedSyncSource([]), store = ActivityStore()
        let sync = SyncController(activities: store, source: { _ in source }, summarySource: { _ in probe }, invalidate: { _ in })
        sync.setSession(SyncFixtures.session(verified: false), storage: storage); await sync.refresh()
        #expect(store.activities[0].streams != nil && !store.activities[0].coordinates.isEmpty)
        let builds = store.routeGeometry.buildCount, revision = store.activitiesRevision
        for metric in StatsMetric.allCases {
            _ = await store.stats.result(.yearComparison(metric, offset: 0), for: store)
            _ = await store.stats.result(.volumeHistory(metric, .years, page: 0), for: store)
        }
        _ = await store.stats.result(.hilliness, for: store)
        for tile in StatsDashboard.tiles {
            for option in tile.toggle?.options.map(Optional.some) ?? [nil] {
                _ = await store.stats.result(.dashboard(tile.id, option), for: store)
            }
        }
        #expect(await probe.calls == 0)
        #expect(await source.calls == 0)
        #expect(store.routeGeometry.buildCount == builds && store.activitiesRevision == revision)
    }

}

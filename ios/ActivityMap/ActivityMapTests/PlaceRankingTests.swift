import Foundation
import SwiftUI
import Testing
@testable import ActivityMap

/// Most visited places (#461) against the fixture the web model also uses.
@MainActor struct PlaceRankingTests {
    static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "shared/place-ranking-fixtures.v1.json")

    /// Expands the shared shorthand into synced activities with place bundles.
    private func fixture() throws -> (root: [String: Any], store: ActivityStore) {
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: Self.fixtureURL)) as? [String: Any])
        let places = try #require(root["places"] as? [String: [String: Any]])
        let version = try #require(root["matchingVersion"] as? String)
        let rows = try #require(root["activities"] as? [[String: Any]])
        let activities = try rows.map { row -> ActivityMapAPI.Activity in
            let id = String(row["id"] as! Int)
            let matched = (row["places"] as! [[String: Any]]).map { entry -> [String: Any] in
                var place = places[entry["place"] as! String]!
                place["visits"] = (0..<(entry["encounters"] as! Int)).map { ["distanceM": 10 + $0] }
                return place.filter { !($0.value is NSNull) }
            }
            return try Fixtures.activity([
                "id": id, "name": "Activity \(id)", "sport_type": row["sport_type"]!,
                "start_date_local": row["start_date_local"]!,
                "streams": ["generation": "g1", "revision": "1", "state": "current", "fetch_status": "succeeded",
                            "available_types": ["distance", "altitude", "latlng"]],
                "placeMatches": ["userId": root["userId"]!, "activityId": id, "status": row["status"]!,
                                 "streamGeneration": "g1", "streamRevision": "1", "catalogueSnapshotId": "catalogue",
                                 "matcherVersion": "matcher", "matchingVersion": version, "resultRevision": "result-\(id)",
                                 "places": matched],
            ])
        }
        var checkpoint = Fixtures.checkpoint
        checkpoint.freshness = .init(lastSummaryReconciledAt: nil, placeMatchingVersion: version)
        let store = ActivityStore()
        try store.replaceSyncedActivities(StoreSnapshot(activities: activities, photos: [], checkpoint: checkpoint), scope: Fixtures.scope)
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day(root["today"] as! String)), timeZone: .gmt)
        return (root, store)
    }

    @Test func sharedFixtureCountsTiesKindsWindowsFiltersAndCoverage() async throws {
        let (root, store) = try fixture()
        let places = try #require(root["places"] as? [String: [String: Any]])
        let keys = Dictionary(uniqueKeysWithValues: places.map { ($0.value["id"] as! String, $0.key) })
        #expect(store.placeHistoryComplete)
        #expect(store.activities.allSatisfy { $0.placeMatches != nil }, "Fixture rows are current synced bundles")
        for row in try #require(root["cases"] as? [[String: Any]]) {
            let name = row["name"] as! String
            store.resetFilters()
            if let sports = row["sports"] as? [String] { store.activeSportTypes = Set(sports.compactMap(SportType.init(rawValue:))) }
            if let key = row["place"] as? String {
                store.selectPlace(try #require(store.placeLibrary.byID[places[key]!["id"] as! String]))
            }
            // The shared map/list date range never narrows a Stats window.
            store.dateDayRange = ActivityDayRange(start: "2026-10-01", end: "2026-10-02")
            let option = try #require(StatsToggleOption(rawValue: row["kind"] as! String))
            guard case .dashboard(.places(let current, let allTime)) = await store.stats.result(.dashboard(.visitedPlaces, option), for: store) else {
                Issue.record("Missing ranking for \(name)"); continue
            }
            let ranking = row["range"] as? String == "allTime" ? allTime : current
            let limit = row["limit"] as? Int ?? StatsPlaceRanking.limit
            let expected = row["expected"] as! [String: Any]
            let rows = ranking.rows.prefix(limit).map { item -> [String: AnyHashable] in
                ["place": keys[item.id]!, "count": item.place.activityCount, "rank": item.rank,
                 "latestVisit": StatsDates.key(StatsDates.day(item.place.latestVisit))]
            }
            #expect(rows == (expected["rows"] as! [[String: Any]]).map { $0.mapValues { $0 as! AnyHashable } }, "\(name)")
            #expect(ranking.total == expected["total"] as? Int, "\(name)")
            #expect(ranking.activities == expected["activities"] as? Int, "\(name)")
            #expect(ranking.checked == expected["checked"] as? Int, "\(name)")
            #expect(ranking.exhaustive(historyComplete: row["historyComplete"] as? Bool ?? true) == expected["exhaustive"] as? Bool, "\(name)")
        }
        store.resetFilters()
    }

    @Test func repeatedEncountersStayIntactAndOtherAccountsDoNotRank() async throws {
        let (_, store) = try fixture()
        let first = try #require(store.activities.first { $0.id == 1 })
        #expect(first.placeMatches?.places.first?.visits.count == 3)
        let rows = store.activities.map { StatsActivity(id: $0.id, name: $0.name, sport: $0.category, start: $0.startDateLocal,
                                                       distance: nil, movingTime: nil, elevation: nil,
                                                       places: PlaceLibrary.evidence($0, userID: "other")) }
        let ranking = StatsEngine(activities: rows).placeRanking(today: store.stats.reportingDay, kind: .peak, range: .allTime)
        #expect(ranking.total == 0 && ranking.checked == 0 && !ranking.exhaustive(historyComplete: true))
    }

    @Test func wordingSeparatesCompletedEmptyPendingAndHutVicinity() {
        func ranking(activities: Int, checked: Int, total: Int = 0) -> StatsPlaceRanking {
            .init(rows: [], total: total, activities: activities, checked: checked)
        }
        let note = StatsPlacesDetail.coverageNote
        #expect(note(ranking(activities: 1, checked: 1), "passes", false, true) == "No passes on your routes this year.")
        #expect(note(ranking(activities: 2, checked: 1), "passes", false, true) == "No passes found yet: 1 of 2 activities have no completed place check yet.")
        #expect(note(ranking(activities: 2, checked: 1, total: 3), "peaks", true, true) == "May be incomplete: 1 of 2 activities have no completed place check yet.")
        #expect(note(ranking(activities: 1, checked: 1), "peaks", false, false) == "Activity history is still loading; this ranking may be incomplete.")
        #expect(note(ranking(activities: 1, checked: 1, total: 2), "peaks", false, true) == nil)
        let hut = StatsPlacesDetail.explanation(.hut)
        #expect(hut.contains("passed near each hut") && hut.contains("does not mean you stopped or stayed"))
        #expect(StatsPlacesDetail.explanation(.peak).contains("once per activity"))
    }

    @Test func detailInspectionIsSeparateFromSelectionUntilShown() async throws {
        let (root, store) = try fixture()
        let places = try #require(root["places"] as? [String: [String: Any]])
        let alpha = try #require(store.placeLibrary.byID[places["alpha"]!["id"] as! String])
        let dashboard = StatsDashboardState()
        dashboard.inspectedPlaceID = alpha.id
        #expect(store.selectedPlace == nil)
        dashboard.resetInspection()
        #expect(dashboard.inspectedPlaceID == nil)
        store.show(alpha, in: .list)
        #expect(store.selectedPlace?.id == alpha.id && store.selectedTab == .list)
    }

    /// Narrow and accessibility-size cards and the focus ranking fit their width.
    @Test(arguments: [(false, DynamicTypeSize.large), (false, .accessibility3), (true, .large), (true, .accessibility3)])
    func renderedCardAndFocusFitNarrowAndLargeText(expanded: Bool, typeSize: DynamicTypeSize) async throws {
        let (_, store) = try fixture()
        guard case .dashboard(let result) = await store.stats.result(.dashboard(.visitedPlaces, .peak), for: store) else {
            Issue.record("Missing ranking"); return
        }
        let tile = try #require(StatsDashboard.tiles.first { $0.id == .visitedPlaces })
        let width: CGFloat = 375
        let view = StatsDashboardTile(tile: tile, option: .constant(.peak), displayed: .init(option: .peak, result: result),
                                      today: store.stats.reportingDay, expanded: expanded, filtered: false, toggleExpansion: {},
                                      detailScreen: expanded, placeHistoryComplete: store.placeHistoryComplete)
            .frame(width: width).environment(\.dynamicTypeSize, typeSize)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try #require(renderer.uiImage)
        #expect(image.size.width == width, "No horizontal overflow")
        #expect(image.size.height > 150)
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["ACTIVITYMAP_PLACES_RANKING_OUTPUT"] ?? "/tmp/activitymap-places-ranking")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try image.pngData()?.write(to: directory.appending(path: "\(expanded ? "focus" : "card")-\(typeSize).png"))
    }
}

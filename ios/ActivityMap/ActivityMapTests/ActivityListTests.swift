import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct ActivityListTests {
    @Test func selectionSortTracksSelectionWithoutInspectionInvalidation() {
        let presentation = ActivityListPresentation(defaults: nil)
        presentation.settings.sort = ActivityListSort(field: .selection, direction: .descending)
        let store = ActivityStore(activities: (1...4).map { ActivityStoreSelectionTests.activity($0) }, listPresentation: presentation)
        store.replaceSelection(with: [1, 3])
        #expect(store.listedActivities.map(\.id) == [3, 1, 4, 2])
        let builds = store.sortBuildCount
        store.inspect(2)
        store.dismissInspection()
        #expect(store.listedActivities.map(\.id) == [3, 1, 4, 2])
        #expect(store.sortBuildCount == builds)
        store.toggleSelection(4)
        #expect(store.listedActivities.map(\.id) == [4, 3, 1, 2])
        #expect(store.sortBuildCount == builds + 1)
        presentation.settings.sort.direction = .ascending
        #expect(store.listedActivities.map(\.id) == [2, 4, 3, 1])
        store.searchText = "Activity 2"
        #expect(store.listedActivities.map(\.id) == [2])
        #expect(store.hiddenSelectedCount == 3)
    }

    @Test func browsingSnapshotsReuseWorkAndInvalidateOnlyForTheirInputs() {
        let presentation = ActivityListPresentation(defaults: nil)
        let store = ActivityStore(activities: (1...4575).map { ActivityStoreSelectionTests.activity($0) },
                                  listPresentation: presentation)
        let ids = store.listedActivities.map(\.id)
        let filters = store.filterBuildCount, sorts = store.sortBuildCount
        for id in 1...50 {
            store.inspect(id)
            store.dismissInspection()
            store.toggleSelection(id)
            #expect(store.listedActivities.map(\.id) == ids)
        }
        presentation.settings.width = .scrollingMetrics
        presentation.settings.density = .compact
        _ = store.listedActivities
        #expect(store.filterBuildCount == filters && store.sortBuildCount == sorts,
                "Selection, inspection and display changes cannot filter/sort the library again")
        presentation.settings.sort.direction = .ascending
        #expect(store.listedActivities.first?.id == 1)
        #expect(store.filterBuildCount == filters && store.sortBuildCount == sorts + 1)
        store.searchText = "No matching activity"
        #expect(store.listedActivities.isEmpty)
        #expect(store.filterBuildCount == filters + 1 && store.sortBuildCount == sorts + 2)
        store.searchText = ""
        _ = store.listedActivities
        let beforeData = store.filterBuildCount, beforeSort = store.sortBuildCount
        store.activities[0].name = "Updated by sync"
        #expect(store.listedActivities.first?.name == "Updated by sync")
        #expect(store.filterBuildCount == beforeData + 1 && store.sortBuildCount == beforeSort + 1)
        store.activities.removeFirst()
        #expect(store.listedActivities.first?.id == 2)
        store.clearScope()
        #expect(store.listedActivities.isEmpty && store.activity(id: 2) == nil)
    }

    @Test func sharedSortVectorsUseProductionOrdering() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "shared/parity/activity-fixtures.v1.json")
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let projections = try #require(root["activities"] as? [[String: Any]])
        let activities = try projections.map { projection in
            var fields = projection
            for field in ActivitySortField.allCases where fields[field.rawValue] == nil {
                if ![.id, .name, .localDate, .sport, .geometry, .selection].contains(field) { fields[field.rawValue] = NSNull() }
            }
            return try StoredModelMapper.activity(Fixtures.activity(fields))
        }
        for vector in try #require(root["sortCases"] as? [[String: Any]]) {
            let ids = Set(try #require(vector["ids"] as? [String]))
            let sort = try #require(vector["sort"] as? [String: String])
            let fieldName = try #require(sort["field"])
            let directionName = try #require(sort["direction"])
            let field = try #require(ActivitySortField(rawValue: fieldName))
            let direction = try #require(ActivitySortDirection(rawValue: directionName))
            let result = ActivityListSort(field: field, direction: direction).sorted(activities.filter { ids.contains(String($0.id)) })
            #expect(result.map { String($0.id) } == vector["expected_ids"] as? [String], "\(vector["name"] ?? "sort vector")")
        }
    }

    @Test(arguments: ActivitySortField.allCases)
    func everySupportedSortHasDeterministicTies(field: ActivitySortField) throws {
        let models = try [1, 3, 2].map { try StoredModelMapper.activity(Fixtures.activity(["id": String($0)])) }
        #expect(ActivityListSort(field: field, direction: .descending).sorted(models).map(\.id) == [3, 2, 1])
        let ascending = ActivityListSort(field: field, direction: .ascending).sorted(models).map(\.id)
        #expect(ascending == (field == .id ? [1, 2, 3] : [3, 2, 1]))
    }

    @Test(arguments: ActivitySortDirection.allCases)
    func everyNullableFieldSortsUnknownLast(direction: ActivitySortDirection) throws {
        let unknownKeys = ["description", "distance", "moving_time", "elapsed_time", "average_speed", "max_speed",
                           "total_elevation_gain", "elev_high", "elev_low", "average_heartrate", "max_heartrate",
                           "average_watts", "weighted_average_watts", "max_watts", "kudos_count", "total_photo_count", "photo_count",
                           "calories", "kilojoules", "commute", "private", "flagged", "trainer", "manual", "achievement_count", "comment_count"]
        var unknown: [String: Any] = ["id": "99"]
        for key in unknownKeys { unknown[key] = NSNull() }
        var known: [String: Any] = ["id": "1", "description": "", "commute": false, "private": false,
                                    "flagged": false, "trainer": false, "manual": false]
        for key in unknownKeys where known[key] == nil { known[key] = 0 }
        let models = try [unknown, known].map { try StoredModelMapper.activity(Fixtures.activity($0)) }
        for field in ActivitySortField.allCases where ![.id, .name, .localDate, .sport, .geometry, .selection].contains(field) {
            #expect(ActivityListSort(field: field, direction: direction).sorted(models).map(\.id) == [1, 99], "\(field)")
        }
    }

    @Test func unroundedValuesNonfiniteValuesAndLargeIntegerIDs() throws {
        var a = try StoredModelMapper.activity(Fixtures.activity(["id": "9007199254740992", "distance": 1000.01]))
        let b = try StoredModelMapper.activity(Fixtures.activity(["id": "9007199254740993", "distance": 1000.02]))
        #expect(ActivityListSort().sorted([a, b]).map(\.id) == [b.id, a.id])
        #expect(ActivityListSort(field: .distance, direction: .ascending).sorted([b, a]).map(\.id) == [a.id, b.id])
        a.distance = .nan
        #expect(ActivityListSort(field: .distance, direction: .descending).sorted([a, b]).map(\.id) == [b.id, a.id])
    }

    @Test func textUsesNFCAndScalarOrderRatherThanLocaleCollation() throws {
        let names = ["é", "e\u{301}", "z", "Z", "İ", "i\u{307}"]
        let models = try names.enumerated().map { try StoredModelMapper.activity(Fixtures.activity(["id": String($0.offset + 1), "name": $0.element])) }
        #expect(ActivityListSort(field: .name, direction: .ascending).sorted(models).map(\.id) == [6, 5, 4, 3, 2, 1])
    }

    @Test func sportsUseCanonicalIdentifiers() {
        let models = SportType.allCases.enumerated().map { ActivityStoreSelectionTests.activity($0.offset + 1, sport: $0.element) }
        let expected = models.sorted { $0.sportType.rawValue < $1.sportType.rawValue }.map(\.id)
        #expect(ActivityListSort(field: .sport, direction: .ascending).sorted(models).map(\.id) == expected)
    }

    @Test func explicitGeometryOrderAndMetadataPhotoCount() throws {
        let models = try [
            ["id": "1", "geometry_state": "summary", "total_photo_count": 2, "photo_count": 1],
            ["id": "2", "geometry_state": "detailed", "total_photo_count": 0, "photo_count": 9],
            ["id": "3", "geometry_state": "refresh_required", "total_photo_count": 1],
        ].map { try StoredModelMapper.activity(Fixtures.activity($0)) }
        #expect(ActivityListSort(field: .geometry, direction: .ascending).sorted(models).map(\.id) == [1, 2, 3])
        #expect(ActivityListSort(field: .geometry, direction: .descending).sorted(models).map(\.id) == [3, 2, 1])
        #expect(ActivityListSort(field: .photos, direction: .ascending).sorted(models).map(\.id) == [2, 3, 1])
    }

    @Test func preferencesPersistAndAllFilteredResultsRemainReachable() throws {
        let suite = "ActivityListTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let presentation = ActivityListPresentation(defaults: defaults)
        #expect(presentation.settings.orderedMetrics == [.distance, .elapsedTime, .elevationGain])
        presentation.settings.sort = .init(field: .distance, direction: .ascending)
        presentation.settings.visibleMetrics = [.maxPower, .photos]
        presentation.settings.density = .compact
        presentation.settings.width = .scrollingMetrics
        #expect(ActivityListPresentation(defaults: defaults).settings == presentation.settings)
        let models = (1...10_000).map { id in
            // Activity IDs are immutable; use a fresh detached model with the
            // source's metrics but no rich detail/decoded stream payload.
            var model = ActivityStoreSelectionTests.activity(id, sport: id.isMultiple(of: 2) ? .run : .ride)
            model.distance = Double(10_000 - id)
            return model
        }
        let store = ActivityStore(activities: models, listPresentation: presentation)
        store.activeSportTypes = [.run]
        #expect(store.filteredActivities.count == 5000)
        #expect(store.listedActivities.count == 5000)
        #expect(store.listedActivities.first?.id == 10_000 && store.listedActivities.last?.id == 2)
        #expect(Set(store.listedActivities.map(\.id)).count == 5000)
        store.selectAllFiltered()
        #expect(store.selectedActivityIDs.count == 5000)
        store.selectedTab = .map
        store.selectedTab = .list
        #expect(store.listPresentation.settings == presentation.settings)
        store.clearScope()
        #expect(store.listPresentation.settings == presentation.settings)
        defaults.set(Data("invalid preferences".utf8), forKey: ActivityListPresentation.defaultsKey)
        #expect(ActivityListPresentation(defaults: defaults).settings == ActivityListSettings())
    }

    @Test func configurableFieldsKeepUnknownDistinctAndDetailKeepsHiddenInformation() throws {
        let activity = try StoredModelMapper.activity(Fixtures.activity([
            "distance": NSNull(), "elapsed_time": 0, "total_elevation_gain": 0, "private": false,
            "kudos_count": 0, "total_photo_count": 3, "manual": true,
        ]))
        #expect(ActivityListMetric.distance.value(for: activity) == Formatters.unknown)
        #expect(ActivityListMetric.elevationGain.value(for: activity) != Formatters.unknown)
        #expect(ActivityListMetric.privacy.value(for: activity) == "No")
        let ids = Set(ActivityMetricRow.rows(for: activity).map(\.id))
        #expect(ids.isSuperset(of: ["maxWatts", "weightedAverageWatts", "kudos", "photos", "privacy", "manual"]))
    }
}

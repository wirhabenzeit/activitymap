import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct ActivitySummaryTests {
    @Test func sharedSummaryVectorsUseProductionAggregates() throws {
        let root = try fixtureRoot()
        let models = try fixtureModels(root)
        for vector in try #require(root["summaryCases"] as? [[String: Any]]) {
            let strings = try #require(vector["ids"] as? [String])
            let ids = Set(try strings.map { try #require(Int($0)) })
            let expected = try #require(vector["expected"] as? [String: Any])
            let summary = ActivitySummary.aggregate(models, ids: ids)
            #expect(summary.activityCount == expected["activity_count"] as? Int)
            if let days = expected["local_day_count"] as? Int { #expect(summary.localDayCount == days) }
            for metric in ActivitySummaryMetric.allCases {
                guard let result = expected[metric.rawValue] as? [String: Any] else { continue }
                #expect(summary[metric].knownCount == result["known_count"] as? Int)
                let key: String
                switch metric.operation { case .sum: key = "sum"; case .mean: key = "mean"; case .minimum: key = "min"; case .maximum: key = "max" }
                if let value = result[key] as? Double {
                    let actual = try #require(summary[metric].value)
                    #expect(abs(actual - value) <= 1e-9, "\(vector["name"] ?? "fixture") \(metric)")
                } else { #expect(summary[metric].value == nil) }
            }
        }
    }

    @Test func completeMetricSpecificationIncludesIndependentMeanExtremaAndCoverage() throws {
        let first = try model(id: 1, values: ["distance": 1000.25, "elapsed_time": 1800, "moving_time": 1500,
            "total_elevation_gain": 50.5, "average_speed": 0, "elev_high": 1200, "elev_low": -12,
            "average_watts": 0, "weighted_average_watts": 100, "average_heartrate": 120, "max_watts": 500, "max_heartrate": 160])
        let second = try model(id: 2, values: ["distance": 3000.75, "elapsed_time": 3600, "moving_time": 3000,
            "total_elevation_gain": 25.5, "average_speed": 6, "elev_high": 1400, "elev_low": NSNull(),
            "average_watts": 200, "weighted_average_watts": 300, "average_heartrate": NSNull(), "max_watts": NSNull(), "max_heartrate": 180])
        let third = try model(id: 3, values: [:])
        let result = ActivitySummary.aggregate([first, second, third], ids: [1, 2, 3])
        let expected: [ActivitySummaryMetric: ActivitySummaryValue] = [
            .distance: .init(value: 4001, knownCount: 2), .elapsedTime: .init(value: 5400, knownCount: 2),
            .movingTime: .init(value: 4500, knownCount: 2), .elevationGain: .init(value: 76, knownCount: 2),
            .averageSpeed: .init(value: 3, knownCount: 2), .elevationHigh: .init(value: 1400, knownCount: 2),
            .elevationLow: .init(value: -12, knownCount: 1), .averagePower: .init(value: 100, knownCount: 2),
            .weightedPower: .init(value: 200, knownCount: 2), .averageHeartRate: .init(value: 120, knownCount: 1),
            .maxPower: .init(value: 500, knownCount: 1), .maxHeartRate: .init(value: 180, knownCount: 2),
        ]
        #expect(result.metrics == expected)
        #expect(result.activityCount == 3)
        #expect(ActivitySummaryMetric.elapsedTime.formatted(result[.elapsedTime].value) != Formatters.unknown)
    }

    @Test func emptyUnknownMeasuredZeroAndNonfiniteAreDifferent() throws {
        let unknown = try model(id: 1, values: [:])
        let empty = ActivitySummary.aggregate([unknown], ids: [])
        let allUnknown = ActivitySummary.aggregate([unknown], ids: [1])
        for metric in ActivitySummaryMetric.allCases {
            #expect(empty[metric].value == (metric.operation == .sum ? 0 : nil))
            #expect(empty[metric].knownCount == 0)
            #expect(allUnknown[metric].value == nil && allUnknown[metric].knownCount == 0)
        }
        var invalid = unknown
        invalid.distance = .infinity
        invalid.averageSpeed = .nan
        invalid.elevLow = -.infinity
        let zero = try model(id: 2, values: ["distance": 0, "average_speed": 0, "elev_low": 0])
        let finite = ActivitySummary.aggregate([invalid, zero], ids: [1, 2])
        for metric in [ActivitySummaryMetric.distance, .averageSpeed, .elevationLow] {
            #expect(finite[metric] == ActivitySummaryValue(value: 0, knownCount: 1))
        }
        #expect(ActivitySummaryMetric.distance.formatted(nil) == Formatters.unknown)
        #expect(ActivitySummaryMetric.distance.formatted(0) != Formatters.unknown)
    }

    @Test(arguments: ["UTC", "Europe/Zurich", "America/Los_Angeles"])
    func localDaysAreDistinctAndIndependentOfDeviceTimezone(timezone: String) throws {
        let previous = NSTimeZone.default
        NSTimeZone.default = try #require(TimeZone(identifier: timezone))
        defer { NSTimeZone.default = previous }
        let root = try fixtureRoot()
        let models = try fixtureModels(root)
        #expect(ActivitySummary.aggregate(models, ids: [101, 102, 103, 104]).localDayCount == 3)
        #expect(ActivitySummary.aggregate(models, ids: [105, 106]).localDayCount == 1, "Repeated DST wall times occupy one activity-local day")
    }

    @Test func scopeAndCacheTrackMetricsIDsEditsDeletionAndScopeChanges() throws {
        var first = try model(id: 1, values: ["distance": 1000, "elapsed_time": 600])
        let second = try model(id: 2, values: ["distance": 2000, "elapsed_time": 1800, "sport_type": "Ride"])
        let prefs = ActivityListPresentation(defaults: nil)
        let store = ActivityStore(activities: [first, second], listPresentation: prefs)
        #expect(store.activitySummary == nil && store.summaryCache.buildCount == 0)
        prefs.settings.summaryMode = .filtered
        #expect(store.activitySummary?[.distance].value == 3000)
        #expect(store.summaryCache.buildCount == 1)
        store.replaceSelection(with: [1, 2])
        store.inspect(1)
        prefs.settings.sort = .init(field: .name, direction: .ascending)
        prefs.settings.density = .compact
        store.selectedTab = .list
        store.selectedTab = .map
        _ = store.activitySummary
        #expect(store.summaryCache.buildCount == 1, "Selection, detail, sort, density and tabs cannot invalidate a filtered total")
        store.activeSportTypes = [.run]
        #expect(store.activitySummary?.activityCount == 1 && store.activitySummary?[.distance].value == 1000)
        #expect(store.summaryCache.buildCount == 2)
        prefs.settings.summaryMode = .selected
        #expect(store.hiddenSelectedCount == 1)
        #expect(store.activitySummary?.activityCount == 2 && store.activitySummary?[.distance].value == 3000)
        #expect(store.summaryCache.buildCount == 3)
        store.searchText = "No match"
        #expect(store.hiddenSelectedCount == 2 && store.activitySummary?[.distance].value == 3000)
        #expect(store.summaryCache.buildCount == 3, "Filter-hidden selections stay in the selected aggregate")
        first.distance = 1500
        store.activities = [first, second]
        #expect(store.activitySummary?[.distance].value == 3500 && store.summaryCache.buildCount == 4)
        store.activities = [first]
        #expect(store.selectedActivityIDs == [1])
        #expect(store.activitySummary?.activityCount == 1 && store.activitySummary?[.distance].value == 1500)
        store.clearSelection()
        #expect(store.activitySummary?.activityCount == 0 && store.activitySummary?[.distance].value == 0)
        #expect(store.activitySummary?[.averageSpeed].value == nil)
        store.clearScope()
        #expect(store.activitySummary?.activityCount == 0 && prefs.settings.summaryMode == .selected)
        #expect(store.routeGeometry.buildCount == 1, "Only scope clearing updates route geometry; aggregation never traverses routes")
    }

    @Test func aggregationUsesIDsOnceAndNeverInstantiatedOrVisibleCells() throws {
        let activity = try model(id: 1, values: ["distance": 10])
        #expect(ActivitySummary.aggregate([activity, activity], ids: [1, 999]).activityCount == 1)
        #expect(ActivitySummary.aggregate([activity, activity], ids: [1, 999])[.distance].value == 10)
        let models = (1...10_000).map { id in
            var activity = ActivityStoreSelectionTests.activity(id)
            activity.distance = Double(id)
            return activity
        }
        let prefs = ActivityListPresentation(defaults: nil)
        prefs.settings.summaryMode = .filtered
        let store = ActivityStore(activities: models, listPresentation: prefs)
        #expect(store.activitySummary?.activityCount == 10_000)
        #expect(store.activitySummary?[.distance].value == 50_005_000)
        _ = store.listedActivities.prefix(12)
        store.inspect(5000)
        store.dismissInspection()
        _ = store.activitySummary
        #expect(store.summaryCache.buildCount == 1 && store.routeGeometry.buildCount == 0)
    }

    @Test func summaryPreferenceMigratesOldListSettingsAndSurvivesDeviceReload() throws {
        let suite = "ActivitySummaryTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let old: [String: Any] = ["sort": ["field": "name", "direction": "asc"],
            "visibleMetrics": ["photos", "maxPower"], "density": "compact", "width": "scrollingMetrics"]
        defaults.set(try JSONSerialization.data(withJSONObject: old), forKey: ActivityListPresentation.defaultsKey)
        let prefs = ActivityListPresentation(defaults: defaults)
        #expect(prefs.settings.summaryMode == .off)
        #expect(prefs.settings.sort.field == .name && prefs.settings.sort.direction == .ascending)
        #expect(prefs.settings.visibleMetrics == [.photos, .maxPower])
        #expect(prefs.settings.density == .compact && prefs.settings.width == .details)
        prefs.settings.summaryMode = .selected
        #expect(ActivityListPresentation(defaults: defaults).settings == prefs.settings)
        #expect(ActivitySummaryMode.allCases == [.off, .filtered, .selected])
    }

    private func model(id: Int, values: [String: Any]) throws -> Activity {
        var fields = Dictionary(uniqueKeysWithValues: ActivitySummaryMetric.allCases.map { ($0.rawValue, NSNull() as Any) })
        fields["id"] = String(id)
        fields["sport_type"] = "Run"
        fields.merge(values) { _, value in value }
        return try StoredModelMapper.activity(Fixtures.activity(fields))
    }
    private func fixtureRoot() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appending(path: "shared/parity/activity-fixtures.v1.json")
        return try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }
    private func fixtureModels(_ root: [String: Any]) throws -> [Activity] {
        try #require(root["activities"] as? [[String: Any]]).map { projection in
            var fields = Dictionary(uniqueKeysWithValues: ActivitySummaryMetric.allCases.map { ($0.rawValue, NSNull() as Any) })
            fields.merge(projection) { _, value in value }
            return try StoredModelMapper.activity(Fixtures.activity(fields))
        }
    }
}

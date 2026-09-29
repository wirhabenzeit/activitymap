import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct ActivityFilterTests {
    static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "shared/parity/activity-fixtures.v1.json")

    /// Adapt the shared projections into the real cached-activity mapper. The
    /// production ActivityStore predicate supplies all expected ID comparisons.
    @Test(arguments: ["UTC", "Europe/Zurich", "America/Los_Angeles"])
    func sharedFilterCases(deviceTimezone: String) throws {
        let previous = NSTimeZone.default
        NSTimeZone.default = try #require(TimeZone(identifier: deviceTimezone))
        defer { NSTimeZone.default = previous }
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: Self.fixtureURL)) as? [String: Any])
        let projections = try #require(root["activities"] as? [[String: Any]])
        let cases = try #require(root["filterCases"] as? [[String: Any]])
        #expect(cases.count >= 31, "Missing shared filter fixture cases")
        let models = try projections.map { projection in
            var fields = projection
            // Absent fields in a projection are unknown, not DTO defaults.
            for key in ["distance", "elapsed_time", "moving_time", "total_elevation_gain", "commute", "private", "flagged"] {
                fields[key] = projection[key] ?? NSNull()
            }
            return try StoredModelMapper.activity(Fixtures.activity(fields))
        }
        let store = ActivityStore(activities: models)
        for testCase in cases {
            store.resetFilters()
            let filter = try #require(testCase["filter"] as? [String: Any])
            let name = try #require(testCase["name"] as? String)
            store.searchText = filter["search"] as? String ?? ""
            if let sports = filter["sport_types"] as? [String] {
                store.activeSportTypes = Set(try sports.map { try #require(SportType(rawValue: $0)) })
            }
            if let range = filter["date_range"] as? [String: String] {
                let start = try #require(range["start"])
                let end = try #require(range["end"])
                store.dateDayRange = try #require(ActivityDayRange(start: start, end: end))
            }
            let binary = filter["binary"] as? [String: String] ?? [:]
            store.commuteOnly = try binaryValue(binary["commute"])
            store.privateFilter = try binaryValue(binary["private"])
            store.flaggedFilter = try binaryValue(binary["flagged"])
            let values = filter["values"] as? [String: [String: Any]] ?? [:]
            store.distanceFilter = try numeric(values["distance"])
            store.durationFilter = try numeric(values["elapsed_time"])
            store.elevationFilter = try numeric(values["total_elevation_gain"])
            let expected = try #require(testCase["expected_ids"] as? [String])
            #expect(store.filteredActivities.map { String($0.id) } == expected, "\(name) in \(deviceTimezone)")
        }
    }

    @Test func groupsHaveOneCoordinatedSportPredicate() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2, sport: .virtualRun), ActivityStoreSelectionTests.activity(3, sport: .ride)])
        #expect(store.categorySelection(.run) == .all)
        store.toggleCategory(.run)
        #expect(store.categorySelection(.run) == .none)
        #expect(store.filteredActivities.map(\.id) == [3])
        store.toggleSportType(.run)
        #expect(store.categorySelection(.run) == .mixed)
        #expect(store.filteredActivities.map(\.id) == [1, 3], "An individual checked sport is never blocked by a category predicate")
        store.toggleCategory(.run)
        #expect(store.categorySelection(.run) == .all)
        #expect(store.activeSportTypes.contains(.ride), "Group toggles preserve other groups")
        store.isolateCategory(.run)
        #expect(store.activeSportTypes == [.run, .virtualRun])
        store.toggleCategory(.ride)
        #expect(store.activeSportTypes.contains(.ride) && store.activeSportTypes.contains(.run))
        store.showAllCategories()
        #expect(store.activeFilterCount == 0)
    }

    @Test func everyFilterClosesHiddenFocusWithoutLosingSelection() throws {
        var first = ActivityStoreSelectionTests.activity(1)
        first.name = "CAFÉ Run"
        first.isPrivate = true
        first.flagged = true
        var other = ActivityStoreSelectionTests.activity(2)
        other.name = "Other"
        other.isPrivate = false
        other.flagged = false
        let mutations: [(ActivityStore) -> Void] = [
            { $0.searchText = "other" },
            { $0.privateFilter = false },
            { $0.flaggedFilter = false },
            { $0.activeSportTypes = [] },
            { $0.distanceFilter = NumericFilter(operatorType: .lte, value: 0) },
            { $0.durationFilter = NumericFilter(operatorType: .lte, value: 0) },
            { $0.elevationFilter = NumericFilter(operatorType: .lte, value: 0) },
            { $0.commuteOnly = true },
            { $0.dateDayRange = ActivityDayRange(start: "2000-01-01", end: "2000-01-01") },
        ]
        for mutate in mutations {
            let store = ActivityStore(activities: [first, other])
            store.replaceSelection(with: [1, 2])
            store.activate(1)
            store.inspect(1)
            mutate(store)
            #expect(store.selectedActivityIDs == [1, 2])
            #expect(store.activeActivityID == nil && store.inspectedActivityID == nil)
            store.resetFilters()
            #expect(store.activeFilterCount == 0 && store.filteredActivities.count == 2)
            #expect(store.activeActivityID == nil && store.inspectedActivityID == nil)
        }
    }

    @Test func numericInputIsStrictLocalizedAndConvertedOnce() throws {
        for input in ["oops", "12 km", "1,000", "1.2.3", "NaN", "inf", "1e3", "-1", ".", "1 2"] {
            if case .invalid = NumericFilterInput.parse(input, scale: 1000, locale: Locale(identifier: "en_US")) { }
            else { Issue.record("Invalid input accepted: \(input)") }
        }
        if case .empty = NumericFilterInput.parse("  ", scale: 1000) { }
        else { Issue.record("Whitespace must clear a filter") }
        for (input, scale, locale, expected) in [
            ("1.25", 1000.0, "en_US", 1250.0), ("1,25", 1000.0, "de_DE", 1250.0),
            ("1.5", 3600.0, "en_US", 5400.0), ("0", 1.0, "en_US", 0.0),
        ] {
            if case .valid(let value) = NumericFilterInput.parse(input, scale: scale, locale: Locale(identifier: locale)) {
                #expect(value == expected)
            } else { Issue.record("Valid decimal rejected: \(input)") }
        }
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)])
        store.distanceFilter = NumericFilter(value: .infinity)
        #expect(store.filteredActivities.isEmpty)
        var invalidMetric = ActivityStoreSelectionTests.activity(2)
        invalidMetric.distance = .nan
        store.activities.append(invalidMetric)
        store.distanceFilter = NumericFilter(value: 0)
        #expect(store.filteredActivities.map(\.id) == [1])
    }

    @Test(arguments: ["ar_EG", "fa_IR"])
    func localizedDecimalDigitsRoundtrip(localeIdentifier: String) {
        let locale = Locale(identifier: localeIdentifier)
        let displayed = 1.25.formatted(.number.locale(locale).grouping(.never).precision(.fractionLength(0...12)))
        if case .valid(let value) = NumericFilterInput.parse(displayed, scale: 1000, locale: locale) {
            #expect(value == 1250, "Applied thresholds must stay editable in \(localeIdentifier)")
        } else { Issue.record("Localized decimal rejected: \(displayed)") }
        let zero = 0.formatted(.number.locale(locale).grouping(.never))
        if case .valid(let value) = NumericFilterInput.parse(zero, scale: 3600, locale: locale) {
            #expect(value == 0)
        } else { Issue.record("Localized measured zero rejected: \(zero)") }
        for invalid in ["١٬٢٥", "۱٬۲۵", "−١", "-۱", "١٫٢٫٥", "۱٫۲٫۵", "Ⅷ", "²", "½"] {
            if case .invalid = NumericFilterInput.parse(invalid, scale: 1000, locale: locale) { }
            else { Issue.record("Nondecimal or malformed number accepted: \(invalid)") }
        }
    }

    @Test func dayKeysRejectInvalidOrInvertedDates() {
        #expect(ActivityDayRange(start: "2026-03-30", end: "2026-03-29") == nil)
        #expect(ActivityDayRange(start: "2026-02-29", end: "2026-03-01") == nil)
        #expect(ActivityDayRange(start: "2026-13-01", end: "2027-01-01") == nil)
        #expect(ActivityDayRange(start: "2026-3-1", end: "2026-03-02") == nil)
        #expect(ActivityDayRange(start: "2024-02-29", end: "2024-02-29") != nil)
    }

    @Test func pickerBoundsAreCapturedBeforeTimezoneChanges() throws {
        let previous = NSTimeZone.default
        defer { NSTimeZone.default = previous }
        NSTimeZone.default = try #require(TimeZone(identifier: "Pacific/Auckland"))
        let calendar = ActivityDayRange.calendar(timeZone: .current)
        let chosen = try #require(calendar.date(from: DateComponents(year: 2026, month: 3, day: 29)))
        let store = ActivityStore()
        store.dateRange = chosen...chosen
        NSTimeZone.default = try #require(TimeZone(identifier: "America/Los_Angeles"))
        #expect(store.dateDayRange == ActivityDayRange(start: "2026-03-29", end: "2026-03-29"))
    }

    @Test func presetsUseFullCalendarPeriodsAndLeapDayClamp() throws {
        let timezone = try #require(TimeZone(identifier: "Europe/Zurich"))
        let calendar = ActivityDayRange.calendar(timeZone: timezone)
        let leapDay = try #require(calendar.date(from: DateComponents(year: 2024, month: 2, day: 29, hour: 12)))
        #expect(ActivityDatePreset.thisYear.range(now: leapDay, timeZone: timezone) == ActivityDayRange(start: "2024-01-01", end: "2024-12-31"))
        #expect(ActivityDatePreset.lastYear.range(now: leapDay, timeZone: timezone) == ActivityDayRange(start: "2023-01-01", end: "2023-12-31"))
        #expect(ActivityDatePreset.thisMonth.range(now: leapDay, timeZone: timezone) == ActivityDayRange(start: "2024-02-01", end: "2024-02-29"))
        #expect(ActivityDatePreset.lastMonth.range(now: leapDay, timeZone: timezone) == ActivityDayRange(start: "2024-01-01", end: "2024-01-31"))
        #expect(ActivityDatePreset.lastTwelveMonths.range(now: leapDay, timeZone: timezone) == ActivityDayRange(start: "2023-02-28", end: "2024-02-29"))
        let january = try #require(calendar.date(from: DateComponents(year: 2026, month: 1, day: 1)))
        #expect(ActivityDatePreset.lastMonth.range(now: january, timeZone: timezone) == ActivityDayRange(start: "2025-12-01", end: "2025-12-31"))
        #expect(ActivityDatePreset.thisYear.range(now: january, timeZone: timezone) != ActivityDatePreset.thisYear.range(now: leapDay, timeZone: timezone))
    }

    @Test func filtersUseCachedActivitiesWithoutNetworking() async throws {
        let cache = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try Fixtures.activity(["id": "1", "name": "Cached café ride", "sport_type": "Ride", "private": false])
        try await cache.apply([.upsertActivity(dto)], checkpoint: Fixtures.checkpoint, scope: Fixtures.scope)
        let store = ActivityStore()
        try await store.load(from: cache, scope: Fixtures.scope)
        store.searchText = "café"
        store.activeSportTypes = [.ride]
        store.privateFilter = false
        store.distanceFilter = NumericFilter(operatorType: .gte, value: 1000)
        #expect(store.filteredActivities.map(\.id) == [1])
        // ActivityStore/filter views have no stream or transport dependency.
        #expect(try await cache.snapshot(scope: Fixtures.scope).activities == [dto])
    }

    @Test func resetRestoresAllRestrictionsAndCounts() {
        let store = ActivityStore()
        store.searchText = "ride"
        store.activeSportTypes = []
        store.dateDayRange = ActivityDayRange(start: "2026-01-01", end: "2026-12-31")
        store.distanceFilter = NumericFilter(value: 0)
        store.durationFilter = NumericFilter(value: 0)
        store.elevationFilter = NumericFilter(value: 0)
        store.commuteOnly = true
        store.privateFilter = false
        store.flaggedFilter = true
        #expect(store.activeFilterCount == 9)
        store.resetFilters()
        #expect(store.activeFilterCount == 0 && store.activeSportTypes == Set(SportType.allCases))
        store.searchText = "   "
        #expect(store.activeFilterCount == 0)
    }

    private func binaryValue(_ raw: String?) throws -> Bool? {
        guard let raw else { return nil }
        switch raw {
        case "any": return nil
        case "yes": return true
        case "no": return false
        default: throw FilterFixtureError.unsupportedBinary(raw)
        }
    }
    private func numeric(_ raw: [String: Any]?) throws -> NumericFilter? {
        guard let raw else { return nil }
        let rawOperator = try #require(raw["operator"] as? String)
        let comparison = try #require(FilterOperator(rawValue: rawOperator))
        let value = try #require(raw["value"] as? Double)
        return NumericFilter(operatorType: comparison, value: value)
    }
    enum FilterFixtureError: Error { case unsupportedBinary(String) }
}

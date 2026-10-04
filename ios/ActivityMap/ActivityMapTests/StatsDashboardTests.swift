import Foundation
import Testing
@testable import ActivityMap

@MainActor struct StatsDashboardTests {
    static func fixture(_ index: Int = 1) throws -> (ActivityStore, [String: Any]) {
        let json = try StatsFixtureTests.json("stats-parity-fixtures.v1.json")
        let fixture = (json["fixtures"] as! [[String: Any]])[index]
        let store = ActivityStore(activities: try StatsFixtureTests.source(fixture["activities"] as! [[String: Any]]),
                                  listPresentation: ActivityListPresentation(defaults: nil))
        store.stats.refreshToday(now: StatsDates.date(StatsDates.day(fixture["today"] as! String)), timeZone: .gmt)
        store.selectedTab = .stats
        return (store, fixture)
    }
    static func load(_ state: StatsDashboardState, _ store: ActivityStore) async {
        await state.load(store: store, request: .init(source: StatsDashboardSource(store), choices: state.choices, canLoad: true))
    }

    @Test func recordsAndCalendarKeepPeriodsAndActivityIdentities() throws {
        func row(_ id: Int, _ date: String, _ distance: Double) -> StatsActivity {
            .init(id: id, name: "Activity \(id)", sport: .ride, start: StatsDates.date(StatsDates.day(date)), distance: distance * 1000, movingTime: 3600, elevation: 100)
        }
        let today = StatsDates.day("2026-01-15")
        let engine = StatsEngine(activities: [row(1, "2024-02-29", 100), row(2, "2026-01-02", 10), row(3, "2027-01-01", 1000)])
        guard case .records(let current, let allTime, let best) = engine.dashboard(.records, option: nil, today: today) else { Issue.record("Missing records"); return }
        #expect(current.activities[.distance]?.activityID == 2)
        #expect(allTime.activities[.distance]?.activityID == 1)
        #expect(best[.distance]?.hasCompleteWindow == false)
        guard case .calendar(let rolling, let years) = engine.dashboard(.activityCalendar, option: .sport, today: today) else { Issue.record("Missing calendar"); return }
        #expect(Set(years.keys) == Set([2024, 2025, 2026]))
        #expect(rolling.months.first?.first == StatsDates.day("2025-01-15"))
        #expect(rolling.months.last?.last == today)
        #expect(years[2024]?.days[StatsDates.day("2024-02-29")]?.activities.first?.id == 1)
        #expect(years[2024]?.months.first { StatsDates.parts($0.start).month == 2 }?.length == 29)
        #expect(years[2025]?.days.isEmpty == true)
        #expect(years[2025]?.months.count == 12)
        #expect(years[2026]?.months.last?.last == today)
        let empty = StatsEngine(activities: [])
        guard case .calendar(let emptyRolling, let emptyYears) = empty.dashboard(.activityCalendar, option: .sport, today: today) else { Issue.record("Missing empty calendar"); return }
        #expect(emptyRolling.days.isEmpty && emptyYears.keys.sorted() == [2026])
    }

    @Test func historicalComparisonBandsRespectPercentilesCoverageAndCalendarDays() throws {
        func row(_ date: String, _ km: Double) -> StatsActivity {
            .init(id: nil, name: "Band fixture", sport: .run, start: StatsDates.date(StatsDates.day(date)), distance: km * 1000, movingTime: km * 3600, elevation: km)
        }
        var rows: [StatsActivity] = []
        for i in 0..<20 {
            let year = 2024 + i / 12
            let month = i % 12 + 1
            let date = String(format: "%04d-%02d-01", year, month)
            rows.append(row(date, Double(i * 10)))
        }
        rows.append(row("2025-09-01", 100000))
        let band = try #require(StatsEngine(activities: rows).comparisonBand(today: StatsDates.day("2025-09-15"), metric: .distance, monthly: true))
        let first = try #require(band.points.first { $0.x == 1 })
        #expect(band.count == 20 && first.low == 9.5 && first.high == 180.5)
        let sparse = StatsEngine(activities: [row("2024-01-01", 10), row("2024-03-01", 30)])
        let monthly = try #require(sparse.comparisonBand(today: StatsDates.day("2024-04-15"), metric: .distance, monthly: true))
        let day1 = try #require(monthly.points.first { $0.x == 1 }), day31 = try #require(monthly.points.first { $0.x == 31 })
        #expect(day1.count == 3 && day1.low == 1 && day1.high == 28)
        #expect(day31.count == 3 && day31.low == 1 && day31.high == 28)
        for year in [2023, 2024] {
            let shortMonth = StatsEngine(activities: [row("\(year)-01-01", 10), row("\(year)-02-28", 100), row("\(year)-03-30", 20)])
            let filled = try #require(shortMonth.comparisonBand(today: StatsDates.day("\(year)-04-15"), metric: .distance, monthly: true))
            let last = try #require(filled.points.last)
            #expect(last.x == 31 && last.count == 3 && last.low == 11 && last.high == 92)
            for (previous, point) in zip(filled.points, filled.points.dropFirst()) {
                #expect(point.count == 3 && point.low >= previous.low && point.high >= previous.high)
            }
        }
        let partial = StatsEngine(activities: [row("2024-01-15", 10), row("2024-03-01", 30)])
        #expect(partial.comparisonBand(today: StatsDates.day("2024-04-15"), metric: .distance, monthly: true)?.first == StatsDates.day("2024-02-01"))
        let years = StatsEngine(activities: [row("2023-01-01", 10), row("2023-02-28", 5), row("2023-03-01", 100), row("2024-01-01", 20), row("2025-01-01", 100000)])
        let yearly = try #require(years.comparisonBand(today: StatsDates.day("2025-06-01"), metric: .distance, monthly: false))
        #expect(yearly.count == 2 && yearly.points[0].low == 10 && yearly.points[0].high == 20)
        #expect(yearly.points[59].low == 15 && yearly.points[59].high == 20)
        #expect(yearly.points[60].low == 20 && yearly.points[60].high == 115)
        for point in years.cumulativeYearPoints(metric: .distance, year: 2024, last: StatsDates.start(year: 2025) - 1) {
            let range = yearly.points[point.x]
            #expect(point.y >= range.low && point.y <= range.high)
        }
        #expect(years.comparisonBand(today: StatsDates.day("2024-06-01"), metric: .distance, monthly: false) == nil)
    }

    @Test func hillinessDashboardIncludesOnlyQualifyingActivityLinks() throws {
        func row(_ id: Int, _ day: String, _ km: Double, _ elevation: Double) -> StatsActivity {
            .init(id: id, name: "Hill \(id)", sport: .trailHike, start: StatsDates.date(StatsDates.day(day)), distance: km * 1000, movingTime: 3600, elevation: elevation)
        }
        let engine = StatsEngine(activities: [row(11, "2026-08-01", 5, 1000), row(12, "2026-08-02", 4.999, 5000), row(13, "2025-08-01", 5, 5000), row(14, "2026-09-02", 5, 5000)])
        guard case .hilliness(_, let activities) = engine.dashboard(.distanceVsElevation, option: nil, today: StatsDates.day("2026-09-01")) else { Issue.record("Missing hilliness"); return }
        #expect(activities.map(\.activity.id) == [11])
        #expect(activities.first?.metersPerKm == 200)
    }

    @Test func projectionDailyRateKeepsSmallNonzeroValues() {
        #expect(StatsDisplay.dailyRate(0.9) == "0.9")
        #expect(StatsDisplay.dailyRate(0.04) == "0.04")
        #expect(StatsDisplay.dailyRate(36.34) == "36.3")
    }

    @Test func capabilityMatrixControlsVisibilityDefaultsAndExpansion() throws {
        let matrix = try StatsFixtureTests.json("stats-capabilities.v1.json")["tiles"] as! [[String: Any]]
        let visible = matrix.filter { $0["visibility"] as? String == "visible" }
        #expect(!StatsDashboard.ids.contains(.consistency))
        #expect(StatsDashboard.ids.contains(.typicalWeek))
        #expect(StatsDashboard.ids.map(\.rawValue) == visible.map { $0["id"] as! String })
        for tile in StatsDashboard.tiles {
            let row = try #require(visible.first { $0["id"] as? String == tile.id.rawValue })
            #expect(tile.toggle?.options.map(\.rawValue) ?? [] == row["options"] as! [String])
            #expect(StatsDashboard.defaultOption(tile.id)?.rawValue == row["defaultOption"] as? String)
            #expect(StatsDashboard.expandable(tile.id) == row["expandable"] as! Bool)
        }
    }

    @Test func dashboardComparisonsUseSharedExpectedFixtures() async throws {
        for index in 0..<4 {
            let (store, fixture) = try Self.fixture(index)
            for row in fixture["cases"] as! [[String: Any]] {
                let operation = row["operation"] as! String
                let tile: StatsTileID
                switch operation {
                case "monthVsLastMonth": tile = .monthVsLastMonth
                case "yearToDate": tile = .yearToDate
                case "fourWeekVolume": tile = .weeklyVolume
                default: continue
                }
                let args = row["args"] as! [String: Any]
                store.stats.refreshToday(now: StatsDates.date(StatsDates.day(args["today"] as? String ?? fixture["today"] as! String)), timeZone: .gmt)
                store.resetFilters()
                if let filter = args["filter"] as? [String: Any] { StatsFixtureTests.apply(filter, to: store) }
                let option = StatsToggleOption(rawValue: args["metric"] as? String ?? "distance")
                guard case .dashboard(let result) = await store.stats.result(.dashboard(tile, option), for: store) else {
                    Issue.record("Missing dashboard query"); continue
                }
                let comparison: StatsPeriodComparison
                switch result {
                case .comparison(let value, _, _, _), .volume(let value, _, _, _, _): comparison = value
                default: Issue.record("Wrong tile payload"); continue
                }
                StatsFixtureTests.equal(StatsFixtureTests.comparison(comparison), row["expected"]!, label: row["id"] as! String)
            }
        }
    }

    @Test func tileChoicesRetentionScopeResetAndBoundedProductionDemand() async throws {
        let (store, _) = try Self.fixture(), state = StatsDashboardState()
        await Self.load(state, store)
        #expect(state.completedTiles.count == StatsDashboard.tiles.count)
        #expect(store.stats.aggregationCount == 1 && store.stats.calculationCount == StatsDashboard.tiles.count)
        let calendar = try #require(StatsDashboard.tiles.first { $0.id == .activityCalendar })
        state.select(.elevation, for: calendar)
        state.toggleExpansion(.activityCalendar)
        await Self.load(state, store)
        #expect(store.stats.calculationCount == StatsDashboard.tiles.count + 1)
        let count = store.stats.calculationCount
        store.dateDayRange = ActivityDayRange(start: "2000-01-01", end: "2000-12-31")
        store.replaceSelection(with: [store.activities[0].id])
        store.selectedTab = .map; store.selectedTab = .list; store.selectedTab = .stats
        await Self.load(state, store)
        #expect(store.stats.calculationCount == count && store.filteredActivities.isEmpty)
        #expect(state.option(.activityCalendar) == .elevation && state.expandedTile == .activityCalendar)
        let selection = store.selectedActivityIDs, dates = store.dateDayRange
        store.searchText = "no matching name"
        #expect(state.result(.yearToDate, source: StatsDashboardSource(store)) == nil)
        #expect(StatsPresentation(store: store, preparing: false).state == .noMatches)
        FilterScope.stats.reset(store)
        #expect(store.dateDayRange == dates && store.selectedActivityIDs == selection)
        await Self.load(state, store)
        #expect(state.option(.activityCalendar) == .elevation)
        #expect(store.stats.retainedResultCount <= 16)
        #expect(store.activities.allSatisfy { $0.coordinates.isEmpty && $0.streams == nil })
        store.clearScope()
        #expect(state.result(.yearToDate, source: StatsDashboardSource(store)) == nil)
    }

    @Test func everyDeclaredOptionHasAProductionPayloadAndCorrectWindow() async throws {
        let (store, _) = try Self.fixture(), state = StatsDashboardState()
        for tile in StatsDashboard.tiles {
            for option in tile.toggle?.options ?? [] {
                state.select(option, for: tile)
                await Self.load(state, store)
                let result = try #require(state.result(tile.id, source: StatsDashboardSource(store)))
                switch result {
                case .unsupported: Issue.record("Unsupported visible tile \(tile.id)")
                case .volume(_, let starts, let values, let averages, let buckets):
                    #expect(starts.count == 12 && values.count == 12 && averages.count == 3)
                    #expect(buckets[.weeks]?.map(\.total) == values)
                    #expect(buckets.values.flatMap { $0 }.allSatisfy { abs($0.bySport.values.reduce(0, +) - $0.total) < 0.000001 })
                    #expect(buckets[.months]?.count == 12)
                    #expect(buckets[.years]?.last?.end == store.stats.reportingDay)
                    #expect((averages[.weeks] ?? []).allSatisfy { $0.x <= StatsDates.monday(store.stats.reportingDay) })
                case .week(let week):
                    #expect(week.days.count == 7 && week.days.suffix(5).allSatisfy { $0 == nil })
                default: break
                }
            }
        }
        state.toggleExpansion(.thisWeek)
        #expect(state.expandedTile == nil)
    }

    @Test func volumeGroupingsCoverRecentPeriodsAndAllAvailableYears() async throws {
        let dates = ["2024-02-29", "2025-02-01", "2025-12-31", "2026-01-01", "2026-03-03", "2025-07-01"]
        let activities = try StatsFixtureTests.source(dates.enumerated().map { index, date in
            ["sportType": "Run", "startDateLocal": "\(date)T12:00:00", "distance": Double(index + 1) * 10_000]
        })
        let store = ActivityStore(activities: activities)
        let today = StatsDates.day("2026-03-03")
        store.stats.refreshToday(now: StatsDates.date(today), timeZone: .gmt)
        guard case .dashboard(.volume(_, _, _, _, let history)) = await store.stats.result(.dashboard(.weeklyVolume, .distance), for: store) else {
            Issue.record("Missing grouped volume"); return
        }
        let weeks = try #require(history[.weeks]), months = try #require(history[.months]), years = try #require(history[.years])
        #expect(weeks.count == 12 && weeks.first?.start == StatsDates.day("2025-12-15"))
        #expect(months.count == 12 && months.first?.start == StatsDates.day("2025-04-01"))
        #expect(years.map { StatsDates.parts($0.start).year! } == [2024, 2025, 2026])
        #expect(weeks.reduce(0) { $0 + $1.total } == 120)
        #expect(months.reduce(0) { $0 + $1.total } == 180)
        #expect(years.map(\.total) == [10, 110, 90])
        #expect(history.values.allSatisfy { $0.last?.end == today })
    }

    @Test func movingAveragesIncludeOffscreenHistoryAndExcludePartialPeriods() async throws {
        let examples: [(StatsHistoryRange, [String], String, Double)] = [
            (.weeks, ["2026-06-15", "2026-06-22", "2026-06-29", "2026-07-06", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"], "2026-07-06", 6.5),
            (.months, ["2025-07-01", "2025-08-01", "2025-09-01", "2025-10-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"], "2025-10-01", 6.5),
            (.years, ["2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01", "2023-01-01", "2024-01-01", "2025-01-01", "2026-01-01"], "2022-01-01", 5.5)
        ]
        for (range, dates, first, last) in examples {
            let rows = try StatsFixtureTests.source(dates.enumerated().map { index, date in
                ["sportType": "Ride", "startDateLocal": "\(date)T12:00:00", "movingTime": Double(index == dates.count - 1 ? 100 : index + 1) * 3600]
            })
            let store = ActivityStore(activities: rows)
            store.stats.refreshToday(now: StatsDates.date(StatsDates.day("2026-09-27")), timeZone: .gmt)
            guard case .dashboard(.volume(_, _, _, let averages, _)) = await store.stats.result(.dashboard(.weeklyVolume, .time), for: store) else {
                Issue.record("Missing averages"); continue
            }
            let trend = try #require(averages[range])
            #expect(trend.first?.x == StatsDates.day(first))
            #expect(trend.first?.y == 2.5)
            #expect(trend.last?.y == last)
        }
    }

    @Test func obsoleteDashboardTaskCannotPublishAfterScopeChange() async throws {
        let gate = GatedStatsBuild()
        let controller = StatsController(build: { await gate.build($0) })
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1)], stats: controller)
        let state = StatsDashboardState()
        let request = StatsDashboardRequest(source: StatsDashboardSource(store), choices: [:], canLoad: true)
        let work = Task { await state.load(store: store, request: request) }
        await gate.wait()
        store.clearScope()
        await gate.release()
        await work.value
        #expect(state.completedTiles.isEmpty)
        #expect(state.result(.thisWeek, source: StatsDashboardSource(store)) == nil)
    }

    @Test func metricChangesKeepValuesPairedWithTheirOriginalUnitsUntilReady() async throws {
        let (store, _) = try Self.fixture(), state = StatsDashboardState()
        await Self.load(state, store)
        let tile = try #require(StatsDashboard.tiles.first { $0.id == .weeklyVolume })
        let source = StatsDashboardSource(store)
        state.select(.elevation, for: tile)
        #expect(state.result(tile.id, source: source) == nil)
        #expect(state.face(tile.id, source: source)?.option == .distance)
        // A second tap before calculation finishes must never relabel the old values.
        state.select(.time, for: tile)
        #expect(state.face(tile.id, source: source)?.option == .distance)
        await Self.load(state, store)
        #expect(state.face(tile.id, source: source)?.option == .time)
        #expect(state.result(tile.id, source: source) != nil)
        #expect(store.stats.aggregationCount == 1 && store.stats.calculationCount == StatsDashboard.tiles.count + 1)
        store.searchText = "Ride"
        #expect(state.face(tile.id, source: StatsDashboardSource(store)) == nil)
        store.searchText = ""
        store.clearScope()
        #expect(state.face(tile.id, source: StatsDashboardSource(store)) == nil)
    }

    @Test func noHistoryIsDifferentFromPreparingAndNoMatches() throws {
        let empty = ActivityStore()
        #expect(StatsPresentation(store: empty, preparing: true).state == .loading)
        #expect(StatsPresentation(store: empty, preparing: false).state == .noHistory)
        let (store, _) = try Self.fixture()
        store.activeSportTypes = []
        #expect(StatsPresentation(store: store, preparing: false).state == .noMatches)
        #expect(!StatsPresentation(store: store, preparing: false).hasContent)
    }
}

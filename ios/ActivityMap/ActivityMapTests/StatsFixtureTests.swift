import CoreFoundation
import Foundation
import Testing
@testable import ActivityMap

@MainActor struct StatsFixtureTests {
    static let shared = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appending(path: "shared")
    static func json(_ path: String) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: Data(contentsOf: shared.appending(path: path))) as? [String: Any])
    }
    static func source(_ rows: [[String: Any]]) throws -> [Activity] {
        try rows.enumerated().map { index, row in
            var activity = ActivityStoreSelectionTests.activity(row["id"] as? Int ?? index + 1,
                sport: try #require(SportType(rawValue: row["sportType"] as? String ?? "")), route: false)
            activity.name = row["name"] as? String ?? ""
            activity.startDateLocal = try #require(ISO8601DateFormatter().date(from: "\(row["startDateLocal"] as? String ?? "")Z"))
            activity.startDate = activity.startDateLocal
            activity.distance = row["distance"] as? Double
            activity.movingTime = (row["movingTime"] as? Double).map(Int.init)
            activity.elapsedTime = (row["elapsedTime"] as? Double).map(Int.init)
            activity.totalElevationGain = row["elevationGain"] as? Double
            activity.commute = row["commute"] == nil ? false : row["commute"] as? Bool
            activity.isPrivate = row["private"] == nil ? false : row["private"] as? Bool
            activity.flagged = row["flagged"] == nil ? false : row["flagged"] as? Bool
            return activity
        }
    }
    static func apply(_ filter: [String: Any], to store: ActivityStore) {
        if let sports = filter["sportTypes"] as? [String] { store.activeSportTypes = Set(sports.compactMap(SportType.init(rawValue:))) }
        store.searchText = filter["search"] as? String ?? ""
        if let range = filter["dateRange"] as? [String: String] { store.dateDayRange = ActivityDayRange(start: range["start"]!, end: range["end"]!) }
        for (key, row) in filter["numeric"] as? [String: [String: Any]] ?? [:] {
            let value = NumericFilter(operatorType: FilterOperator(rawValue: row["operator"] as? String ?? "") ?? .gte, value: row["value"] as? Double ?? 0)
            switch key { case "distance": store.distanceFilter = value; case "total_elevation_gain": store.elevationFilter = value; case "elapsed_time": store.durationFilter = value; default: Issue.record("Unknown numeric fixture predicate \(key)") }
        }
        for (key, value) in filter["binary"] as? [String: String] ?? [:] {
            let predicate: Bool? = value == "yes" ? true : (value == "no" ? false : nil)
            switch key { case "commute": store.commuteOnly = predicate; case "private": store.privateFilter = predicate; case "flagged": store.flaggedFilter = predicate; default: Issue.record("Unknown binary fixture predicate \(key)") }
        }
    }
    static func totals(_ totals: StatsTotals) -> [String: Any] {
        Dictionary(uniqueKeysWithValues: StatsMetric.allCases.map { ($0.rawValue, totals[$0]) })
    }
    static func comparison(_ value: StatsPeriodComparison) -> [String: Any] { ["current": value.current, "previous": value.previous] }
    static func records(_ value: StatsRecords, identities: Bool = true) -> [String: Any] {
        var output: [String: Any] = [:]
        for (metric, record) in value.activities {
            var row: [String: Any] = ["value": record.value, "day": StatsDates.key(record.day)]
            if identities, let id = record.activityID { row["activityId"] = id }
            output[metric.rawValue] = row
        }
        if let week = value.biggestWeek { output["biggestWeek"] = ["value": week.value, "weekStart": StatsDates.key(week.weekStart)] }
        return output
    }
    static func run(_ operation: String, engine: StatsEngine, today: Int, args: [String: Any]) throws -> Any {
        let metric = StatsMetric(rawValue: args["metric"] as? String ?? "distance")!, range = StatsWindow(rawValue: args["range"] as? String ?? "currentYear") ?? .currentYear
        let first = StatsDates.day(args["first"] as? String ?? StatsDates.key(today)), last = StatsDates.day(args["last"] as? String ?? StatsDates.key(today))
        switch operation {
        case "totals": return totals(engine.totals(today: today))
        case "yearToDate": return comparison(engine.yearToDate(today: today, metric: metric))
        case "monthVsLastMonth": return comparison(engine.monthComparison(today: today, metric: metric))
        case "thisWeek":
            let v = engine.thisWeek(today: today, metric: metric)
            return ["days": v.days.map { $0.map { $0 as Any } ?? NSNull() }, "current": v.current, "typical": v.typical] as [String: Any]
        case "typicalWeek":
            let v = engine.typicalWeek(today: today); var result = totals(v.totals); result["activeDays"] = v.activeDays; return result
        case "yearPace":
            let v = engine.yearPace(today: today, metric: metric)
            return ["current": v.current, "perDay": v.perDay, "projected": v.projected, "lastYear": v.lastYear]
        case "sportMix": return engine.sportMix(today: today, range: range).map { ["sport": $0.sport.rawValue, "share": $0.share] as [String: Any] }
        case "consistency":
            let v = engine.consistency(today: today, weeks: args["weeks"] as? Int ?? 12)
            return ["activeDaysPerWeek": v.activeDaysPerWeek, "currentStreak": v.currentStreak, "solidWeeks": v.solidWeeks] as [String: Any]
        case "restDays": let v = engine.restDays(today: today); return ["last30": v.last30, "last90": v.last90]
        case "best30Days":
            let v = engine.best30Days(today: today, metric: metric)
            return ["total": v.total, "start": StatsDates.key(v.start), "end": StatsDates.key(v.end), "current": v.current] as [String: Any]
        case "records": return records(engine.records(today: today, range: range))
        case "activityCalendar":
            let v = engine.activityCalendar(today: today)
            return ["activeDays": v.count, "dominantSport": Dictionary(uniqueKeysWithValues: v.map { (StatsDates.key($0.key), $0.value.dominantSport.rawValue) })] as [String: Any]
        case "weeklyActiveDays": return engine.weeklyActiveDays(today: today, weeks: args["weeks"] as? Int ?? 12).map { ["start": StatsDates.key($0.start), "activeDays": $0.activeDays, "partial": $0.partial] as [String: Any] }
        case "dailyTotals": return Dictionary(uniqueKeysWithValues: engine.calendarDays(first: first, last: last).map { (StatsDates.key($0.key), totals($0.value.totals)) })
        case "calendarDays":
            let v = engine.calendarDays(first: first, last: last)
            return ["days": Dictionary(uniqueKeysWithValues: v.map { (StatsDates.key($0.key), $0.value.activities.map { $0.id! }) }),
                    "dominantSport": Dictionary(uniqueKeysWithValues: v.map { (StatsDates.key($0.key), $0.value.dominantSport.rawValue) }),
                    "mixedDays": v.filter { $0.value.mixed }.keys.sorted().map(StatsDates.key)] as [String: Any]
        case "calendarMonths": return engine.calendarMonths(today: today, first: first).map { ["start": StatsDates.key($0.start), "length": $0.length, "first": StatsDates.key($0.first), "last": StatsDates.key($0.last)] as [String: Any] }
        case "cumulativeByDay": return engine.cumulativeByDay(metric: metric, first: first, last: last)
        case "cumulativeYearPoints": return engine.cumulativeYearPoints(metric: metric, year: args["year"] as! Int, last: last).map { ["x": $0.x, "y": $0.y] as [String: Any] }
        case "volumeHistory": return engine.volumeHistory(today: today, metric: metric, range: StatsHistoryRange(rawValue: args["range"] as? String ?? "weeks") ?? .weeks, page: args["page"] as? Int ?? 0).map {
            ["start": StatsDates.key($0.start), "end": StatsDates.key($0.end), "total": $0.total, "bySport": Dictionary(uniqueKeysWithValues: $0.bySport.map { ($0.key.rawValue, $0.value) })] as [String: Any]
        }
        case "filterActivities": return engine.activities.map { $0.id! }
        case "localToday": return StatsDates.key(StatsDates.localToday(now: try #require(ISO8601DateFormatter().date(from: args["now"] as! String)), timeZone: try #require(TimeZone(identifier: args["timeZone"] as! String))))
        default: throw NSError(domain: "Unimplemented fixture operation \(operation)", code: 1)
        }
    }
    static func equal(_ actual: Any, _ expected: Any, label: String, exactKeys: Bool = true) {
        if let expected = expected as? [String: Any] {
            guard let actual = actual as? [String: Any] else { Issue.record("\(label) is not object: \(actual)"); return }
            if exactKeys { #expect(Set(actual.keys) == Set(expected.keys), "\(label) keys") }
            for (key, value) in expected { guard let actual = actual[key] else { Issue.record("Missing \(label).\(key)"); continue }; equal(actual, value, label: "\(label).\(key)", exactKeys: exactKeys) }
        } else if let expected = expected as? [Any] {
            guard let actual = actual as? [Any] else { Issue.record("\(label) is not array"); return }
            #expect(actual.count == expected.count, "\(label) length")
            for index in 0..<min(actual.count, expected.count) { equal(actual[index], expected[index], label: "\(label)[\(index)]", exactKeys: exactKeys) }
        } else if expected is NSNull { #expect(actual is NSNull, "\(label) null") }
        else if let expected = expected as? NSNumber {
            guard let actual = actual as? NSNumber else { Issue.record("\(label) is not number"); return }
            if CFGetTypeID(expected) == CFBooleanGetTypeID() { #expect(CFGetTypeID(actual) == CFBooleanGetTypeID() && actual.boolValue == expected.boolValue, "\(label) bool") }
            else if label.hasSuffix(".activityId") || label.contains(".days.") && label.hasSuffix("]") { #expect(actual == expected, "\(label) identity") }
            else { #expect(abs(actual.doubleValue - expected.doubleValue) <= 0.000001, "\(label): expected \(expected), actual \(actual)") }
        } else { #expect(actual as? String == expected as? String, "\(label)") }
    }
    @Test func all54ParityVectorsUseProductionFilteringAndCalculations() async throws {
        let corpus = try Self.json("stats-parity-fixtures.v1.json"), fixtures = try #require(corpus["fixtures"] as? [[String: Any]])
        var count = 0
        for fixture in fixtures {
            for vector in fixture["cases"] as! [[String: Any]] {
                let store = ActivityStore(activities: try Self.source(fixture["activities"] as! [[String: Any]]))
                let args = vector["args"] as! [String: Any]
                Self.apply(args["filter"] as? [String: Any] ?? [:], to: store)
                let scope = StatsFilterScope(store), dates = store.dateDayRange
                let engine = try #require(await store.stats.engine(for: store))
                let today = StatsDates.day(args["today"] as? String ?? fixture["today"] as! String)
                let actual = try Self.run(vector["operation"] as! String, engine: engine, today: today, args: args)
                if vector["operation"] as? String == "filterActivities" {
                    #expect(actual as? [Int] == vector["expected"] as? [Int], "Filtered identities must match exactly")
                } else {
                    Self.equal(actual, vector["expected"]!, label: "\(fixture["id"]!)/\(vector["id"]!)")
                }
                #expect(StatsFilterScope(store) == scope && store.dateDayRange == dates)
                count += 1
            }
        }
        #expect(count == 54)
    }
    @Test func originalCorpusPinsEveryCalculationIncludingHilliness() async throws {
        let fixture = try Self.json("stats-fixtures/multi-sport-year.json"), expected = fixture["expected"] as! [String: Any]
        let store = ActivityStore(activities: try Self.source(fixture["activities"] as! [[String: Any]]))
        let engine = try #require(await store.stats.engine(for: store)), today = StatsDates.day(fixture["today"] as! String)
        for key in ["totals", "activityCalendar", "consistency", "typicalWeek", "restDays"] {
            Self.equal(try Self.run(key, engine: engine, today: today, args: [:]), expected[key]!, label: key)
        }
        for key in ["yearToDate", "monthVsLastMonth", "thisWeek", "yearPace", "best30Days"] {
            for (metric, value) in expected[key] as! [String: Any] { Self.equal(try Self.run(key, engine: engine, today: today, args: ["metric": metric]), value, label: "\(key)/\(metric)", exactKeys: false) }
        }
        for (range, value) in expected["records"] as! [String: Any] { Self.equal(Self.records(engine.records(today: today, range: StatsWindow(rawValue: range)!), identities: false), value, label: "records/\(range)") }
        for (range, value) in expected["sportMix"] as! [String: Any] { Self.equal(try Self.run("sportMix", engine: engine, today: today, args: ["range": range]), value, label: "sportMix/\(range)") }
        let volume = engine.weeklyVolume(today: today, metric: .distance), expectedVolume = expected["weeklyVolume"] as! [String: Any]
        Self.equal(volume.weekStarts.map(StatsDates.key), expectedVolume["weekStarts"]!, label: "weekStarts")
        Self.equal(volume.values, expectedVolume["distance"]!, label: "weeklyVolume")
        Self.equal(Self.comparison(engine.fourWeekVolume(today: today, metric: .distance)), (expectedVolume["lastFourWeeks"] as! [String: Any])["distance"]!, label: "lastFourWeeks")
        let points = engine.hillPoints(first: StatsDates.previousYear(today), last: today), climbing = engine.climbing(today: today)
        let distance = points.reduce(0) { $0 + $1.distance }, elevation = points.reduce(0) { $0 + $1.elevation }
        Self.equal(["activities": points.count, "metersPerKm": elevation / distance,
                    "climbing": ["current": climbing.current, "previous": climbing.previous, "months": climbing.months.map { ["monthStart": StatsDates.key($0.monthStart), "rate": $0.rate] as [String: Any] }]] as [String: Any], expected["distanceVsElevation"]!, label: "distanceVsElevation")
    }
}

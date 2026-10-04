import Foundation
import SwiftUI
import Testing
@testable import ActivityMap

@MainActor struct DisplayPreferencesTests {
    @Test func defaultsPersistenceAndExplicitSystem() throws {
        let name = "DisplayPreferencesTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let preferences = DisplayPreferences(defaults: defaults)
        #expect(preferences.units == .metric)
        #expect(preferences.dateFormat == .system)
        for format in PreferredDateFormat.allCases {
            preferences.dateFormat = format
            #expect(DisplayPreferences(defaults: defaults).dateFormat == format)
        }
        #expect(preferences.appearance == .system)
        #expect(preferences.appearance.colorScheme == nil)
        for appearance in Appearance.allCases {
            preferences.appearance = appearance
            #expect(DisplayPreferences(defaults: defaults).appearance == appearance)
        }
        preferences.appearance = .system
        #expect(defaults.string(forKey: "display.appearance") == "system")
        #expect(DisplayPreferences(defaults: defaults).appearance.colorScheme == nil)
        #expect(Appearance.light.colorScheme == .light)
        #expect(Appearance.dark.colorScheme == .dark)
        preferences.units = .imperial
        #expect(DisplayPreferences(defaults: defaults).units == .imperial)
    }

    @Test func sharedDateFixturesPreserveActivityWallTime() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "shared/parity/display-units.v1.json")
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let cases = try #require(root["dateCases"] as? [[String: String]])
        for row in cases {
            let date = try #require(ISO8601DateFormatter().date(from: row["value"]!))
            for format in [PreferredDateFormat.dayFirst, .monthFirst, .iso] {
                #expect(Formatters.shortDate(date, timeZone: .gmt, dateFormat: format) == row[format.rawValue])
            }
        }
    }

    @Test func compactAxesPreserveFractionalAndConvertedIntervals() throws {
        struct Fixture: Decodable {
            struct Axis: Decodable { let values: [Double]; let step: Double; let labels: [String] }
            let axisCases: [Axis]
        }
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "shared/parity/display-units.v1.json")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let english = Locale(identifier: "en_US")
        for row in fixture.axisCases {
            #expect(row.values.map { StatsDisplay.compactAxis($0, step: row.step, locale: english) } == row.labels)
        }
        let ticks = StatsDisplay.axisTicks(maximum: 1.08)
        #expect(ticks == [0, 0.5, 1])
        for scale in [1.0, 1000 / UnitSystem.imperial.distanceScale] {
            let labels = ticks.map { StatsDisplay.compactAxis($0 * scale, step: 0.5 * scale, locale: english) }
            #expect(Set(labels).count == ticks.count)
        }
        #expect(StatsDisplay.compactAxis(0.5, step: 0.5, locale: Locale(identifier: "de_DE")) == "0,5")
        #expect(Formatters.elevation(-0.01, locale: Locale(identifier: "de_DE"), units: .metric) == "0 m")
    }

    @Test func sharedMeasurementFixturesAndCanonicalThresholds() throws {
        struct Fixture: Decodable {
            struct Row: Decodable { let kind: String; let value: Double?; let metric: String; let imperial: String }
            let cases: [Row]
        }
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "shared/parity/display-units.v1.json")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        for row in fixture.cases {
            for units in UnitSystem.allCases {
                let formatted: String
                switch row.kind {
                case "distance": formatted = Formatters.distance(row.value, locale: Locale(identifier: "en_US"), units: units)
                case "elevation": formatted = Formatters.elevation(row.value, locale: Locale(identifier: "en_US"), units: units)
                default: formatted = Formatters.speed(row.value, locale: Locale(identifier: "en_US"), units: units)
                }
                #expect(formatted.replacingOccurrences(of: ",", with: "") == (units == .metric ? row.metric : row.imperial))
            }
        }
        for scale in [UnitSystem.imperial.distanceScale, UnitSystem.imperial.elevationScale, UnitSystem.imperial.speedScale] {
            let canonical = 1234.567
            #expect(abs(canonical / scale * scale - canonical) < 1e-9)
        }
        #expect(abs(UnitSystem.imperial.hilliness(100) - 528) < 1e-9)
    }
}

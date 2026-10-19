import Foundation
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

@MainActor struct PresentationTests {
    let english = Locale(identifier: "en_US")

    @Test func sharedSemanticFixturesResolveWithNativeResources() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "shared/presentation/fixtures.v1.json")
        let root = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let rows = try #require(root["messages"] as? [[String: Any]])
        for row in rows {
            let arguments = try #require(row["arguments"] as? [String: Any])
            let resource: LocalizedStringResource
            switch row["id"] as? String {
            case "selection.count": resource = AppMessages.selectionCount(try #require(arguments["count"] as? Int), locale: english)
            case "connect.verify.message": resource = AppMessages.connectVerifyMessage(try #require(arguments["reason"] as? String), locale: english)
            default: Issue.record("Missing semantic fixture adapter"); continue
            }
            // Foundation adds bidi isolates around string interpolation. Compare
            // source meaning without requiring identical platform formatting.
            let rendered = String(localized: resource).replacingOccurrences(of: "\u{2068}", with: "").replacingOccurrences(of: "\u{2069}", with: "")
            #expect(rendered == row["source"] as? String)
        }
    }

    @Test func sourceMessagesPluralizeAndPreserveVerbatimArguments() {
        #expect(String(localized: AppMessages.selectionCount(0, locale: english)) == "0 activities")
        #expect(String(localized: AppMessages.selectionCount(1, locale: english)) == "1 activity")
        #expect(String(localized: AppMessages.selectionCount(3, locale: english)) == "3 activities")
        let userContent = "🌍 {count} <Berg> مرحبا"
        #expect(String(localized: AppMessages.connectVerifyMessage(userContent, locale: english)) == "Your sign-in was saved. \u{2068}" + userContent + "\u{2069}")
        #expect(String(localized: AppMessages.connectButton(locale: Locale(identifier: "ar"))) == "Connect with Strava")
    }

    @Test func protocolMembershipAndNativeSemanticGlyphsAreComplete() throws {
        #expect(SportPresentation.categoryIDs.count == SportType.allCases.count)
        for sport in SportType.allCases {
            #expect(SportPresentation.categoryIDs[sport.rawValue] == sport.category.rawValue)
        }
        let back = try #require(ActionPresentation.definition("back", locale: english))
        #expect(back.mirrorsInRTL)
        #expect(back.glyph == "chevron.backward")
        for action in NativeActionID.allCases {
            #expect(ActionPresentation.definition(action.rawValue) != nil)
            #expect(!ActionPresentation.glyph(action).isEmpty)
        }
        #expect(ActionPresentation.glyph(.activate, variant: "active") == "location.fill")
        #expect(ActionPresentation.glyph(.activate, variant: "badge") == "location.fill")
        #expect(ActionPresentation.glyph(.activate) == "location")
        #expect(ActionPresentation.definition("close")?.mirrorsInRTL == false)
        #expect(ActionPresentation.definition("select")?.glyph != ActionPresentation.definition("activate")?.glyph)
        #expect(String(localized: try #require(ActionPresentation.definition("exportGPX", locale: english)).title) == "Export GPX")
        #expect(String(localized: try #require(MetricPresentation.definition("averageWatts", locale: english)).title) == "Average power")
    }

    @Test func isolatedPreferencesAndExplicitLocaleKeepUnitsAndActivityWallTime() throws {
        let suite = "PresentationTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = DisplayPreferences(defaults: defaults)
        preferences.units = .imperial
        #expect(Formatters.distance(1609.344, locale: english, units: preferences.units) == "1.0 mi")
        #expect(Formatters.distance(1234, locale: Locale(identifier: "de_DE"), units: .metric) == "1,2 km")
        let date = try #require(ISO8601DateFormatter().date(from: "2026-01-01T00:15:00Z"))
        #expect(Formatters.shortDate(date, timeZone: .gmt, locale: english, dateFormat: .iso) == "2026-01-01")
    }

    @Test func localizedAndVerbatimControlsRenderAtCompactWideAndAccessibilitySizes() throws {
        for width: CGFloat in [320, 768] {
            for rtl in [false, true] {
                // Long text is a preview fixture, not a shipped product language.
                let title = LocalizedStringResource("preview.long", defaultValue: "[Ｃｏｎｎｅｃｔ — a deliberately expanded preview label for narrow layouts]", locale: english)
                let content = VStack {
                    StravaConnectControls()
                    BrowseIconButton(title: .localized(title), systemImage: "chevron.backward", isSelected: true) {}
                    BrowseIconButton(title: .verbatim("User {title} مرحبا"), systemImage: "xmark") {}.disabled(true)
                    BrowseSelectionButton(title: "Selection fixture", isSelected: false, isMixed: true) {}
                }
                .environment(DisplayPreferences(defaults: try #require(UserDefaults(suiteName: "preview-\(UUID().uuidString)"))))
                .environment(\.locale, rtl ? Locale(identifier: "ar") : english)
                .environment(\.layoutDirection, rtl ? .rightToLeft : .leftToRight)
                .environment(\.dynamicTypeSize, .accessibility3)
                let controller = UIHostingController(rootView: content)
                controller.view.frame = CGRect(x: 0, y: 0, width: width, height: 1024)
                controller.view.layoutIfNeeded()
                let fitting = controller.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude))
                #expect(fitting.width.isFinite && fitting.height > 0)
                #expect(fitting.width <= width)
            }
        }
    }
}

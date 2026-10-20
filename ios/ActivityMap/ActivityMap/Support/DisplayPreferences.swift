import SwiftUI
import Observation

nonisolated enum UnitSystem: String, CaseIterable, Identifiable, Sendable {
    case metric, imperial
    var id: String { rawValue }
    var title: String { title(locale: .current) }
    func title(locale: Locale) -> String { String(localized: self == .metric ? AppMessages.displayMetric(locale: locale) : AppMessages.displayImperial(locale: locale)) }
    var distanceScale: Double { self == .metric ? 1000 : 1609.344 }
    var elevationScale: Double { self == .metric ? 1 : 0.3048 }
    var speedScale: Double { distanceScale / 3600 }
    var distanceUnit: String { self == .metric ? "km" : "mi" }
    var elevationUnit: String { self == .metric ? "m" : "ft" }
    var speedUnit: String { self == .metric ? "km/h" : "mph" }
    var hillinessUnit: String { "\(elevationUnit) / \(distanceUnit)" }
    func hilliness(_ metresPerKm: Double) -> Double { metresPerKm * distanceScale / 1000 / elevationScale }
}

enum PreferredDateFormat: String, CaseIterable, Identifiable {
    case system, dayFirst = "day-first", monthFirst = "month-first", iso
    var id: String { rawValue }
    var title: String { title(locale: .current) }
    func title(locale: Locale) -> String {
        let resource: LocalizedStringResource = switch self {
        case .system: AppMessages.displaySystem(locale: locale)
        case .dayFirst: AppMessages.displayDayFirst(locale: locale)
        case .monthFirst: AppMessages.displayMonthFirst(locale: locale)
        case .iso: AppMessages.displayIso(locale: locale)
        }
        return String(localized: resource)
    }

    var pattern: String? {
        switch self { case .system: nil; case .dayFirst: "dd.MM.yyyy"; case .monthFirst: "MM/dd/yyyy"; case .iso: "yyyy-MM-dd" }
    }
}

enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String { title(locale: .current) }
    func title(locale: Locale) -> String {
        let resource: LocalizedStringResource = switch self {
        case .system: AppMessages.displaySystem(locale: locale)
        case .light: AppMessages.displayLight(locale: locale)
        case .dark: AppMessages.displayDark(locale: locale)
        }
        return String(localized: resource)
    }
    var colorScheme: ColorScheme? {
        switch self { case .system: nil; case .light: .light; case .dark: .dark }
    }
}

/// Device preferences survive account changes. The app root owns this instance;
/// views observe its environment values and pass explicit units/date choices to
/// pure formatters, without rebuilding browsing state. `nil` defaults isolates previews.
@Observable final class DisplayPreferences {
    @ObservationIgnored private let defaults: UserDefaults?
    var units: UnitSystem { didSet { defaults?.set(units.rawValue, forKey: "display.units") } }
    var dateFormat: PreferredDateFormat { didSet { defaults?.set(dateFormat.rawValue, forKey: "display.dateFormat") } }
    var appearance: Appearance { didSet { defaults?.set(appearance.rawValue, forKey: "display.appearance") } }

    init(defaults: UserDefaults? = .standard) {
        self.defaults = defaults
        dateFormat = PreferredDateFormat(rawValue: defaults?.string(forKey: "display.dateFormat") ?? "") ?? .system
        units = UnitSystem(rawValue: defaults?.string(forKey: "display.units") ?? "") ?? .metric
        appearance = Appearance(rawValue: defaults?.string(forKey: "display.appearance") ?? "") ?? .system
    }
}

extension StatsMetric {
    func displayUnit(units: UnitSystem = .metric) -> String {
        return switch self {
        case .distance: units.distanceUnit
        case .elevation: units.elevationUnit
        default: definition.unit
        }
    }
    func displayValue(_ value: Double, units: UnitSystem = .metric) -> Double {
        return switch self {
        case .distance: value * 1000 / units.distanceScale
        case .elevation: value / units.elevationScale
        default: value
        }
    }
}

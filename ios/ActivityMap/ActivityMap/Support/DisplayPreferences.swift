import SwiftUI
import Observation

nonisolated enum UnitSystem: String, CaseIterable, Identifiable, Sendable {
    case metric, imperial
    var id: String { rawValue }
    var title: String { self == .metric ? "Metric" : "Imperial" }
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
    var title: String {
        switch self { case .system: "System"; case .dayFirst: "Day first (31.12.2026)"; case .monthFirst: "Month first (12/31/2026)"; case .iso: "ISO (2026-12-31)" }
    }
    var pattern: String? {
        switch self { case .system: nil; case .dayFirst: "dd.MM.yyyy"; case .monthFirst: "MM/dd/yyyy"; case .iso: "yyyy-MM-dd" }
    }
}

enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self { case .system: nil; case .light: .light; case .dark: .dark }
    }
}

/// Device preferences survive account changes. Observable reads inside formatters
/// invalidate only views displaying measurements, without rebuilding browsing state.
@Observable final class DisplayPreferences {
    static let shared = DisplayPreferences()
    @ObservationIgnored private let defaults: UserDefaults
    var units: UnitSystem { didSet { defaults.set(units.rawValue, forKey: "display.units") } }
    var dateFormat: PreferredDateFormat { didSet { defaults.set(dateFormat.rawValue, forKey: "display.dateFormat") } }
    var appearance: Appearance { didSet { defaults.set(appearance.rawValue, forKey: "display.appearance") } }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        dateFormat = PreferredDateFormat(rawValue: defaults.string(forKey: "display.dateFormat") ?? "") ?? .system
        units = UnitSystem(rawValue: defaults.string(forKey: "display.units") ?? "") ?? .metric
        appearance = Appearance(rawValue: defaults.string(forKey: "display.appearance") ?? "") ?? .system
    }
}

extension StatsMetric {
    var displayUnit: String {
        let units = DisplayPreferences.shared.units
        return switch self {
        case .distance: units.distanceUnit
        case .elevation: units.elevationUnit
        default: definition.unit
        }
    }
    func displayValue(_ value: Double) -> Double {
        let units = DisplayPreferences.shared.units
        return switch self {
        case .distance: value * 1000 / units.distanceScale
        case .elevation: value / units.elevationScale
        default: value
        }
    }
}

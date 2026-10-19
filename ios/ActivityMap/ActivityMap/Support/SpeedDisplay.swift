import Foundation

enum SpeedDisplay: Equatable {
    case speed, run, swim

    static func forSport(_ sport: SportType) -> Self {
        switch sport {
        case .run, .trailRun, .virtualRun: .run
        case .swim: .swim
        default: .speed
        }
    }

    static func forActivities(_ activities: [Activity]) -> Self {
        guard let first = activities.first else { return .speed }
        let display = forSport(first.sportType)
        return display != .speed && activities.allSatisfy { forSport($0.sportType) == display } ? display : .speed
    }

    func label(maximum: Bool = false) -> String {
        self == .speed ? (maximum ? "Maximum speed" : "Average speed") : (maximum ? "Best pace" : "Average pace")
    }

    func unit(_ units: UnitSystem) -> String {
        switch self {
        case .speed: units.speedUnit
        case .run: units == .metric ? "min/km" : "min/mi"
        case .swim: units == .metric ? "min/100 m" : "min/100 yd"
        }
    }

    func paceSeconds(_ speed: Double?, units: UnitSystem = .metric) -> Double? {
        guard let speed, speed.isFinite, speed > 0 else { return nil }
        let distance = self == .swim ? (units == .metric ? 100.0 : 91.44) : units.distanceScale
        let seconds = distance / speed
        return seconds.isFinite && seconds <= 9_007_199_254_740_991 ? seconds : nil
    }

    func format(_ speed: Double?, units: UnitSystem = .metric, locale: Locale = .current) -> String {
        guard self != .speed else { return Formatters.speed(speed, locale: locale, units: units) }
        guard let seconds = paceSeconds(speed, units: units) else { return Formatters.unknown }
        let rounded = Int(seconds.rounded())
        return "\((rounded / 60).formatted(.number.grouping(.never).locale(locale))):\((rounded % 60).formatted(.number.precision(.integerLength(2)).grouping(.never).locale(locale))) \(unit(units))"
    }
}

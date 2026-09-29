import Foundation

enum SportGroupSelection {
    case all, none, mixed
    var symbolName: String {
        switch self {
        case .all: "checkmark.circle.fill"
        case .none: "circle"
        case .mixed: "minus.circle.fill"
        }
    }
    var label: String {
        switch self {
        case .all: "All selected"
        case .none: "None selected"
        case .mixed: "Some selected"
        }
    }
}

enum BinaryFilterMode: String, CaseIterable, Identifiable {
    case any = "Any", yes = "Yes", no = "No"
    var id: String { rawValue }
    init(_ value: Bool?) { self = value.map { $0 ? .yes : .no } ?? .any }
    var value: Bool? {
        switch self { case .any: nil; case .yes: true; case .no: false }
    }
}

/// Calendar-day keys are stable while travelling and across DST transitions.
/// Picker dates use the supplied Gregorian calendar in the viewer's timezone;
/// activities already provide their encoded local day via `localDayKey`.
struct ActivityDayRange: Equatable, Hashable {
    let start: String
    let end: String

    init?(start: String, end: String) {
        guard Self.date(start, calendar: Self.calendar(timeZone: .gmt)) != nil,
              Self.date(end, calendar: Self.calendar(timeZone: .gmt)) != nil,
              start <= end else { return nil }
        self.start = start
        self.end = end
    }

    init?(start: Date, end: Date, timeZone: TimeZone = .current) {
        self.init(start: Formatters.dayKey(start, timeZone: timeZone),
                  end: Formatters.dayKey(end, timeZone: timeZone))
    }

    func contains(_ day: String) -> Bool { start <= day && day <= end }

    func pickerRange(timeZone: TimeZone = .current) -> ClosedRange<Date>? {
        let calendar = Self.calendar(timeZone: timeZone)
        guard let lower = Self.date(start, calendar: calendar),
              let upper = Self.date(end, calendar: calendar) else { return nil }
        return lower...upper
    }

    static func calendar(timeZone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    private static func date(_ key: String, calendar: Calendar) -> Date? {
        guard key.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#, options: .regularExpression) != nil else { return nil }
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...9999).contains(parts[0]),
              let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])),
              Formatters.dayKey(date, timeZone: calendar.timeZone) == key else { return nil }
        return date
    }
}

enum ActivityDatePreset: String, CaseIterable, Identifiable {
    case allTime = "All Time"
    case thisYear = "This Year"
    case lastYear = "Last Year"
    case thisMonth = "This Month"
    case lastMonth = "Last Month"
    case lastTwelveMonths = "Last 12 Months"
    case custom = "Custom Range"
    var id: String { rawValue }

    /// Resolve each time selected, including full future days of this period.
    func range(now: Date = Date(), timeZone: TimeZone = .current) -> ActivityDayRange? {
        let calendar = ActivityDayRange.calendar(timeZone: timeZone)
        switch self {
        case .allTime, .custom: return nil
        case .lastTwelveMonths:
            guard let start = calendar.date(byAdding: .year, value: -1, to: now) else { return nil }
            return ActivityDayRange(start: start, end: now, timeZone: timeZone)
        case .thisYear, .lastYear, .thisMonth, .lastMonth:
            let component: Calendar.Component = self == .thisYear || self == .lastYear ? .year : .month
            let isPrevious = self == .lastYear || self == .lastMonth
            let reference = isPrevious ? calendar.date(byAdding: component, value: -1, to: now) : now
            guard let reference, let interval = calendar.dateInterval(of: component, for: reference),
                  let end = calendar.date(byAdding: .day, value: -1, to: interval.end) else { return nil }
            return ActivityDayRange(start: interval.start, end: end, timeZone: timeZone)
        }
    }
}

/// Strict decimal editing: no partial parse, grouping, NaN/infinity, or implicit
/// zero. UI values are converted to metres/seconds exactly once on Apply.
enum NumericFilterInput {
    case empty
    case valid(Double)
    case invalid

    static func parse(_ input: String, scale: Double, locale: Locale = .current) -> Self {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .empty }
        let separator = locale.decimalSeparator ?? "."
        let decimalNormalized = separator == "." ? trimmed : trimmed.replacingOccurrences(of: separator, with: ".")
        // Number formatting and native keyboards can use Arabic/Persian (or
        // other Unicode decimal) digits. Normalize only decimal digits; signs,
        // grouping marks, numeric symbols and fractions still fail validation.
        let normalized = decimalNormalized.unicodeScalars.map { scalar in
            if scalar.properties.numericType == .decimal,
               let value = scalar.properties.numericValue {
                return String(Int(value))
            }
            return String(scalar)
        }.joined()
        guard normalized.range(of: #"^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$"#, options: .regularExpression) != nil,
              let number = Double(normalized), number.isFinite,
              scale.isFinite, scale > 0, (number * scale).isFinite else { return .invalid }
        return .valid(number * scale)
    }
}

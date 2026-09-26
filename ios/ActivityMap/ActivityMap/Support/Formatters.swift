import Foundation

enum Formatters {
    static let unknown = "—"

    static func distance(_ meters: Double?, locale: Locale = .current) -> String {
        number(meters.map { $0 / 1000 }, decimals: 1, unit: "km", locale: locale)
    }

    static func elevation(_ meters: Double?, locale: Locale = .current) -> String {
        number(meters, decimals: 0, unit: "m", locale: locale)
    }

    static func speed(_ metersPerSecond: Double?, locale: Locale = .current) -> String {
        number(metersPerSecond.map { $0 * 3.6 }, decimals: 1, unit: "km/h", locale: locale)
    }

    static func watts(_ watts: Double?, locale: Locale = .current) -> String {
        number(watts, decimals: 0, unit: "W", locale: locale)
    }

    static func heartrate(_ bpm: Double?, locale: Locale = .current) -> String {
        number(bpm, decimals: 0, unit: "bpm", locale: locale)
    }

    static func number(_ value: Double?, decimals: Int, unit: String, locale: Locale = .current) -> String {
        guard let value, value.isFinite else { return unknown }
        return value.formatted(.number.precision(.fractionLength(decimals)).locale(locale)) + " " + unit
    }

    static func duration(_ seconds: Int?) -> String {
        guard let seconds, seconds >= 0 else { return unknown }
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = seconds >= 86400 ? [.day, .hour] : [.hour, .minute]
        formatter.zeroFormattingBehavior = .dropAll
        return formatter.string(from: TimeInterval(seconds)) ?? unknown
    }

    /// Pass .gmt for the API's encoded activity-local wall time. Locale still
    /// controls date ordering and the user's 12/24-hour display preference.
    static func shortDate(_ date: Date, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
        dateString(date, template: "yMd", timeZone: timeZone, locale: locale)
    }

    static func shortDateTime(_ date: Date, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
        dateString(date, template: "yMdjm", timeZone: timeZone, locale: locale)
    }

    static func monthYear(_ date: Date) -> String {
        dateString(date, template: "yMMM", timeZone: .current, locale: .current)
    }

    private static func dateString(_ date: Date, template: String, timeZone: TimeZone, locale: Locale) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }

    static func dayKey(_ date: Date, timeZone: TimeZone) -> String {
        var calendar = activityCalendar
        calendar.timeZone = timeZone
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
    }

    static var activityCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }
}

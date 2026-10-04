import Foundation

enum Formatters {
    private static let dateFormatters: NSCache<NSString, DateFormatter> = {
        let cache = NSCache<NSString, DateFormatter>()
        cache.countLimit = 24
        return cache
    }()
    static let unknown = "—"

    static func distance(_ meters: Double?, locale: Locale = .current, units: UnitSystem? = nil) -> String {
        let units = units ?? DisplayPreferences.shared.units
        return number(meters.map { $0 / units.distanceScale }, decimals: 1, unit: units.distanceUnit, locale: locale)
    }

    static func elevation(_ meters: Double?, locale: Locale = .current, units: UnitSystem? = nil) -> String {
        let units = units ?? DisplayPreferences.shared.units
        return number(meters.map { $0 / units.elevationScale }, decimals: 0, unit: units.elevationUnit, locale: locale)
    }

    static func speed(_ metersPerSecond: Double?, locale: Locale = .current, units: UnitSystem? = nil) -> String {
        let units = units ?? DisplayPreferences.shared.units
        return number(metersPerSecond.map { $0 / units.speedScale }, decimals: 1, unit: units.speedUnit, locale: locale)
    }

    static func watts(_ watts: Double?, locale: Locale = .current) -> String {
        number(watts, decimals: 0, unit: "W", locale: locale)
    }

    static func heartrate(_ bpm: Double?, locale: Locale = .current) -> String {
        number(bpm, decimals: 0, unit: "bpm", locale: locale)
    }

    static func number(_ value: Double?, decimals: Int, unit: String, locale: Locale = .current) -> String {
        guard let value, value.isFinite else { return unknown }
        let rounded = (value * pow(10, Double(decimals))).rounded(.toNearestOrEven)
        let normalized = rounded == 0 ? 0 : value
        return normalized.formatted(.number.precision(.fractionLength(decimals)).locale(locale)) + " " + unit
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
    static func shortDate(_ date: Date, timeZone: TimeZone = .current, locale: Locale = .current, dateFormat: PreferredDateFormat? = nil) -> String {
        preferredDate(date, timeZone: timeZone, locale: locale, format: dateFormat ?? DisplayPreferences.shared.dateFormat)
    }

    static func shortDateTime(_ date: Date, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
        preferredDate(date, timeZone: timeZone, locale: locale, format: DisplayPreferences.shared.dateFormat) + " · " + dateString(date, template: "jm", timeZone: timeZone, locale: locale)
    }

    private static func preferredDate(_ date: Date, timeZone: TimeZone, locale: Locale, format: PreferredDateFormat) -> String {
        guard let pattern = format.pattern else { return dateString(date, template: "yMd", timeZone: timeZone, locale: locale) }
        let key = "fixed|\(timeZone.identifier)|\(pattern)" as NSString
        if let formatter = dateFormatters.object(forKey: key) { return formatter.string(from: date) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = pattern
        dateFormatters.setObject(formatter, forKey: key)
        return formatter.string(from: date)
    }

    static func monthYear(_ date: Date) -> String {
        dateString(date, template: "yMMM", timeZone: .current, locale: .current)
    }

    private static func dateString(_ date: Date, template: String, timeZone: TimeZone, locale: Locale) -> String {
        // Visible rows redraw during native navigation. Reuse immutable
        // formatters; locale/timezone changes naturally select a different key.
        let key = "\(locale.identifier)|\(locale.calendar.identifier)|\(timeZone.identifier)|\(template)" as NSString
        if let formatter = dateFormatters.object(forKey: key) { return formatter.string(from: date) }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        dateFormatters.setObject(formatter, forKey: key)
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

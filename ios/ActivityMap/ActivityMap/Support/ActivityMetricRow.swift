import Foundation

/// Each measurement is independently available. A missing sibling must not
/// hide a recorded maximum, average or measured zero.
struct ActivityMetricRow: Identifiable {
    let id: String
    let title: String
    let icon: String
    let value: String

    static func rows(for activity: Activity, locale: Locale = .current, units: UnitSystem = .metric, dateFormat: PreferredDateFormat = .system) -> [ActivityMetricRow] {
        var rows = [ActivityMetricRow(
            id: "date", title: String(localized: AppMessages.metricDate(locale: locale)), icon: "calendar",
            value: Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt, locale: locale, dateFormat: dateFormat))]
        func add(_ id: String, _ title: String, _ icon: String, _ value: String) {
            guard value != Formatters.unknown else { return }
            let semantic = MetricPresentation.definition(id, locale: locale)
            rows.append(.init(id: id, title: semantic.map { String(localized: $0.title) } ?? title,
                              icon: semantic?.glyph ?? icon, value: value))
        }
        add("distance", "Distance", "ruler", Formatters.distance(activity.distance, locale: locale, units: units))
        add("movingTime", "Moving time", "stopwatch", Formatters.duration(activity.movingTime, locale: locale))
        add("elapsedTime", "Elapsed time", "stopwatch", Formatters.duration(activity.elapsedTime, locale: locale))
        add("elevationGain", "Elevation gain", "mountain.2", Formatters.elevation(activity.totalElevationGain, locale: locale, units: units))
        add("elevHigh", "Maximum elevation", "mountain.2", Formatters.elevation(activity.elevHigh, locale: locale, units: units))
        add("elevLow", "Minimum elevation", "mountain.2", Formatters.elevation(activity.elevLow, locale: locale, units: units))
        let display = SpeedDisplay.forSport(activity.sportType)
        if display != .speed {
            add("averagePace", "Average pace", "stopwatch", display.format(activity.averageSpeed, units: units, locale: locale))
            add("bestPace", "Best pace", "stopwatch", display.format(activity.maxSpeed, units: units, locale: locale))
        }
        add("averageSpeed", "Average speed", "speedometer", Formatters.speed(activity.averageSpeed, locale: locale, units: units))
        add("maxSpeed", "Maximum speed", "speedometer", Formatters.speed(activity.maxSpeed, locale: locale, units: units))
        add("averageHeartrate", "Average heart rate", "heart", Formatters.heartrate(activity.averageHeartrate, locale: locale))
        add("maxHeartrate", "Maximum heart rate", "heart", Formatters.heartrate(activity.maxHeartrate, locale: locale))
        add("averageWatts", "Average power", "bolt", Formatters.watts(activity.averageWatts, locale: locale))
        add("maxWatts", "Maximum power", "bolt", Formatters.watts(activity.maxWatts, locale: locale))
        add("weightedAverageWatts", "Weighted average power", "bolt", Formatters.watts(activity.weightedAverageWatts, locale: locale))
        add("calories", "Energy", "flame", Formatters.number(activity.calories, decimals: 0, unit: "kcal", locale: locale))
        add("kilojoules", "Work", "bolt", Formatters.number(activity.kilojoules, decimals: 0, unit: "kJ", locale: locale))
        for metric in [ActivityListMetric.id, .geometry, .photos, .kudos, .achievements, .comments,
                       .commute, .privacy, .flagged, .trainer, .manual] {
            add(metric.rawValue, metric.title, "info.circle", metric.value(for: activity, units: units, locale: locale))
        }
        return rows
    }
}

/// Each recorded field has one topic; headline measurements and date already
/// appear above the groups. Short labels get their meaning from the group.
struct ActivityMetricGroup: Identifiable {
    let id: String
    let title: String
    let icon: String
    let rows: [ActivityMetricRow]

    static func groups(for activity: Activity, locale: Locale = .current, units: UnitSystem = .metric, dateFormat: PreferredDateFormat = .system) -> [ActivityMetricGroup] {
        let rows = ActivityMetricRow.rows(for: activity, locale: locale, units: units, dateFormat: dateFormat)
        let hasPace = SpeedDisplay.forSport(activity.sportType) != .speed
        let definitions: [(String, String, String, [(String, String)])] = [
            ("time-speed", hasPace ? String(localized: AppMessages.activityGroupTimePace(locale: locale)) : String(localized: AppMessages.activityGroupTimeSpeed(locale: locale)), "speedometer", (hasPace ? [("bestPace", String(localized: AppMessages.metricBestPace(locale: locale)))] : []) + [
                ("elapsedTime", String(localized: AppMessages.metricElapsedTime(locale: locale))), ("averageSpeed", String(localized: AppMessages.metricAverageSpeed(locale: locale))), ("maxSpeed", String(localized: AppMessages.metricMaxSpeed(locale: locale)))]),
            ("elevation", String(localized: AppMessages.activityGroupElevation(locale: locale)), "mountain.2", (hasPace ? [("elevationGain", String(localized: AppMessages.metricTotalElevationGain(locale: locale)))] : []) + [("elevLow", String(localized: AppMessages.metricShortMinimum(locale: locale))), ("elevHigh", String(localized: AppMessages.metricShortMaximum(locale: locale)))]),
            ("power", String(localized: AppMessages.activityGroupPower(locale: locale)), "bolt", [("averageWatts", String(localized: AppMessages.metricShortAverage(locale: locale))), ("maxWatts", String(localized: AppMessages.metricShortMaximum(locale: locale))),
                ("weightedAverageWatts", String(localized: AppMessages.metricShortWeightedAverage(locale: locale))), ("kilojoules", String(localized: AppMessages.metricKilojoules(locale: locale)))]),
            ("heart-rate", String(localized: AppMessages.activityGroupHeartRate(locale: locale)), "heart", [("averageHeartrate", String(localized: AppMessages.metricShortAverage(locale: locale))), ("maxHeartrate", String(localized: AppMessages.metricShortMaximum(locale: locale)))]),
            ("energy", String(localized: AppMessages.activityGroupEnergy(locale: locale)), "flame", [("calories", String(localized: AppMessages.metricShortCalories(locale: locale)))]),
            ("social", String(localized: AppMessages.activityGroupSocial(locale: locale)), "person.2", [("kudos", String(localized: AppMessages.metricKudos(locale: locale))), ("achievements", String(localized: AppMessages.metricAchievements(locale: locale))),
                ("comments", String(localized: AppMessages.metricComments(locale: locale))), ("photos", String(localized: AppMessages.metricPhotos(locale: locale)))]),
            ("activity", String(localized: AppMessages.activityGroupActivity(locale: locale)), "info.circle", [("commute", String(localized: AppMessages.metricCommute(locale: locale))), ("privacy", String(localized: AppMessages.metricPrivate(locale: locale))),
                ("trainer", String(localized: AppMessages.metricIndoor(locale: locale))), ("manual", String(localized: AppMessages.metricManual(locale: locale))), ("flagged", String(localized: AppMessages.metricFlagged(locale: locale))),
                ("geometry", String(localized: AppMessages.metricGeometryStatus(locale: locale)))]),
        ]
        return definitions.compactMap { id, title, icon, fields in
            let values = fields.compactMap { field, label in
                rows.first { $0.id == field }.map {
                    ActivityMetricRow(id: $0.id, title: label, icon: icon, value: $0.value)
                }
            }
            return values.isEmpty ? nil : ActivityMetricGroup(id: id, title: title, icon: icon, rows: values)
        }
    }
}

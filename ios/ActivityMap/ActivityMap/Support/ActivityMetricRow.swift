import Foundation

/// Each measurement is independently available. A missing sibling must not
/// hide a recorded maximum, average or measured zero.
struct ActivityMetricRow: Identifiable {
    let id: String
    let title: String
    let icon: String
    let value: String

    static func rows(for activity: Activity) -> [ActivityMetricRow] {
        var rows = [ActivityMetricRow(
            id: "date", title: "Date", icon: "calendar",
            value: Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt))]
        func add(_ id: String, _ title: String, _ icon: String, _ value: String) {
            guard value != Formatters.unknown else { return }
            rows.append(.init(id: id, title: title, icon: icon, value: value))
        }
        add("distance", "Distance", "ruler", Formatters.distance(activity.distance))
        add("movingTime", "Moving time", "stopwatch", Formatters.duration(activity.movingTime))
        add("elapsedTime", "Elapsed time", "stopwatch", Formatters.duration(activity.elapsedTime))
        add("elevationGain", "Elevation gain", "mountain.2", Formatters.elevation(activity.totalElevationGain))
        add("elevHigh", "Maximum elevation", "mountain.2", Formatters.elevation(activity.elevHigh))
        add("elevLow", "Minimum elevation", "mountain.2", Formatters.elevation(activity.elevLow))
        add("averageSpeed", "Average speed", "speedometer", Formatters.speed(activity.averageSpeed))
        add("maxSpeed", "Maximum speed", "speedometer", Formatters.speed(activity.maxSpeed))
        add("averageHeartrate", "Average heart rate", "heart", Formatters.heartrate(activity.averageHeartrate))
        add("maxHeartrate", "Maximum heart rate", "heart", Formatters.heartrate(activity.maxHeartrate))
        add("averageWatts", "Average power", "bolt", Formatters.watts(activity.averageWatts))
        add("maxWatts", "Maximum power", "bolt", Formatters.watts(activity.maxWatts))
        add("weightedAverageWatts", "Weighted average power", "bolt", Formatters.watts(activity.weightedAverageWatts))
        add("calories", "Energy", "flame", Formatters.number(activity.calories, decimals: 0, unit: "kcal"))
        add("kilojoules", "Work", "bolt", Formatters.number(activity.kilojoules, decimals: 0, unit: "kJ"))
        for metric in [ActivityListMetric.id, .geometry, .photos, .kudos, .achievements, .comments,
                       .commute, .privacy, .flagged, .trainer, .manual] {
            add(metric.rawValue, metric.title, "info.circle", metric.value(for: activity))
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

    static func groups(for activity: Activity) -> [ActivityMetricGroup] {
        let rows = ActivityMetricRow.rows(for: activity)
        let definitions: [(String, String, String, [(String, String)])] = [
            ("time-speed", "Time & speed", "speedometer", [
                ("elapsedTime", "Elapsed time"), ("averageSpeed", "Average speed"), ("maxSpeed", "Maximum speed")]),
            ("elevation", "Elevation", "mountain.2", [("elevLow", "Minimum"), ("elevHigh", "Maximum")]),
            ("power", "Power", "bolt", [("averageWatts", "Average"), ("maxWatts", "Maximum"),
                ("weightedAverageWatts", "Weighted average"), ("kilojoules", "Work")]),
            ("heart-rate", "Heart rate", "heart", [("averageHeartrate", "Average"), ("maxHeartrate", "Maximum")]),
            ("energy", "Energy", "flame", [("calories", "Calories")]),
            ("social", "Social", "person.2", [("kudos", "Kudos"), ("achievements", "Achievements"),
                ("comments", "Comments"), ("photos", "Photos")]),
            ("activity", "Activity", "info.circle", [("commute", "Commute"), ("privacy", "Private"),
                ("trainer", "Indoor"), ("manual", "Manual"), ("flagged", "Flagged"),
                ("geometry", "Geometry status")]),
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

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
        return rows
    }
}

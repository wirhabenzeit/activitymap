import Foundation

/// A continuous native list has no page or instantiated-cell summary scope.
enum ActivitySummaryMode: String, CaseIterable, Codable, Identifiable {
    case off, filtered, selected
    var id: String { rawValue }
    var title: String {
        switch self { case .off: "Off"; case .filtered: "Filtered activities"; case .selected: "Selected activities" }
    }
}

enum ActivitySummaryMetric: String, CaseIterable, Identifiable {
    // Match the native distance / elapsed time / elevation hierarchy.
    case distance, elapsedTime = "elapsed_time", elevationGain = "total_elevation_gain"
    case movingTime = "moving_time", averageSpeed = "average_speed"
    case elevationHigh = "elev_high", elevationLow = "elev_low"
    case averagePower = "average_watts", weightedPower = "weighted_average_watts"
    case averageHeartRate = "average_heartrate", maxPower = "max_watts", maxHeartRate = "max_heartrate"

    enum Operation { case sum, mean, minimum, maximum }
    var id: String { rawValue }
    var operation: Operation {
        switch self {
        case .distance, .elapsedTime, .elevationGain, .movingTime: .sum
        case .averageSpeed, .averagePower, .weightedPower, .averageHeartRate: .mean
        case .elevationLow: .minimum
        case .elevationHigh, .maxPower, .maxHeartRate: .maximum
        }
    }
    var title: String {
        switch self {
        case .distance: "Total distance"
        case .elapsedTime: "Total elapsed time"
        case .elevationGain: "Total elevation gain"
        case .movingTime: "Total moving time"
        case .averageSpeed: "Mean average speed"
        case .elevationHigh: "Maximum elevation"
        case .elevationLow: "Minimum elevation"
        case .averagePower: "Mean average power"
        case .weightedPower: "Mean weighted average power"
        case .averageHeartRate: "Mean average heart rate"
        case .maxPower: "Maximum power"
        case .maxHeartRate: "Maximum heart rate"
        }
    }
    func measurement(in activity: Activity) -> Double? {
        let value: Double?
        switch self {
        case .distance: value = activity.distance
        case .elapsedTime: value = activity.elapsedTime.map(Double.init)
        case .elevationGain: value = activity.totalElevationGain
        case .movingTime: value = activity.movingTime.map(Double.init)
        case .averageSpeed: value = activity.averageSpeed
        case .elevationHigh: value = activity.elevHigh
        case .elevationLow: value = activity.elevLow
        case .averagePower: value = activity.averageWatts
        case .weightedPower: value = activity.weightedAverageWatts
        case .averageHeartRate: value = activity.averageHeartrate
        case .maxPower: value = activity.maxWatts
        case .maxHeartRate: value = activity.maxHeartrate
        }
        return value.flatMap { $0.isFinite ? $0 : nil }
    }
    func formatted(_ value: Double?) -> String {
        switch self {
        case .distance: Formatters.distance(value)
        case .elapsedTime, .movingTime:
            // Aggregate in Double without an overflowing Int sum. Convert only
            // the representable final seconds at the presentation boundary.
            Formatters.duration(value.flatMap(Int.init(exactly:)))
        case .elevationGain, .elevationHigh, .elevationLow: Formatters.elevation(value)
        case .averageSpeed: Formatters.speed(value)
        case .averagePower, .weightedPower, .maxPower: Formatters.watts(value)
        case .averageHeartRate, .maxHeartRate: Formatters.heartrate(value)
        }
    }
}

struct ActivitySummaryValue: Equatable {
    let value: Double?
    let knownCount: Int
}

struct ActivitySummary: Equatable {
    let activityCount: Int
    let localDayCount: Int
    let metrics: [ActivitySummaryMetric: ActivitySummaryValue]

    subscript(_ metric: ActivitySummaryMetric) -> ActivitySummaryValue {
        metrics[metric] ?? ActivitySummaryValue(value: nil, knownCount: 0)
    }

    /// Canonical metrics only; no route vertices, photos, images or streams are
    /// traversed or decoded. ID membership is independent of lazy row lifetime.
    static func aggregate(_ activities: [Activity], ids: Set<Int>) -> ActivitySummary {
        var seen = Set<Int>()
        var days = Set<String>()
        var accumulators = Dictionary(uniqueKeysWithValues: ActivitySummaryMetric.allCases.map { ($0, Accumulator()) })
        for activity in activities where ids.contains(activity.id) && seen.insert(activity.id).inserted {
            days.insert(activity.localDayKey)
            for metric in ActivitySummaryMetric.allCases {
                if let value = metric.measurement(in: activity) { accumulators[metric]?.add(value) }
            }
        }
        let count = seen.count
        let results = Dictionary(uniqueKeysWithValues: ActivitySummaryMetric.allCases.map { metric in
            let accumulator = accumulators[metric]!
            return (metric, ActivitySummaryValue(value: accumulator.result(metric.operation, empty: count == 0),
                                                knownCount: accumulator.count))
        })
        return ActivitySummary(activityCount: count, localDayCount: days.count, metrics: results)
    }

    private struct Accumulator {
        var count = 0
        var sum = 0.0
        var compensation = 0.0
        var minimum = Double.infinity
        var maximum = -Double.infinity
        mutating func add(_ value: Double) {
            count += 1
            // Keep unrounded totals accurate for libraries containing many
            // short activities mixed with large values.
            let adjusted = value - compensation
            let next = sum + adjusted
            compensation = (next - sum) - adjusted
            sum = next
            minimum = min(minimum, value)
            maximum = max(maximum, value)
        }
        func result(_ operation: ActivitySummaryMetric.Operation, empty: Bool) -> Double? {
            guard count > 0 else { return empty && operation == .sum ? 0 : nil }
            let value: Double
            switch operation {
            case .sum: value = sum
            case .mean: value = sum / Double(count)
            case .minimum: value = minimum
            case .maximum: value = maximum
            }
            return value.isFinite ? value : nil
        }
    }
}

/// Cache by activity revision and exact ID membership. Scrolling, sorting,
/// display changes and opening details do not invalidate aggregate values.
final class ActivitySummaryCache {
    private struct Entry {
        let revision: Int
        let ids: Set<Int>
        let summary: ActivitySummary
    }
    private var entries: [ActivitySummaryMode: Entry] = [:]
    private(set) var buildCount = 0

    func summary(mode: ActivitySummaryMode, revision: Int, activities: [Activity], ids: Set<Int>) -> ActivitySummary? {
        guard mode != .off else { return nil }
        if let entry = entries[mode], entry.revision == revision, entry.ids == ids { return entry.summary }
        let summary = ActivitySummary.aggregate(activities, ids: ids)
        entries[mode] = Entry(revision: revision, ids: ids, summary: summary)
        buildCount += 1
        return summary
    }
    func clear() { entries = [:] }
}

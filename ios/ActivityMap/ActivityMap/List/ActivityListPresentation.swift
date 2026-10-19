import Foundation
import Observation

/// Wire names keep the native sort menu aligned with the shared parity corpus.
/// One primary sort is the agreed baseline; ties always use exact integer IDs.
enum ActivitySortField: String, CaseIterable, Codable, Identifiable {
    case id, name, description, selection
    case localDate = "start_date_local", sport = "sport_type", distance
    case movingTime = "moving_time", elapsedTime = "elapsed_time"
    case averageSpeed = "average_speed", maxSpeed = "max_speed"
    case elevationGain = "total_elevation_gain", elevationHigh = "elev_high", elevationLow = "elev_low"
    case averageHeartRate = "average_heartrate", maxHeartRate = "max_heartrate"
    case averagePower = "average_watts", weightedPower = "weighted_average_watts", maxPower = "max_watts"
    case kudos = "kudos_count", photos = "photo_count", geometry = "geometry_state"
    case calories, kilojoules, commute, privacy = "private", flagged, trainer, manual
    case achievements = "achievement_count", comments = "comment_count"

    var id: String { rawValue }
    var title: String { title(locale: .current) }
    func title(locale: Locale) -> String {
        switch self {
        case .selection: "Selection state"
        case .id: String(localized: AppMessages.listActivityID(locale: locale))
        case .name: "Name"
        case .description: "Description"
        case .localDate: String(localized: AppMessages.metricLocalDateTime(locale: locale))
        case .sport: "Sport"
        case .distance: String(localized: AppMessages.metricDistance(locale: locale))
        case .movingTime: String(localized: AppMessages.metricMovingTime(locale: locale))
        case .elapsedTime: String(localized: AppMessages.metricElapsedTime(locale: locale))
        case .averageSpeed: String(localized: AppMessages.metricAverageSpeed(locale: locale))
        case .maxSpeed: String(localized: AppMessages.metricMaxSpeed(locale: locale))
        case .elevationGain: String(localized: AppMessages.metricTotalElevationGain(locale: locale))
        case .elevationHigh: String(localized: AppMessages.metricElevHigh(locale: locale))
        case .elevationLow: String(localized: AppMessages.metricElevLow(locale: locale))
        case .averageHeartRate: String(localized: AppMessages.metricAverageHeartrate(locale: locale))
        case .maxHeartRate: String(localized: AppMessages.metricMaxHeartrate(locale: locale))
        case .averagePower: String(localized: AppMessages.metricAverageWatts(locale: locale))
        case .weightedPower: String(localized: AppMessages.metricWeightedAverageWatts(locale: locale))
        case .maxPower: String(localized: AppMessages.metricMaxWatts(locale: locale))
        case .kudos: String(localized: AppMessages.metricKudos(locale: locale))
        case .photos: String(localized: AppMessages.metricPhotos(locale: locale))
        case .geometry: String(localized: AppMessages.metricGeometryStatus(locale: locale))
        case .calories: String(localized: AppMessages.metricCalories(locale: locale))
        case .kilojoules: String(localized: AppMessages.metricKilojoules(locale: locale))
        case .commute: String(localized: AppMessages.metricCommute(locale: locale))
        case .privacy: String(localized: AppMessages.metricPrivate(locale: locale))
        case .flagged: String(localized: AppMessages.metricFlagged(locale: locale))
        case .trainer: String(localized: AppMessages.metricIndoor(locale: locale))
        case .manual: String(localized: AppMessages.metricManual(locale: locale))
        case .achievements: String(localized: AppMessages.metricAchievements(locale: locale))
        case .comments: String(localized: AppMessages.metricComments(locale: locale))
        }
    }

    func title(speedDisplay: SpeedDisplay, locale: Locale = .current) -> String {
        switch self {
        case .averageSpeed: speedDisplay == .speed ? title(locale: locale) : String(localized: AppMessages.metricAveragePace(locale: locale))
        case .maxSpeed: speedDisplay == .speed ? title(locale: locale) : String(localized: AppMessages.metricBestPace(locale: locale))
        default: title(locale: locale)
        }
    }
}

enum ActivitySortDirection: String, CaseIterable, Codable, Identifiable {
    case ascending = "asc", descending = "desc"
    var id: String { rawValue }
    var title: String { self == .ascending ? "Ascending" : "Descending" }
}

struct ActivityListSort: Codable, Equatable {
    var field: ActivitySortField = .id
    var direction: ActivitySortDirection = .descending

    func sorted(_ activities: [Activity], selectedIDs: Set<Int> = [], speedDisplay: SpeedDisplay = .speed) -> [Activity] {
        activities.sorted { lhs, rhs in
            let comparison: Int
            switch field {
            case .selection: comparison = compare(selectedIDs.contains(lhs.id) ? 1 : 0, selectedIDs.contains(rhs.id) ? 1 : 0)
            case .id: comparison = compare(lhs.id, rhs.id)
            case .name: comparison = compareText(lhs.name, rhs.name)
            case .description: comparison = compareText(lhs.description, rhs.description)
            case .sport: comparison = compare(lhs.sportType.rawValue, rhs.sportType.rawValue)
            case .localDate: comparison = compare(lhs.startDateLocal, rhs.startDateLocal)
            case .kudos: comparison = compare(lhs.kudosCount, rhs.kudosCount)
            case .photos: comparison = compare(lhs.totalPhotoCount ?? lhs.photoCount, rhs.totalPhotoCount ?? rhs.photoCount)
            case .achievements: comparison = compare(lhs.achievementCount, rhs.achievementCount)
            case .comments: comparison = compare(lhs.commentCount, rhs.commentCount)
            case .movingTime: comparison = compare(lhs.movingTime, rhs.movingTime)
            case .elapsedTime: comparison = compare(lhs.elapsedTime, rhs.elapsedTime)
            case .geometry: comparison = compare(Self.geometryRank(lhs.geometryState), Self.geometryRank(rhs.geometryState))
            case .commute: comparison = compare(lhs.commute.map { $0 ? 1 : 0 }, rhs.commute.map { $0 ? 1 : 0 })
            case .privacy: comparison = compare(lhs.isPrivate.map { $0 ? 1 : 0 }, rhs.isPrivate.map { $0 ? 1 : 0 })
            case .flagged: comparison = compare(lhs.flagged.map { $0 ? 1 : 0 }, rhs.flagged.map { $0 ? 1 : 0 })
            case .trainer: comparison = compare(lhs.trainer.map { $0 ? 1 : 0 }, rhs.trainer.map { $0 ? 1 : 0 })
            case .manual: comparison = compare(lhs.manual.map { $0 ? 1 : 0 }, rhs.manual.map { $0 ? 1 : 0 })
            default:
                if speedDisplay != .speed && (field == .averageSpeed || field == .maxSpeed) {
                    comparison = compare(speedDisplay.paceSeconds(number(lhs)), speedDisplay.paceSeconds(number(rhs)))
                } else { comparison = compare(number(lhs), number(rhs)) }
            }
            return comparison == 0 ? lhs.id > rhs.id : comparison < 0
        }
    }

    // Unknowns are last in BOTH directions, before applying ID tie-breaking.
    private func compare<T: Comparable>(_ lhs: T?, _ rhs: T?) -> Int {
        switch (lhs, rhs) {
        case (nil, nil): return 0
        case (nil, _): return 1
        case (_, nil): return -1
        case let (lhs?, rhs?):
            let result = lhs == rhs ? 0 : lhs < rhs ? -1 : 1
            return direction == .ascending ? result : -result
        }
    }

    private func compareText(_ lhs: String?, _ rhs: String?) -> Int {
        // Foundation's String comparison uses canonical equivalence, not the
        // scalar order required by the contract. Compare normalized scalars.
        func scalars(_ value: String) -> [UInt32] {
            value.precomposedStringWithCanonicalMapping.lowercased().unicodeScalars.map(\.value)
        }
        guard let lhs else { return rhs == nil ? 0 : 1 }
        guard let rhs else { return -1 }
        let left = scalars(lhs), right = scalars(rhs)
        let result = left == right ? 0 : left.lexicographicallyPrecedes(right) ? -1 : 1
        return direction == .ascending ? result : -result
    }

    /// Explicit canonical state order, independent of translated labels.
    /// Ascending: summary, detailed, refresh_required. Descending reverses it.
    static func geometryRank(_ state: ActivityMapAPI.GeometryState) -> Int {
        switch state { case .summary: 0; case .detailed: 1; case .refreshRequired: 2 }
    }

    private func number(_ activity: Activity) -> Double? {
        let value: Double?
        switch field {
        case .distance: value = activity.distance
        case .averageSpeed: value = activity.averageSpeed
        case .maxSpeed: value = activity.maxSpeed
        case .elevationGain: value = activity.totalElevationGain
        case .elevationHigh: value = activity.elevHigh
        case .elevationLow: value = activity.elevLow
        case .averageHeartRate: value = activity.averageHeartrate
        case .maxHeartRate: value = activity.maxHeartrate
        case .averagePower: value = activity.averageWatts
        case .weightedPower: value = activity.weightedAverageWatts
        case .maxPower: value = activity.maxWatts
        case .calories: value = activity.calories
        case .kilojoules: value = activity.kilojoules
        default: value = nil
        }
        return value.flatMap { $0.isFinite ? $0 : nil }
    }
}

enum ActivityListMetric: String, CaseIterable, Codable, Identifiable {
    // Default hierarchy stays distance / elapsed duration / elevation gain.
    case distance, elapsedTime, elevationGain, movingTime, averageSpeed, maxSpeed
    case elevationHigh, elevationLow, averageHeartRate, maxHeartRate
    case averagePower, weightedPower, maxPower, calories, kilojoules
    case kudos, photos, geometry, id, description, commute, privacy, flagged, trainer, manual, achievements, comments
    var id: String { rawValue }
    var field: ActivitySortField {
        switch self {
        case .distance: .distance
        case .elapsedTime: .elapsedTime
        case .elevationGain: .elevationGain
        case .movingTime: .movingTime
        case .averageSpeed: .averageSpeed
        case .maxSpeed: .maxSpeed
        case .elevationHigh: .elevationHigh
        case .elevationLow: .elevationLow
        case .averageHeartRate: .averageHeartRate
        case .maxHeartRate: .maxHeartRate
        case .averagePower: .averagePower
        case .weightedPower: .weightedPower
        case .maxPower: .maxPower
        case .calories: .calories
        case .kilojoules: .kilojoules
        case .kudos: .kudos
        case .photos: .photos
        case .geometry: .geometry
        case .id: .id
        case .description: .description
        case .commute: .commute
        case .privacy: .privacy
        case .flagged: .flagged
        case .trainer: .trainer
        case .manual: .manual
        case .achievements: .achievements
        case .comments: .comments
        }
    }
    var title: String { field.title }
    func title(speedDisplay: SpeedDisplay, locale: Locale = .current) -> String { field.title(speedDisplay: speedDisplay, locale: locale) }
    func value(for activity: Activity, speedDisplay: SpeedDisplay = .speed, units: UnitSystem = .metric, locale: Locale = .current) -> String {
        switch self {
        case .distance: Formatters.distance(activity.distance, locale: locale, units: units)
        case .elapsedTime: Formatters.duration(activity.elapsedTime, locale: locale)
        case .elevationGain: Formatters.elevation(activity.totalElevationGain, locale: locale, units: units)
        case .movingTime: Formatters.duration(activity.movingTime, locale: locale)
        case .averageSpeed: speedDisplay.format(activity.averageSpeed, units: units, locale: locale)
        case .maxSpeed: speedDisplay.format(activity.maxSpeed, units: units, locale: locale)
        case .elevationHigh: Formatters.elevation(activity.elevHigh, locale: locale, units: units)
        case .elevationLow: Formatters.elevation(activity.elevLow, locale: locale, units: units)
        case .averageHeartRate: Formatters.heartrate(activity.averageHeartrate, locale: locale)
        case .maxHeartRate: Formatters.heartrate(activity.maxHeartrate, locale: locale)
        case .averagePower: Formatters.watts(activity.averageWatts, locale: locale)
        case .weightedPower: Formatters.watts(activity.weightedAverageWatts, locale: locale)
        case .maxPower: Formatters.watts(activity.maxWatts, locale: locale)
        case .calories: Formatters.number(activity.calories, decimals: 0, unit: "kcal", locale: locale)
        case .kilojoules: Formatters.number(activity.kilojoules, decimals: 0, unit: "kJ", locale: locale)
        case .kudos: activity.kudosCount.map { $0.formatted(.number.locale(locale)) } ?? Formatters.unknown
        case .photos: (activity.totalPhotoCount ?? activity.photoCount).map { $0.formatted(.number.locale(locale)) } ?? Formatters.unknown
        case .geometry:
            switch activity.geometryState { case .summary: String(localized: AppMessages.geometrySummary(locale: locale)); case .detailed: String(localized: AppMessages.geometryDetailed(locale: locale)); case .refreshRequired: String(localized: AppMessages.geometryRefreshRequired(locale: locale)) }
        case .id: String(activity.id)
        case .description: activity.description ?? Formatters.unknown
        case .commute: Self.flag(activity.commute, locale: locale)
        case .privacy: Self.flag(activity.isPrivate, locale: locale)
        case .flagged: Self.flag(activity.flagged, locale: locale)
        case .trainer: Self.flag(activity.trainer, locale: locale)
        case .manual: Self.flag(activity.manual, locale: locale)
        case .achievements: activity.achievementCount.map { $0.formatted(.number.locale(locale)) } ?? Formatters.unknown
        case .comments: activity.commentCount.map { $0.formatted(.number.locale(locale)) } ?? Formatters.unknown
        }
    }
    private static func flag(_ value: Bool?, locale: Locale) -> String { value.map { String(localized: $0 ? AppMessages.valueYes(locale: locale) : AppMessages.valueNo(locale: locale)) } ?? Formatters.unknown }
}

enum ActivityListDensity: String, CaseIterable, Codable, Identifiable {
    case compact, comfortable
    var id: String { rawValue }
    var title: String { self == .compact ? "Compact" : "Comfortable" }
}

enum ActivityListWidth: String, CaseIterable, Codable, Identifiable {
    // Retain the stored v1 values so existing device preferences migrate in place.
    case columns = "fitWidth", details = "scrollingMetrics"
    var id: String { rawValue }
    var title: String { self == .columns ? "Columns" : "Details" }
}

struct ActivityListSettings: Codable, Equatable {
    var sort = ActivityListSort()
    var visibleMetrics: Set<ActivityListMetric> = [.distance, .elapsedTime, .elevationGain]
    var density: ActivityListDensity = .comfortable
    var width: ActivityListWidth = .columns
    var summaryMode: ActivitySummaryMode = .off

    init() {}
    private enum CodingKeys: String, CodingKey { case sort, visibleMetrics, density, width, summaryMode }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        sort = try values.decodeIfPresent(ActivityListSort.self, forKey: .sort) ?? ActivityListSort()
        visibleMetrics = try values.decodeIfPresent(Set<ActivityListMetric>.self, forKey: .visibleMetrics)
            ?? [.distance, .elapsedTime, .elevationGain]
        density = try values.decodeIfPresent(ActivityListDensity.self, forKey: .density) ?? .comfortable
        width = try values.decodeIfPresent(ActivityListWidth.self, forKey: .width) ?? .columns
        // Preserve all existing #211 preferences when decoding its v1 payload.
        summaryMode = try values.decodeIfPresent(ActivitySummaryMode.self, forKey: .summaryMode) ?? .off
    }

    var orderedMetrics: [ActivityListMetric] { ActivityListMetric.allCases.filter { visibleMetrics.contains($0) } }
}

/// Device display preferences survive navigation and app restarts. Selection,
/// inspection and scroll position remain account-specific in the retained List.
@Observable
final class ActivityListPresentation {
    static let defaultsKey = "activitymap.list.presentation.v1"
    private let defaults: UserDefaults?
    var settings: ActivityListSettings {
        didSet {
            if let defaults, let data = try? JSONEncoder().encode(settings) {
                defaults.set(data, forKey: Self.defaultsKey)
            }
        }
    }

    // Transient: the shell's landscape bar and the List open the same sheets.
    var sortOpen = false
    var displayOpen = false

    init(defaults: UserDefaults? = .standard) {
        self.defaults = defaults
        settings = defaults?.data(forKey: Self.defaultsKey)
            .flatMap { try? JSONDecoder().decode(ActivityListSettings.self, from: $0) } ?? ActivityListSettings()
    }
}

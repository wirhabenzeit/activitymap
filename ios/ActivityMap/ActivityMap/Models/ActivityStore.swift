import Foundation
import Observation

enum AppTab: CaseIterable, Hashable {
    case map, list

    var title: String {
        switch self {
        case .map: "Map"
        case .list: "List"
        }
    }
}

enum FilterOperator: String {
    case gte = ">="
    case lte = "<="
}

struct NumericFilter: Equatable {
    var operatorType: FilterOperator = .gte
    var value: Double = 0
}

@Observable
final class ActivityStore {
    var activities: [Activity] = SampleData.activities

    var activeCategories: Set<ActivityCategory> = Set(ActivityCategory.allCases)
    var activeSportTypes: Set<SportType> = Set(SportType.allCases)

    var dateRange: ClosedRange<Date>?
    var distanceFilter: NumericFilter?
    var elevationFilter: NumericFilter?
    var durationFilter: NumericFilter?
    var commuteOnly: Bool?

    var selectedTab: AppTab = .map
    var sidebarExpanded = false
    var highlightedActivityID: Int?
    var selectedActivityIDs: Set<Int> = []

    var filteredActivities: [Activity] {
        activities.filter { activity in
            guard activeCategories.contains(activity.category) else { return false }
            guard activeSportTypes.contains(activity.sportType) else { return false }

            if let dateRange, !dateRange.contains(activity.startDate) { return false }

            if let distanceFilter, !matches(distanceFilter, activity.distance) { return false }
            if let elevationFilter, !matches(elevationFilter, activity.totalElevationGain) { return false }
            if let durationFilter, !matches(durationFilter, Double(activity.elapsedTime)) { return false }

            if let commuteOnly, activity.commute != commuteOnly { return false }

            return true
        }
    }

    var activeFilterCount: Int {
        var count = activeCategories == Set(ActivityCategory.allCases) ? 0 : 1
        count += activeSportTypes == Set(SportType.allCases) ? 0 : 1
        count += dateRange == nil ? 0 : 1
        count += distanceFilter == nil ? 0 : 1
        count += elevationFilter == nil ? 0 : 1
        count += durationFilter == nil ? 0 : 1
        count += commuteOnly == nil ? 0 : 1
        return count
    }

    private func matches(_ filter: NumericFilter, _ value: Double) -> Bool {
        switch filter.operatorType {
        case .gte: return value >= filter.value
        case .lte: return value <= filter.value
        }
    }

    func toggleCategory(_ category: ActivityCategory) {
        if activeCategories.contains(category) {
            activeCategories.remove(category)
        } else {
            activeCategories.insert(category)
        }
    }

    func isolateCategory(_ category: ActivityCategory) {
        activeCategories = [category]
    }

    func showAllCategories() {
        activeCategories = Set(ActivityCategory.allCases)
    }

    func resetFilters() {
        activeCategories = Set(ActivityCategory.allCases)
        activeSportTypes = Set(SportType.allCases)
        dateRange = nil
        distanceFilter = nil
        elevationFilter = nil
        durationFilter = nil
        commuteOnly = nil
    }

    func toggleSportType(_ sportType: SportType) {
        if activeSportTypes.contains(sportType) {
            activeSportTypes.remove(sportType)
        } else {
            activeSportTypes.insert(sportType)
        }
    }

    func toggleSelection(_ activityID: Int) {
        if selectedActivityIDs.contains(activityID) {
            selectedActivityIDs.remove(activityID)
        } else {
            selectedActivityIDs.insert(activityID)
        }
    }
}

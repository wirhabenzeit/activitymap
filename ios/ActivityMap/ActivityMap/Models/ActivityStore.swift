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
    var activities: [Activity] {
        didSet {
            activitiesRevision &+= 1
            reconcileSelectionWithActivities()
        }
    }

    /// Bumped on every `activities` assignment so views can rebuild derived
    /// data (e.g. the map's route source) only when the activities change.
    private(set) var activitiesRevision = 0

    @ObservationIgnored let routeGeometry = RouteGeometryCache()

    init(activities: [Activity] = []) {
        self.activities = activities
        selection.setVisible(Set(filteredActivities.map(\.id)))
    }

    /// The sync coordinator will call this after a committed sync pass.
    func load(from store: LocalStore, scope: StoreScope) async throws {
        let snapshot = try await store.snapshot(scope: scope)
        activities = try snapshot.activities.map(StoredModelMapper.activity)
    }

    // Every filter change reconciles selection visibility: hidden selections
    // stay selected, but a hidden active route or list detail is closed.
    var activeCategories: Set<ActivityCategory> = Set(ActivityCategory.allCases) {
        didSet { reconcileSelectionVisibility() }
    }
    var activeSportTypes: Set<SportType> = Set(SportType.allCases) {
        didSet { reconcileSelectionVisibility() }
    }

    var dateRange: ClosedRange<Date>? = nil {
        didSet { reconcileSelectionVisibility() }
    }
    var distanceFilter: NumericFilter? = nil {
        didSet { reconcileSelectionVisibility() }
    }
    var elevationFilter: NumericFilter? = nil {
        didSet { reconcileSelectionVisibility() }
    }
    var durationFilter: NumericFilter? = nil {
        didSet { reconcileSelectionVisibility() }
    }
    var commuteOnly: Bool? = nil {
        didSet { reconcileSelectionVisibility() }
    }

    /// Switching tabs never changes selection, focus or list inspection.
    var selectedTab: AppTab = .map
    var sidebarExpanded = false

    /// Mutate only through the operations below so the parity invariants hold.
    private(set) var selection = SelectionState()

    var selectedActivityIDs: Set<Int> { selection.selectedIDs }
    /// The selected, filter-visible activity emphasised on the map.
    var activeActivityID: Int? { selection.activeID }
    /// The list detail opened independently of selection.
    var inspectedActivityID: Int? { selection.inspectedID }
    var hiddenSelectedCount: Int { selection.hiddenSelectedCount }

    var inspectedActivity: Activity? {
        guard let id = selection.inspectedID else { return nil }
        return activities.first { $0.id == id }
    }

    var filteredActivities: [Activity] {
        // DatePicker values carry the user's chosen calendar components;
        // activity-local timestamps carry theirs in UTC-shaped encoding.
        let lowerDay = dateRange.map { Formatters.dayKey($0.lowerBound, timeZone: .current) }
        let upperDay = dateRange.map { Formatters.dayKey($0.upperBound, timeZone: .current) }
        return activities.filter { activity in
            guard activeCategories.contains(activity.category) else { return false }
            guard activeSportTypes.contains(activity.sportType) else { return false }

            if let lowerDay, let upperDay,
               !(lowerDay...upperDay).contains(activity.localDayKey) { return false }

            if let distanceFilter, !matches(distanceFilter, activity.distance) { return false }
            if let elevationFilter, !matches(elevationFilter, activity.totalElevationGain) { return false }
            if let durationFilter, !matches(durationFilter, activity.elapsedTime.map(Double.init)) { return false }

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

    private func matches(_ filter: NumericFilter, _ value: Double?) -> Bool {
        guard let value, value.isFinite else { return false }
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

    // MARK: Selection (docs/map-list-parity-contract.md)

    /// Replace the selection with the given existing activities.
    func replaceSelection(with activityIDs: some Sequence<Int>) {
        selection.replaceSelection(with: existing(activityIDs))
    }

    func addToSelection(_ activityIDs: some Sequence<Int>) {
        selection.addToSelection(existing(activityIDs))
    }

    func removeFromSelection(_ activityIDs: some Sequence<Int>) {
        selection.removeFromSelection(activityIDs)
    }

    func toggleSelection(_ activityID: Int) {
        if selection.selectedIDs.contains(activityID) {
            selection.removeFromSelection([activityID])
        } else if activityIndex.contains(activityID) {
            selection.addToSelection([activityID])
        }
    }

    /// Adds every filtered activity to the selection, keeping hidden ones.
    func selectAllFiltered() { selection.selectAllVisible() }

    /// Removes every filtered activity from the selection, keeping hidden ones.
    func deselectAllFiltered() { selection.deselectAllVisible() }

    /// Clears the whole selection, including filter-hidden activities.
    func clearSelection() { selection.clearSelection() }

    func activate(_ activityID: Int) { selection.activate(activityID) }

    func inspect(_ activityID: Int) { selection.inspect(activityID) }

    func dismissInspection() { selection.dismissInspection() }

    /// Selects and activates the activity, then switches to the map.
    /// GPS-less and filter-hidden activities leave all state unchanged.
    @discardableResult
    func showOnMap(_ activityID: Int) -> SelectionState.ShowOnMapOutcome {
        guard let activity = activities.first(where: { $0.id == activityID }) else {
            return .notFound
        }
        let outcome = selection.showOnMap(activityID, hasGeometry: !activity.coordinates.isEmpty)
        if outcome == .shown { selectedTab = .map }
        return outcome
    }

    /// Logout, account or deployment transition.
    func clearScope() {
        activities = []
        routeGeometry.update(activities: [], revision: activitiesRevision)
        selection.clearScope()
    }

    private var activityIndex: Set<Int> { Set(activities.map(\.id)) }

    private func existing(_ activityIDs: some Sequence<Int>) -> [Int] {
        let known = activityIndex
        return activityIDs.filter { known.contains($0) }
    }

    private func reconcileSelectionVisibility() {
        selection.setVisible(Set(filteredActivities.map(\.id)))
    }

    /// Reconcile removals and filter eligibility as one committed snapshot.
    private func reconcileSelectionWithActivities() {
        selection.reconcileActivities(
            existingIDs: activityIndex,
            visibleIDs: Set(filteredActivities.map(\.id))
        )
    }
}

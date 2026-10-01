import CoreLocation
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
    @ObservationIgnored let summaryCache = ActivitySummaryCache()
    @ObservationIgnored private var activityLookupRevision: Int?
    @ObservationIgnored private var activityLookup: [Int: Activity] = [:]

    /// Identity lookup does not filter or scan the library during sheet frames.
    /// Read the observable revision even on a cache hit so open details stay live.
    func activity(id: Int) -> Activity? {
        if activityLookupRevision != activitiesRevision {
            activityLookup = Dictionary(uniqueKeysWithValues: activities.map { ($0.id, $0) })
            activityLookupRevision = activitiesRevision
        }
        return activityLookup[id]
    }
    @ObservationIgnored private var routeAvailabilityRevision: Int?
    @ObservationIgnored private var routeAvailabilityIDs: Set<Int> = []

    /// Browsing status needs only drawable-route availability, not geographic
    /// bounds. Validate at most two vertices per route once per activity revision;
    /// filter/status/selection renders then compare IDs without sorting vertices.
    var routableActivityIDs: Set<Int> {
        if routeAvailabilityRevision != activitiesRevision {
            routeAvailabilityIDs = Set(activities.filter { activity in
                activity.coordinates.lazy.filter {
                    $0.latitude.isFinite && $0.longitude.isFinite
                        && (-90...90).contains($0.latitude) && (-180...180).contains($0.longitude)
                }.prefix(2).count == 2
            }.map(\.id))
            routeAvailabilityRevision = activitiesRevision
        }
        return routeAvailabilityIDs
    }
    let mapContext = MapContext()
    let listPresentation: ActivityListPresentation

    init(activities: [Activity] = [], listPresentation: ActivityListPresentation = ActivityListPresentation()) {
        self.listPresentation = listPresentation
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
    // Groups are derived from the checked sports; there is no second category
    // predicate that can hide an individually checked sport.
    var activeCategories: Set<ActivityCategory> {
        get { Set(activeSportTypes.map(\.category)) }
        set { activeSportTypes = Set(newValue.flatMap(\.sportTypes)) }
    }
    var searchText = "" {
        didSet { reconcileSelectionVisibility() }
    }
    var activeSportTypes: Set<SportType> = Set(SportType.allCases) {
        didSet { reconcileSelectionVisibility() }
    }

    var dateDayRange: ActivityDayRange? = nil {
        didSet { reconcileSelectionVisibility() }
    }
    /// Compatibility for DatePicker callers. Convert at assignment time so a
    /// later timezone change cannot move the chosen calendar-day boundaries.
    /// Filter state was not persisted before day keys were introduced.
    var dateRange: ClosedRange<Date>? {
        get { dateDayRange?.pickerRange() }
        set {
            dateDayRange = newValue.flatMap {
                ActivityDayRange(start: $0.lowerBound, end: $0.upperBound)
            }
        }
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
    var privateFilter: Bool? = nil {
        didSet { reconcileSelectionVisibility() }
    }
    var flaggedFilter: Bool? = nil {
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
        let query = Self.normalizedSearch(searchText.trimmingCharacters(in: .whitespacesAndNewlines))
        return activities.filter { activity in
            if !query.isEmpty, !Self.normalizedSearch(activity.name).contains(query) { return false }
            guard activeSportTypes.contains(activity.sportType) else { return false }

            if let dateDayRange, !dateDayRange.contains(activity.localDayKey) { return false }

            if let distanceFilter, !matches(distanceFilter, activity.distance) { return false }
            if let elevationFilter, !matches(elevationFilter, activity.totalElevationGain) { return false }
            if let durationFilter, !matches(durationFilter, activity.elapsedTime.map(Double.init)) { return false }

            if let commuteOnly, activity.commute != commuteOnly { return false }
            if let privateFilter, activity.isPrivate != privateFilter { return false }
            if let flaggedFilter, activity.flagged != flaggedFilter { return false }

            return true
        }
    }

    /// Sort is a list presentation concern; shared filter order stays intact.
    var listedActivities: [Activity] { listPresentation.settings.sort.sorted(filteredActivities) }

    var activitySummary: ActivitySummary? {
        let mode = listPresentation.settings.summaryMode
        let ids = mode == .selected ? selection.selectedIDs : selection.visibleIDs
        return summaryCache.summary(mode: mode, revision: activitiesRevision, activities: activities, ids: ids)
    }

    var activeFilterCount: Int {
        var count = searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0 : 1
        count += activeSportTypes == Set(SportType.allCases) ? 0 : 1
        count += dateDayRange == nil ? 0 : 1
        count += distanceFilter == nil ? 0 : 1
        count += elevationFilter == nil ? 0 : 1
        count += durationFilter == nil ? 0 : 1
        count += commuteOnly == nil ? 0 : 1
        count += privateFilter == nil ? 0 : 1
        count += flaggedFilter == nil ? 0 : 1
        return count
    }

    private func matches(_ filter: NumericFilter, _ value: Double?) -> Bool {
        guard let value, value.isFinite, filter.value.isFinite else { return false }
        switch filter.operatorType {
        case .gte: return value >= filter.value
        case .lte: return value <= filter.value
        }
    }

    private static func normalizedSearch(_ text: String) -> String {
        text.precomposedStringWithCanonicalMapping.lowercased()
    }

    func categorySelection(_ category: ActivityCategory) -> SportGroupSelection {
        let selected = activeSportTypes.intersection(category.sportTypes)
        if selected.isEmpty { return .none }
        return selected.count == category.sportTypes.count ? .all : .mixed
    }

    func toggleCategory(_ category: ActivityCategory) {
        let members = Set(category.sportTypes)
        activeSportTypes = categorySelection(category) == .all
            ? activeSportTypes.subtracting(members)
            : activeSportTypes.union(members)
    }

    func isolateCategory(_ category: ActivityCategory) {
        activeCategories = [category]
    }

    func showAllCategories() {
        activeCategories = Set(ActivityCategory.allCases)
    }

    private(set) var filterResetRevision = 0

    func resetFilters() {
        filterResetRevision &+= 1
        searchText = ""
        activeSportTypes = Set(SportType.allCases)
        dateDayRange = nil
        distanceFilter = nil
        elevationFilter = nil
        durationFilter = nil
        commuteOnly = nil
        privateFilter = nil
        flaggedFilter = nil
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
        let hasGeometry = RouteExtent(coordinates: activity.coordinates) != nil
        let outcome = selection.showOnMap(activityID, hasGeometry: hasGeometry)
        if outcome == .shown {
            mapContext.hiddenTargetID = nil
            mapContext.request(.activity(activityID))
            selectedTab = .map
        } else if outcome == .hiddenByFilters {
            mapContext.hiddenTargetID = activityID
        }
        return outcome
    }

    func clearFiltersAndShowOnMap(_ activityID: Int) {
        mapContext.hiddenTargetID = nil
        guard let activity = activities.first(where: { $0.id == activityID }),
              RouteExtent(coordinates: activity.coordinates) != nil else { return }
        resetFilters()
        showOnMap(activityID)
    }

    /// Logout, account or deployment transition.
    func clearScope() {
        summaryCache.clear()
        activities = []
        routeGeometry.update(activities: [], revision: activitiesRevision)
        selection.clearScope()
        mapContext.clearScope()
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

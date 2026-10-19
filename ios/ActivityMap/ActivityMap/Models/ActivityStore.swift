import CoreLocation
import Foundation
import Observation

enum AppTab: CaseIterable, Hashable {
    case map, list, stats

    static func available(stats: Bool) -> [AppTab] { stats ? [.map, .list, .stats] : [.map, .list] }

    var title: String {
        switch self {
        case .map: "Map"
        case .list: "List"
        case .stats: "Stats"
        }
    }
}

nonisolated enum FilterOperator: String, Hashable, Sendable {
    case gte = ">="
    case lte = "<="
}

nonisolated struct NumericFilter: Hashable, Sendable {
    var operatorType: FilterOperator = .gte
    var value: Double = 0
    var upperLimit: Double? = nil

    var minimum: Double? { operatorType == .gte ? value : nil }
    var maximum: Double? { operatorType == .lte ? value : upperLimit }
}

/// Ordinary browsing filters are one value so a user intent can publish and
/// reconcile its final predicates once. Selected-only scope stays in the reducer.
struct ActivityFilterState: Equatable {
    var searchText = ""
    var activeSportTypes = Set(SportType.allCases)
    var dateDayRange: ActivityDayRange?
    var distanceFilter: NumericFilter?
    var elevationFilter: NumericFilter?
    var durationFilter: NumericFilter?
    var commuteOnly: Bool?
    var privateFilter: Bool?
    var flaggedFilter: Bool?
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
    private var filterRevision = 0
    @ObservationIgnored private var filteredSnapshot: (data: Int, filters: Int, activities: [Activity])?
    @ObservationIgnored private var listedSnapshot: (data: Int, filters: Int, sort: ActivityListSort, selected: Set<Int>?, restricted: Bool, activities: [Activity])?
    @ObservationIgnored private(set) var filterBuildCount = 0
    @ObservationIgnored private(set) var sortBuildCount = 0
    @ObservationIgnored private(set) var selectionReconciliationCount = 0
    @ObservationIgnored private(set) var activityLookupBuildCount = 0

    @ObservationIgnored let routeGeometry = RouteGeometryCache()
    @ObservationIgnored let summaryCache = ActivitySummaryCache()
    let stats: StatsController
    @ObservationIgnored private var activityLookupRevision: Int?
    @ObservationIgnored private var activityLookup: [Int: Activity] = [:]
    @ObservationIgnored private var activityLookupIDs: Set<Int> = []

    /// Identity lookup does not filter or scan the library during sheet frames.
    /// Read the observable revision even on a cache hit so open details stay live.
    func activity(id: Int) -> Activity? {
        refreshActivityLookup()
        return activityLookup[id]
    }

    private func refreshActivityLookup() {
        guard activityLookupRevision != activitiesRevision else { return }
        activityLookup = Dictionary(uniqueKeysWithValues: activities.map { ($0.id, $0) })
        activityLookupIDs = Set(activityLookup.keys)
        activityLookupRevision = activitiesRevision
        activityLookupBuildCount += 1
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
    private(set) var photosRevision = 0
    var photos: [Photo] = [] { didSet { photosRevision += 1 } }
    let photoImages: PhotoImageCache
    var streamSummaries: StreamSummaryLoader?
    var activityEditing: ActivityEditingService?
    var elevationCursor: ElevationCursor?
    /// The profile whose chart is being dragged. Only an active drag suspends
    /// pager paging; an accessibility-adjusted cursor must not.
    var elevationScrubOwner: UUID?
    let mapContext = MapContext()
    let listPresentation: ActivityListPresentation

    init(activities: [Activity] = [], listPresentation: ActivityListPresentation = ActivityListPresentation(), stats: StatsController = StatsController(), photoImages: PhotoImageCache = PhotoImageCache()) {
        self.photoImages = photoImages
        self.stats = stats
        self.listPresentation = listPresentation
        self.activities = activities
        selection.setVisible(Set(filteredActivities.map(\.id)))
        publishSelectionSnapshot()
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
    private var filters = ActivityFilterState()

    // Keep the existing SwiftUI bindings. Equality is checked before the single
    // observable value is assigned, including mutations via Set insert/remove.
    var searchText: String {
        get { filters.searchText }
        set { updateFilters { $0.searchText = newValue } }
    }
    var activeSportTypes: Set<SportType> {
        get { filters.activeSportTypes }
        set { updateFilters { $0.activeSportTypes = newValue } }
    }
    var dateDayRange: ActivityDayRange? {
        get { filters.dateDayRange }
        set { updateFilters { $0.dateDayRange = newValue } }
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
    var distanceFilter: NumericFilter? {
        get { filters.distanceFilter }
        set { updateFilters { $0.distanceFilter = newValue } }
    }
    var elevationFilter: NumericFilter? {
        get { filters.elevationFilter }
        set { updateFilters { $0.elevationFilter = newValue } }
    }
    var durationFilter: NumericFilter? {
        get { filters.durationFilter }
        set { updateFilters { $0.durationFilter = newValue } }
    }
    var commuteOnly: Bool? {
        get { filters.commuteOnly }
        set { updateFilters { $0.commuteOnly = newValue } }
    }
    var privateFilter: Bool? {
        get { filters.privateFilter }
        set { updateFilters { $0.privateFilter = newValue } }
    }
    var flaggedFilter: Bool? {
        get { filters.flaggedFilter }
        set { updateFilters { $0.flaggedFilter = newValue } }
    }

    /// Edit a copy and publish only the final value. No-op edits neither notify
    /// filter observers nor invalidate the library/selection snapshots.
    func updateFilters(_ update: (inout ActivityFilterState) throws -> Void) rethrows {
        var next = filters
        try update(&next)
        applyFilters(next)
    }

    /// Stats ends Combine; tab changes preserve the group, scope and inspection.
    var selectedTab: AppTab = .map {
        didSet { if selectedTab == .stats { selection.setCombine(false) } }
    }

    /// Mutate only through the operations below so the parity invariants hold.
    private(set) var selection = SelectionState() {
        didSet { publishSelectionSnapshot() }
    }

    // The reducer includes inspection, but map/row selection observers must not.
    // Publish only when group, eligibility, focus or flags actually change; otherwise native
    // detail dismissal also redraws the retained map and its route filters.
    private struct SelectionSnapshot: Equatable {
        var selected: Set<Int> = []
        var visible: Set<Int> = []
        var active: Int? = nil
        var combine = false
        var onlySelected = false
    }
    private var selectionSnapshot = SelectionSnapshot()

    private func publishSelectionSnapshot() {
        let snapshot = SelectionSnapshot(selected: selection.selectedIDs,
                                         visible: selection.visibleIDs, active: selection.activeID, combine: selection.combine, onlySelected: selection.onlySelected)
        if snapshot != selectionSnapshot { selectionSnapshot = snapshot }
    }

    var selectedActivityIDs: Set<Int> { selectionSnapshot.selected }
    var ordinaryVisibleActivityIDs: Set<Int> { selectionSnapshot.visible }
    var visibleActivityIDs: Set<Int> { onlySelected ? selectedActivityIDs.intersection(ordinaryVisibleActivityIDs) : ordinaryVisibleActivityIDs }
    var isCombining: Bool { selectionSnapshot.combine }
    var onlySelected: Bool { selectionSnapshot.onlySelected }
    func setCombine(_ enabled: Bool) { selection.setCombine(enabled) }
    func setOnlySelected(_ enabled: Bool) { selection.setOnlySelected(enabled) }
    func pickActivities(_ ids: some Sequence<Int>) { selection.pick(existing(ids)) }
    func toggleMember(_ id: Int) { if activityIndex.contains(id) { selection.toggleMember(id) } }
    var browsingActivities: [Activity] { onlySelected ? filteredActivities.filter { selectedActivityIDs.contains($0.id) } : filteredActivities }
    var visibleSelectedActivityIDs: Set<Int> { selectedActivityIDs.intersection(visibleActivityIDs) }
    /// The selected, filter-visible activity emphasised on the map.
    var activeActivityID: Int? { selectionSnapshot.active }
    /// The list detail opened independently of selection.
    var inspectedActivityID: Int? { selection.inspectedID }
    var hiddenSelectedCount: Int { selectedActivityIDs.subtracting(ordinaryVisibleActivityIDs).count }

    var inspectedActivity: Activity? {
        guard let id = selection.inspectedID else { return nil }
        return activity(id: id)
    }

    var filteredActivities: [Activity] {
        // Read observable keys on cache hits too. Inspection/selection changes
        // do not invalidate this snapshot; all filter setters bump the key.
        let data = activitiesRevision, filters = filterRevision
        if let cached = filteredSnapshot, cached.data == data, cached.filters == filters { return cached.activities }
        let query = Self.normalizedSearch(searchText.trimmingCharacters(in: .whitespacesAndNewlines))
        let result = activities.filter { matchesFilters($0, query: query, includeDate: true) }
        filteredSnapshot = (data, filters, result)
        filterBuildCount += 1
        return result
    }

    /// Full authorized metadata; map/list dates and selection never narrow Stats.
    var statsActivities: [Activity] {
        let query = Self.normalizedSearch(searchText.trimmingCharacters(in: .whitespacesAndNewlines))
        return activities.filter { matchesFilters($0, query: query, includeDate: false) }
    }

    private func matchesFilters(_ activity: Activity, query: String, includeDate: Bool) -> Bool {
        if !query.isEmpty, !Self.normalizedSearch(activity.name).contains(query) { return false }
        guard activeSportTypes.contains(activity.sportType) else { return false }

        if includeDate, let dateDayRange, !dateDayRange.contains(activity.localDayKey) { return false }

        if let distanceFilter, !matches(distanceFilter, activity.distance) { return false }
        if let elevationFilter, !matches(elevationFilter, activity.totalElevationGain) { return false }
        if let durationFilter, !matches(durationFilter, activity.elapsedTime.map(Double.init)) { return false }

        if let commuteOnly, activity.commute != commuteOnly { return false }
        if let privateFilter, activity.isPrivate != privateFilter { return false }
        if let flaggedFilter, activity.flagged != flaggedFilter { return false }

        return true
    }

    /// Sort is a list presentation concern; shared filter order stays intact.
    var listedActivities: [Activity] {
        let data = activitiesRevision, filters = filterRevision, sort = listPresentation.settings.sort
        let selected = sort.field == .selection || onlySelected ? selectedActivityIDs : nil
        if let cached = listedSnapshot, cached.data == data, cached.filters == filters, cached.sort == sort, cached.selected == selected, cached.restricted == onlySelected {
            return cached.activities
        }
        let result = sort.sorted(browsingActivities, selectedIDs: selected ?? [], speedDisplay: SpeedDisplay.forActivities(browsingActivities))
        listedSnapshot = (data, filters, sort, selected, onlySelected, result)
        sortBuildCount += 1
        return result
    }

    var activitySummary: ActivitySummary? {
        let mode = listPresentation.settings.summaryMode
        let ids = mode == .selected ? selection.selectedIDs : visibleActivityIDs
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
        return count + (onlySelected ? 1 : 0)
    }

    var activeStatsFilterCount: Int { activeFilterCount - (dateDayRange == nil ? 0 : 1) - (onlySelected ? 1 : 0) }

    private func matches(_ filter: NumericFilter, _ value: Double?) -> Bool {
        guard let value, value.isFinite, filter.value.isFinite else { return false }
        if let minimum = filter.minimum, value < minimum { return false }
        if let maximum = filter.maximum {
            guard maximum.isFinite, maximum >= (filter.minimum ?? 0), value <= maximum else { return false }
        }
        return true
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
        // Reset commands must still discard unapplied numeric/date drafts when
        // all committed predicates are already clear. This UI-only revision is
        // intentionally independent of filtering and selection reconciliation.
        filterResetRevision &+= 1
        applyFilters(ActivityFilterState(), resetSelectedOnly: true)
    }

    /// Preserve saved browsing dates, selected-only scope, Combine, selected
    /// IDs, inspection, camera and list context; clear only Stats predicates.
    func resetStatsActivityFilters() {
        filterResetRevision &+= 1
        var next = ActivityFilterState()
        next.dateDayRange = filters.dateDayRange
        applyFilters(next)
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
    func selectAllFiltered() { guard isCombining, !onlySelected else { return }; selection.selectAllVisible() }

    /// Removes every filtered activity from the selection, keeping hidden ones.
    func deselectAllFiltered() { guard isCombining else { return }; selection.deselectAllVisible() }

    /// Clears the whole selection, including filter-hidden activities.
    func clearSelection() { selection.clearSelection() }

    func activate(_ activityID: Int) { selection.activate(activityID) }

    func toggleActive(_ activityID: Int) { selection.toggleActive(activityID) }

    func inspect(_ activityID: Int) { selection.inspect(activityID) }

    func dismissInspection() { selection.dismissInspection() }

    /// The renderer's valid two-vertex route capability is shared by every map action.
    func canShowOnMap(_ activityID: Int) -> Bool { routableActivityIDs.contains(activityID) }

    /// Selects and activates the activity, then switches to the map.
    /// GPS-less and filter-hidden activities leave all state unchanged.
    @discardableResult
    func showOnMap(_ activityID: Int) -> SelectionState.ShowOnMapOutcome {
        guard activity(id: activityID) != nil else {
            return .notFound
        }
        let hasGeometry = canShowOnMap(activityID)
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
        guard canShowOnMap(activityID) else { return }
        resetFilters()
        showOnMap(activityID)
    }

    /// Logout, account or deployment transition.
    func clearScope() {
        photos = []
        photoImages.reset()
        elevationCursor = nil
        elevationScrubOwner = nil
        stats.clearScope()
        summaryCache.clear()
        filteredSnapshot = nil
        listedSnapshot = nil
        activityLookup = [:]
        activityLookupIDs = []
        activityLookupRevision = nil
        activities = []
        routeGeometry.update(activities: [], revision: activitiesRevision)
        selection.clearScope()
        mapContext.clearScope()
    }

    private var activityIndex: Set<Int> {
        refreshActivityLookup()
        return activityLookupIDs
    }

    private func existing(_ activityIDs: some Sequence<Int>) -> [Int] {
        let known = activityIndex
        return activityIDs.filter { known.contains($0) }
    }

    private func applyFilters(_ next: ActivityFilterState, resetSelectedOnly: Bool = false) {
        let changed = filters != next
        guard changed || (resetSelectedOnly && selection.onlySelected) else { return }
        if changed {
            filters = next
            filterRevision &+= 1
        }
        // Reset scope before validating inspection against the final visibility.
        // Work on a copy so one reset publishes one reducer snapshot.
        var nextSelection = selection
        if resetSelectedOnly { nextSelection.setOnlySelected(false) }
        if changed {
            selectionReconciliationCount += 1
            nextSelection.setVisible(Set(filteredActivities.map(\.id)))
        }
        if nextSelection != selection { selection = nextSelection }
    }

    /// Reconcile removals and filter eligibility as one committed snapshot.
    private func reconcileSelectionWithActivities() {
        selectionReconciliationCount += 1
        var next = selection
        next.reconcileActivities(
            existingIDs: activityIndex,
            visibleIDs: Set(filteredActivities.map(\.id))
        )
        if next != selection { selection = next }
    }
}

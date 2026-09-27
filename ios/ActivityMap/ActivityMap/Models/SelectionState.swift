import Foundation

/// Selected, active and inspected activity state, following the shared
/// map/list parity contract (`docs/map-list-parity-contract.md`).
///
/// - `selectedIDs` is a set of activities that can include filter-hidden ones.
/// - `activeID` is the one selected, filter-visible activity emphasised on the
///   map, or nil. It is never outside `selectedIDs ∩ visibleIDs`.
/// - `inspectedID` is the independently opened list detail. Inspecting or
///   dismissing it never changes selection or the active activity.
///
/// All transitions are pure so they can be checked against
/// `shared/parity/state-fixtures.v1.json` without Mapbox or SwiftUI.
nonisolated struct SelectionState: Equatable, Sendable {
    private(set) var selectedIDs: Set<Int> = []
    private(set) var activeID: Int?
    private(set) var inspectedID: Int?
    /// IDs passing the shared activity filter (not the camera bounds).
    private(set) var visibleIDs: Set<Int> = []

    init(
        selectedIDs: Set<Int> = [],
        activeID: Int? = nil,
        inspectedID: Int? = nil,
        visibleIDs: Set<Int> = []
    ) {
        self.selectedIDs = selectedIDs
        self.visibleIDs = visibleIDs
        self.inspectedID = inspectedID.flatMap { visibleIDs.contains($0) ? $0 : nil }
        self.activeID = activeID.flatMap { selectedIDs.contains($0) && visibleIDs.contains($0) ? $0 : nil }
    }

    enum ShowOnMapOutcome: Equatable, Sendable {
        case shown
        /// The activity has no route to frame; state is unchanged.
        case noGeometry
        /// The activity is hidden by the current filters; state is unchanged.
        /// Callers may offer an explicit "Clear filters and show on map".
        case hiddenByFilters
        /// The ID is not a loaded activity; state is unchanged.
        case notFound
    }

    /// Selected IDs that currently pass the filter, i.e. what the results show.
    var visibleSelectedIDs: Set<Int> { selectedIDs.intersection(visibleIDs) }

    /// Selected IDs hidden by the current filters ("H hidden by filters").
    var hiddenSelectedCount: Int { selectedIDs.subtracting(visibleIDs).count }

    // MARK: Selection

    /// Replace the selection. A sole visible result becomes active.
    mutating func replaceSelection(with ids: some Sequence<Int>) {
        selectedIDs = Set(ids)
        let candidates = visibleSelectedIDs
        if candidates.count == 1 {
            activeID = candidates.first
        } else {
            retainActiveIfStillValid()
        }
    }

    /// Union into the selection. Adding alone never activates a result.
    mutating func addToSelection(_ ids: some Sequence<Int>) {
        selectedIDs.formUnion(ids)
        retainActiveIfStillValid()
    }

    /// Subtract from the selection. If that changed the selection and exactly
    /// one visible selected ID remains, it becomes active.
    mutating func removeFromSelection(_ ids: some Sequence<Int>) {
        let previous = selectedIDs
        selectedIDs.subtract(ids)
        applyRemovalRule(selectionChanged: selectedIDs != previous)
    }

    /// Add if unselected, otherwise remove, using the matching rule.
    mutating func toggleSelection(_ id: Int) {
        if selectedIDs.contains(id) {
            removeFromSelection([id])
        } else {
            addToSelection([id])
        }
    }

    /// "Select all filtered activities": union with the visible scope.
    mutating func selectAllVisible() {
        addToSelection(visibleIDs)
    }

    /// "Deselect all filtered activities": subtract only the visible scope,
    /// keeping filter-hidden selections.
    mutating func deselectAllVisible() {
        removeFromSelection(visibleIDs)
    }

    /// Global clear, including filter-hidden selections. List inspection stays.
    mutating func clearSelection() {
        selectedIDs = []
        activeID = nil
    }

    // MARK: Active map activity

    /// Focus a selected, visible result. An invalid activation clears focus
    /// without selecting anything.
    mutating func activate(_ id: Int) {
        activeID = selectedIDs.contains(id) && visibleIDs.contains(id) ? id : nil
    }

    /// The explicit exception to passive addition: add the target to the
    /// selection and activate it, keeping other selected IDs.
    @discardableResult
    mutating func showOnMap(_ id: Int, hasGeometry: Bool) -> ShowOnMapOutcome {
        guard hasGeometry else { return .noGeometry }
        guard visibleIDs.contains(id) else { return .hiddenByFilters }
        selectedIDs.insert(id)
        activeID = id
        return .shown
    }

    // MARK: List inspection

    mutating func inspect(_ id: Int) {
        guard visibleIDs.contains(id) else { return }
        inspectedID = id
    }

    mutating func dismissInspection() {
        inspectedID = nil
    }

    // MARK: Lifecycle

    /// Filter changes preserve selection. They only clear an active or
    /// inspected activity that is no longer visible, and never activate one.
    mutating func setVisible(_ ids: Set<Int>) {
        visibleIDs = ids
        retainActiveIfStillValid()
        if let inspectedID, !ids.contains(inspectedID) { self.inspectedID = nil }
    }

    /// Committed deletion or rebootstrap removal: drop the IDs everywhere and
    /// apply the removal rule if selected IDs were removed.
    mutating func removeActivities(_ ids: Set<Int>) {
        guard !ids.isEmpty else { return }
        let previous = selectedIDs
        selectedIDs.subtract(ids)
        visibleIDs.subtract(ids)
        if let inspectedID, ids.contains(inspectedID) { self.inspectedID = nil }
        applyRemovalRule(selectionChanged: selectedIDs != previous)
    }

    /// A committed snapshot can remove IDs and change filter eligibility in
    /// the same pass. Apply the removal rule against its final visibility,
    /// without transiently activating a survivor from the previous snapshot.
    mutating func reconcileActivities(existingIDs: Set<Int>, visibleIDs: Set<Int>) {
        let previous = selectedIDs
        selectedIDs.formIntersection(existingIDs)
        self.visibleIDs = visibleIDs.intersection(existingIDs)
        if let inspectedID, !self.visibleIDs.contains(inspectedID) { self.inspectedID = nil }
        applyRemovalRule(selectionChanged: selectedIDs != previous)
    }

    /// Logout, account or deployment transition.
    mutating func clearScope() {
        self = SelectionState()
    }

    // MARK: Helpers

    private mutating func applyRemovalRule(selectionChanged: Bool) {
        let candidates = visibleSelectedIDs
        if selectionChanged, candidates.count == 1 {
            activeID = candidates.first
        } else {
            retainActiveIfStillValid()
        }
    }

    private mutating func retainActiveIfStillValid() {
        if let activeID, !(selectedIDs.contains(activeID) && visibleIDs.contains(activeID)) {
            self.activeID = nil
        }
    }
}

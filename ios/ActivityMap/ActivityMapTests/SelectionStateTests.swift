import CoreLocation
import Foundation
import Testing
@testable import ActivityMap

/// Runs the shared parity vectors through the production reducer rather than
/// re-implementing the contract in the test.
struct SelectionFixtureTests {
    struct Event: Sendable {
        let type: String
        let id: Int?
        let ids: [Int]
        let geometryAvailable: Bool
    }

    struct Step: Sendable, CustomTestStringConvertible {
        let scenario: String
        let name: String
        let initial: SelectionState
        /// The scenario's events up to and including this step.
        let events: [Event]
        let expected: SelectionState

        var testDescription: String { "\(scenario) / \(name)" }
    }

    nonisolated static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // ActivityMapTests
        .deletingLastPathComponent() // ActivityMap
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // repository root
        .appending(path: "shared/parity/state-fixtures.v1.json")

    nonisolated static func loadFixture() -> [String: Any] {
        guard
            let data = try? Data(contentsOf: fixtureURL),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return root
    }

    nonisolated static let steps: [Step] = {
        let scenarios = loadFixture()["selectionScenarios"] as? [[String: Any]] ?? []
        return scenarios.flatMap { scenario -> [Step] in
            let name = scenario["name"] as? String ?? "?"
            let initial = state(scenario["initial"])
            let rawSteps = scenario["steps"] as? [[String: Any]] ?? []
            let events = rawSteps.map { event($0["event"]) }
            return rawSteps.indices.map { index in
                Step(
                    scenario: name,
                    name: rawSteps[index]["name"] as? String ?? "?",
                    initial: initial,
                    events: Array(events[...index]),
                    expected: state(rawSteps[index]["expected"])
                )
            }
        }
    }()

    @Test func fixtureIsAvailable() {
        #expect(Self.steps.count >= 30, "Missing shared fixture at \(Self.fixtureURL.path)")
    }

    @Test(arguments: steps)
    func sharedTransition(_ step: Step) throws {
        var state = step.initial
        for event in step.events { try apply(event, to: &state) }
        #expect(state.selectedIDs == step.expected.selectedIDs)
        #expect(state.activeID == step.expected.activeID)
        #expect(state.inspectedID == step.expected.inspectedID)
        #expect(state.visibleIDs == step.expected.visibleIDs)
    }

    @Test func summaryScopeCounts() throws {
        let scope = try #require(Self.loadFixture()["summaryScopeCase"] as? [String: Any])
        let expected = try #require(scope["expected"] as? [String: Any])
        let state = SelectionState(
            selectedIDs: Self.ids(scope["selected_ids"]),
            visibleIDs: Self.ids(scope["filtered_ids"])
        )
        #expect(state.selectedIDs.count == expected["selected_count"] as? Int)
        #expect(state.hiddenSelectedCount == expected["hidden_selected_count"] as? Int)
    }

    enum FixtureError: Error { case unknownEvent(String), missingID(String) }

    private func apply(_ event: Event, to state: inout SelectionState) throws {
        func requireID() throws -> Int {
            guard let id = event.id else { throw FixtureError.missingID(event.type) }
            return id
        }
        switch event.type {
        case "replace_selection": state.replaceSelection(with: event.ids)
        case "add_selection": state.addToSelection(event.ids)
        case "remove_selection": state.removeFromSelection(event.ids)
        case "toggle_selection": state.toggleSelection(try requireID())
        case "select_all_filtered": state.selectAllVisible()
        case "deselect_all_filtered": state.deselectAllVisible()
        case "clear_selection": state.clearSelection()
        case "activate": state.activate(try requireID())
        case "inspect": state.inspect(try requireID())
        case "dismiss_inspection": state.dismissInspection()
        case "set_visible": state.setVisible(Set(event.ids))
        case "remove_activities": state.removeActivities(Set(event.ids))
        case "clear_scope": state.clearScope()
        case "show_on_map": state.showOnMap(try requireID(), hasGeometry: event.geometryAvailable)
        default: throw FixtureError.unknownEvent(event.type)
        }
    }

    nonisolated private static func event(_ value: Any?) -> Event {
        let fields = value as? [String: Any] ?? [:]
        return Event(
            type: fields["type"] as? String ?? "",
            id: id(fields["id"]),
            ids: idList(fields["ids"]),
            geometryAvailable: fields["geometry_available"] as? Bool ?? true
        )
    }

    nonisolated private static func state(_ value: Any?) -> SelectionState {
        let fields = value as? [String: Any] ?? [:]
        return SelectionState(
            selectedIDs: ids(fields["selected_ids"]),
            activeID: id(fields["active_id"]),
            inspectedID: id(fields["inspected_id"]),
            visibleIDs: ids(fields["visible_ids"])
        )
    }

    /// Fixture IDs are canonical strings; these are well inside Int range.
    nonisolated private static func id(_ value: Any?) -> Int? { (value as? String).flatMap { Int($0) } }
    nonisolated private static func idList(_ value: Any?) -> [Int] { (value as? [String] ?? []).compactMap { Int($0) } }
    nonisolated private static func ids(_ value: Any?) -> Set<Int> { Set(idList(value)) }
}

@MainActor
struct ActivityStoreSelectionTests {
    static func activity(_ id: Int, sport: SportType = .run, route: Bool = true) -> Activity {
        Activity(
            id: id, name: "Activity \(id)", sportType: sport, startDate: Date(timeIntervalSince1970: 1_700_000_000),
            startDateLocal: Date(timeIntervalSince1970: 1_700_000_000), timezone: "UTC",
            distance: 1000, movingTime: 600, elapsedTime: 600, totalElevationGain: 10, averageSpeed: 2,
            commute: false,
            coordinates: route ? [CLLocationCoordinate2D(latitude: 46, longitude: 8),
                                  CLLocationCoordinate2D(latitude: 46.01, longitude: 8.01)] : []
        )
    }

    @Test func filteringKeepsHiddenSelectionButClearsHiddenFocusAndDetail() {
        let store = ActivityStore(activities: [Self.activity(1), Self.activity(2, sport: .ride)])
        store.replaceSelection(with: [1, 2])
        store.activate(2)
        store.inspect(2)
        store.activeSportTypes.remove(.ride)
        #expect(store.selectedActivityIDs == [1, 2])
        #expect(store.hiddenSelectedCount == 1)
        #expect(store.activeActivityID == nil)
        #expect(store.inspectedActivityID == nil)
        store.resetFilters()
        #expect(store.activeActivityID == nil, "restoring a filter must not reopen focus")
    }

    @Test func inspectionNeverChangesSelectionOrFocus() {
        let store = ActivityStore(activities: [Self.activity(1), Self.activity(2)])
        store.replaceSelection(with: [1])
        store.inspect(2)
        #expect(store.selectedActivityIDs == [1] && store.activeActivityID == 1)
        #expect(store.inspectedActivity?.id == 2)
        store.dismissInspection()
        #expect(store.selectedActivityIDs == [1] && store.activeActivityID == 1)
    }

    @Test func showOnMapSelectsActivatesAndSwitchesTab() {
        let store = ActivityStore(activities: [Self.activity(1), Self.activity(2), Self.activity(3, route: false)])
        store.selectedTab = .list
        store.addToSelection([1])
        #expect(store.showOnMap(3) == .noGeometry)
        #expect(store.selectedTab == .list && store.selectedActivityIDs == [1])
        #expect(store.showOnMap(2) == .shown)
        #expect(store.selectedTab == .map)
        #expect(store.selectedActivityIDs == [1, 2] && store.activeActivityID == 2)
        #expect(store.showOnMap(99) == .notFound)
    }

    @Test func showOnMapLeavesFilterHiddenActivitiesUnchanged() {
        let store = ActivityStore(activities: [Self.activity(1), Self.activity(2, sport: .ride)])
        store.activeSportTypes.remove(.ride)
        #expect(store.showOnMap(2) == .hiddenByFilters)
        #expect(store.selectedActivityIDs.isEmpty && store.selectedTab == .map)
    }

    @Test func unknownIDsAreNeverSelected() {
        let store = ActivityStore(activities: [Self.activity(1)])
        store.replaceSelection(with: [1, 99])
        store.toggleSelection(98)
        #expect(store.selectedActivityIDs == [1])
    }

    @Test func committedDeletionReconcilesSelection() {
        let store = ActivityStore(activities: [Self.activity(1), Self.activity(2), Self.activity(3)])
        store.replaceSelection(with: [1, 2])
        store.activate(2)
        store.inspect(2)
        store.activities = [Self.activity(1), Self.activity(3)]
        #expect(store.selectedActivityIDs == [1])
        #expect(store.activeActivityID == 1, "the sole remaining visible selection becomes active")
        #expect(store.inspectedActivityID == nil)
    }

    @Test func deletionUsesTheNewSnapshotsVisibilityToActivateASurvivor() {
        let store = ActivityStore(activities: [Self.activity(1), Self.activity(2), Self.activity(3)])
        store.activeSportTypes = [.run]
        store.replaceSelection(with: [1, 2, 3])
        store.activate(1)
        store.activities = [Self.activity(2, sport: .ride), Self.activity(3)]
        #expect(store.selectedActivityIDs == [2, 3])
        #expect(store.activeActivityID == 3)
    }

    @Test func deletionDoesNotActivateAnOldSoleVisibleSurvivor() {
        let store = ActivityStore(activities: [Self.activity(1), Self.activity(2), Self.activity(3, sport: .ride)])
        store.activeSportTypes = [.run]
        store.replaceSelection(with: [1, 2, 3])
        store.activate(1)
        store.activities = [Self.activity(2), Self.activity(3)]
        #expect(store.selectedActivityIDs == [2, 3])
        #expect(store.activeActivityID == nil, "both surviving selections now pass the filter")
    }

    @Test func updatedActivitiesWithoutDeletionNeverAutoActivate() {
        let store = ActivityStore(activities: [Self.activity(1), Self.activity(2)])
        store.activeSportTypes = [.run]
        store.replaceSelection(with: [1, 2])
        store.activate(1)
        store.inspect(1)
        store.activities = [Self.activity(1, sport: .ride), Self.activity(2)]
        #expect(store.selectedActivityIDs == [1, 2])
        #expect(store.activeActivityID == nil && store.inspectedActivityID == nil)
    }

    @Test func tabChangesKeepSelectionFocusAndInspection() {
        let store = ActivityStore(activities: [Self.activity(1), Self.activity(2)])
        store.replaceSelection(with: [1])
        store.inspect(2)
        store.selectedTab = .list
        store.selectedTab = .map
        #expect(store.selectedActivityIDs == [1] && store.activeActivityID == 1 && store.inspectedActivityID == 2)
    }

    @Test func clearScopeResetsEverything() {
        let store = ActivityStore(activities: [Self.activity(1)])
        store.replaceSelection(with: [1])
        store.inspect(1)
        store.clearScope()
        #expect(store.activities.isEmpty && store.selectedActivityIDs.isEmpty)
        #expect(store.activeActivityID == nil && store.inspectedActivityID == nil)
    }
}

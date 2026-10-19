import Observation
import SwiftUI
import Testing
import UIKit
@testable import ActivityMap

/// Real native navigation, without relying on the app-hosted accessibility tree.
/// Each fixture uses the production presenter with separately owned inspection IDs.
@MainActor @Suite(.serialized) struct AdaptiveInspectionTests {
    @Test(arguments: [false, true])
    func pushedInspectionSurvivesWidthChangesAndBackClearsOnlyItsOwner(initiallyWide: Bool) async throws {
        let state = InspectionFixtureState()
        state.width = initiallyWide ? 1000 : 390
        let host = try await InspectionFixtureHost(state: state)
        defer { host.close() }
        let navigation = try #require(host.navigation)
        state.id = 7
        if initiallyWide {
            try await inspectionFixtureWait { state.panelIDs == [7] }
            #expect(navigation.viewControllers.count == 1)
            state.waitsForWidth = true // A stale filter-collapse hint must not trap rotation.
            state.width = 390
        }
        try await inspectionFixtureWait { navigation.viewControllers.count == 2 && navigation.transitionCoordinator == nil }
        state.width = 1000
        try await inspectionFixtureWait { state.pushed && state.panelIDs.isEmpty }
        #expect(navigation.viewControllers.count == 2 && state.id == 7 && state.otherOwnerID == 99)
        navigation.popViewController(animated: false)
        try await inspectionFixtureWait { state.id == nil && !state.pushed && navigation.viewControllers.count == 1 }
        #expect(state.otherOwnerID == 99)
    }

    @Test(arguments: [false, true])
    func inactiveListRetainsExistingPanelOrPushedPage(wide: Bool) async throws {
        let state = InspectionFixtureState()
        state.retainsPresentationWhenInactive = true
        state.width = wide ? 1000 : 390
        state.id = 7
        let host = try await InspectionFixtureHost(state: state)
        defer { host.close() }
        try await inspectionFixtureWait {
            wide ? state.panelIDs == [7] : host.navigation?.viewControllers.count == 2 && state.pushed
        }
        let appearances = state.destinationAppearances
        let panelAppearances = state.panelAppearances
        let page = host.navigation?.topViewController
        state.active = false
        try await Task.sleep(for: .milliseconds(150))
        #expect(state.id == 7 && state.otherOwnerID == 99)
        #expect(host.navigation?.topViewController === page)
        #expect(wide ? state.panelIDs == [7] : host.navigation?.viewControllers.count == 2)
        state.active = true
        try await Task.sleep(for: .milliseconds(150))
        #expect(state.destinationAppearances == appearances && state.panelAppearances == panelAppearances,
                "Tab changes must not unmount the retained List detail")
        #expect(host.navigation?.topViewController === page)
    }

    @Test func preexistingNarrowInspectionIsRegisteredOnFirstAppearance() async throws {
        let state = InspectionFixtureState()
        state.id = 7
        let host = try await InspectionFixtureHost(state: state)
        defer { host.close() }
        try await inspectionFixtureWait { host.navigation?.viewControllers.count == 2 && state.pushed }
        state.width = 1000
        try await Task.sleep(for: .milliseconds(150))
        #expect(host.navigation?.viewControllers.count == 2 && state.panelIDs.isEmpty)
    }

    @Test func preexistingSelectionWaitsForFilterCollapseWithoutTransientPush() async throws {
        let state = InspectionFixtureState()
        state.id = 7
        state.waitsForWidth = true
        let host = try await InspectionFixtureHost(state: state)
        defer { host.close() }
        try await Task.sleep(for: .milliseconds(150))
        #expect(host.navigation?.viewControllers.count == 1 && !state.pushed && state.destinationAppearances == 0)
        state.waitsForWidth = false
        state.width = 1000
        try await inspectionFixtureWait { state.panelIDs == [7] }
        #expect(state.destinationAppearances == 0)
    }

    @Test func filterCollapseWaitsForAdjacentLayoutAndHiddenPaneDoesNotPush() async throws {
        let state = InspectionFixtureState()
        state.waitsForWidth = true
        let host = try await InspectionFixtureHost(state: state)
        defer { host.close() }
        state.id = 7
        try await Task.sleep(for: .milliseconds(150))
        #expect(host.navigation?.viewControllers.count == 1 && !state.pushed)
        state.waitsForWidth = false
        state.width = 1000
        try await inspectionFixtureWait { state.panelIDs == [7] }
        #expect(host.navigation?.viewControllers.count == 1 && !state.pushed)
        state.active = false
        state.width = 390
        try await inspectionFixtureWait { state.panelIDs.isEmpty }
        #expect(host.navigation?.viewControllers.count == 1 && state.id == 7 && !state.pushed)
        state.active = true
        try await inspectionFixtureWait { host.navigation?.viewControllers.count == 2 && state.pushed }
    }
}

@MainActor @Observable private final class InspectionFixtureState {
    var id: Int?
    var otherOwnerID: Int? = 99
    var pushed = false
    var active = true
    var retainsPresentationWhenInactive = false
    var width: CGFloat = 390
    var waitsForWidth = false
    var panelIDs: Set<Int> = []
    var destinationAppearances = 0
    var panelAppearances = 0
}

private struct InspectionFixtureView: View {
    @Bindable var state: InspectionFixtureState
    var body: some View {
        NavigationStack {
            AdaptiveActivityInspection(selection: $state.id, externalPushed: $state.pushed,
                active: state.active, retainsPresentationWhenInactive: state.retainsPresentationWhenInactive,
                waitsForWidth: state.waitsForWidth, widthOverride: state.width,
                closeIdentifier: "fixture-close", panelIdentifier: "fixture-panel") { _ in
                Text("Retained activity list")
            } panel: { id in
                Text("Activity \(id)")
                    .onAppear { state.panelIDs.insert(id); state.panelAppearances += 1 }
                    .onDisappear { state.panelIDs.remove(id) }
            } destination: { id in
                Text("Activity \(id)").onAppear { state.destinationAppearances += 1 }
            }
            .environment(\.horizontalSizeClass, .regular)
        }
    }
}

@MainActor private final class InspectionFixtureHost {
    let window: UIWindow
    let oldWindow: UIWindow?
    let host: UIHostingController<InspectionFixtureView>
    init(state: InspectionFixtureState) async throws {
        try await inspectionFixtureWait { UIApplication.shared.connectedScenes.first is UIWindowScene }
        let scene = try #require(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        oldWindow = scene.keyWindow
        window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 1000, height: 900)
        host = UIHostingController(rootView: InspectionFixtureView(state: state))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
        try await inspectionFixtureWait { self.navigation != nil }
    }
    var navigation: UINavigationController? {
        func find(_ controller: UIViewController) -> UINavigationController? {
            if let navigation = controller as? UINavigationController { return navigation }
            return controller.children.compactMap(find).first
        }
        return find(host)
    }
    func close() { window.isHidden = true; oldWindow?.makeKeyAndVisible() }
}

@MainActor private func inspectionFixtureWait(_ predicate: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(5)
    while !predicate() && Date() < deadline { try await Task.sleep(for: .milliseconds(25)) }
    try #require(predicate(), "Native inspection did not reach the expected state within five seconds")
}

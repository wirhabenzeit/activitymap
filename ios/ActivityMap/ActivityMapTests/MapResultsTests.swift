import CoreGraphics
import Testing
@testable import ActivityMap

@MainActor
struct MapResultsTests {
    @Test func resultScopeIncludesExistingSelectionAndGPSLessActivities() {
        let store = ActivityStore(activities: (1...4).map { ActivityStoreSelectionTests.activity($0, route: $0 != 4) })
        let picker = RoutePicker()
        store.addToSelection([1, 4])
        store.inspect(4)
        picker.apply(ids: [3, 2], adding: true, request: picker.invalidateQuery(), store: store)
        #expect(picker.candidateIDs == [3, 2, 4, 1])
        picker.showDetail(4, store: store)
        #expect(store.activeActivityID == 4 && picker.detailID == 4)
        picker.step(1, store: store)
        #expect(store.activeActivityID == 1 && picker.detailID == 1)
        picker.step(1, store: store)
        #expect(store.activeActivityID == 3)
        #expect(store.inspectedActivityID == 4)
        #expect(store.mapContext.pendingRequest == nil, "Result browsing must not issue camera fits")
    }

    @Test func detentAndActiveDetailSurviveTabsAndOrdinaryUpdates() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1), ActivityStoreSelectionTests.activity(2)])
        let picker = RoutePicker()
        picker.apply(ids: [2, 1], adding: false, request: picker.invalidateQuery(), store: store)
        picker.showDetail(1, store: store)
        picker.detent = .expanded
        store.selectedTab = .list
        store.activities[0].name = "Updated from sync"
        picker.reconcile(with: store)
        store.selectedTab = .map
        #expect(picker.isPresented && picker.detent == .expanded && picker.detailID == 1)
        #expect(store.activeActivityID == 1 && picker.candidateIDs == [2, 1])
        picker.detent = .compact
        #expect(store.mapContext.pendingRequest == nil)
        store.removeFromSelection([1])
        picker.reconcile(with: store)
        #expect(picker.detailID == 2 && picker.candidateIDs == [2])
        store.clearSelection()
        picker.reconcile(with: store)
        #expect(!picker.isPresented && picker.detailID == nil && picker.candidateIDs.isEmpty)
    }

    @Test func hiddenSelectionIsDisclosedWithoutReactivatingAfterFilterReset() {
        let store = ActivityStore(activities: [ActivityStoreSelectionTests.activity(1, sport: .ride)])
        let picker = RoutePicker()
        picker.apply(ids: [1], adding: false, request: picker.invalidateQuery(), store: store)
        store.activeSportTypes = []
        picker.reconcile(with: store)
        #expect(picker.isPresented && picker.candidateIDs.isEmpty && picker.detailID == nil)
        #expect(store.hiddenSelectedCount == 1)
        store.resetFilters()
        picker.reconcile(with: store)
        #expect(picker.candidateIDs == [1] && picker.detailID == nil && store.activeActivityID == nil)
        store.activities = []
        picker.reconcile(with: store)
        #expect(!picker.isPresented)
    }

    @Test func widePanelHasOnlyCollapsedAndFullHeightWithStableCameraOcclusion() {
        for size in [CGSize(width: 820, height: 1180), CGSize(width: 844, height: 390)] {
            for largeText in [false, true] {
                let layouts = MapResultsDetent.allCases.map {
                    MapResultsLayout(size: size, topInset: 44, bottomInset: 21, detent: $0, largeText: largeText)
                }
                #expect(layouts[0].contentHeight < layouts[1].contentHeight)
                #expect(layouts[1].frame == layouts[2].frame)
                #expect(layouts.allSatisfy { $0.bottomOcclusion == 0 && $0.leadingOcclusion == layouts[0].leadingOcclusion })
                #expect(layouts.allSatisfy { $0.frame.maxY == size.height + 21 }, "Both states meet the physical bottom edge through the safe area")
                #expect(layouts[0].frame.minY > layouts[1].frame.minY, "Expansion moves the top edge upward")
                let fit = MapResultsLayout.framing(size: size, topInset: 44, bottomInset: 21, detent: .compact, largeText: largeText)
                #expect(fit.frame == layouts[1].frame, "Explicit fits reserve the full edge footprint")
            }
        }
    }

    @Test(arguments: [CGSize(width: 390, height: 810), CGSize(width: 768, height: 990), CGSize(width: 800, height: 360)])
    func controlsStayAtBottomBehindResults(size: CGSize) {
        let center = MapResultsLayout.controlsCenter(size: size)
        // Live controls: three 44pt targets, two 1pt dividers and 4pt insets.
        let controls = CGRect(x: center.x - 71, y: center.y - 28, width: 142, height: 56)
        #expect(CGRect(origin: .zero, size: size).contains(controls) && controls.minY >= 118)
        for detent in MapResultsDetent.allCases {
            let panel = MapResultsLayout(size: size, topInset: 106, bottomInset: 34, detent: detent)
            #expect(center.y == size.height - 92, "Detents cannot move background controls")
            if !panel.isSidePanel { #expect(panel.frame.intersects(controls), "Results cover the bottom controls") }
        }
    }

    @Test(arguments: [CGSize(width: 390, height: 810), CGSize(width: 768, height: 990), CGSize(width: 800, height: 360)])
    func detentsLeaveNavigationAvailable(size: CGSize) {
        for detent in MapResultsDetent.allCases {
            let layout = MapResultsLayout(size: size, topInset: 106, bottomInset: 34, detent: detent)
            #expect(layout.frame.minY >= 118 && layout.frame.maxY <= size.height + 34)
            #expect(layout.frame.minX >= (layout.isSidePanel ? 12 : 4) && layout.frame.maxX <= size.width)
            if layout.isSidePanel {
                #expect(layout.leadingOcclusion + 16 < size.width / 2)
                #expect(layout.bottomOcclusion == 0)
            } else {
                #expect(layout.frame.minY >= 118, "Expanded results leave navigation clear")
                #expect(layout.leadingOcclusion == 0)
            }
        }
    }
}

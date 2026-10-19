import CoreGraphics
import Testing
@testable import ActivityMap

@MainActor
struct MapResultsTests {
    @Test func activityContinuationFollowsVisibleOrderAndStopsAtBoundaries() {
        let first = ActivityDetailSequence(ids: [7, 2, 9], currentID: 7)
        #expect(first.previousID == nil && first.nextID == 2 && first.position == "1 of 3")
        let middle = ActivityDetailSequence(ids: [7, 2, 9], currentID: 2)
        #expect(middle.previousID == 7 && middle.nextID == 9)
        let last = ActivityDetailSequence(ids: [7, 2, 9], currentID: 9)
        #expect(last.previousID == 2 && last.nextID == nil)
        let missing = ActivityDetailSequence(ids: [7, 9], currentID: 2)
        #expect(missing.previousID == nil && missing.nextID == nil && missing.position == nil)
    }

    @Test func resultScopeIncludesExistingSelectionAndGPSLessActivities() {
        let store = ActivityStore(activities: (1...4).map { ActivityStoreSelectionTests.activity($0, route: $0 != 4) })
        let picker = RoutePicker()
        store.addToSelection([1, 4])
        store.inspect(4)
        store.setCombine(true)
        picker.apply(ids: [3, 2], adding: true, request: picker.invalidateQuery(), store: store)
        #expect(picker.candidateIDs == [3, 2, 4, 1])
        picker.showDetail(4, store: store)
        #expect(store.activeActivityID == 4 && picker.detailID == 4)
        picker.step(1, store: store)
        #expect(store.activeActivityID == 1 && picker.detailID == 1)
        picker.step(1, store: store)
        #expect(store.activeActivityID == 1, "Next stops at the last visible activity instead of wrapping")
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

    @Test func dragSnapsFromBothRestingPositionsAndClampsOvershoot() {
        #expect(MapResultsSnap.height(start: 108, translation: 500, compact: 108, expanded: 700) == 108)
        #expect(MapResultsSnap.height(start: 700, translation: -500, compact: 108, expanded: 700) == 700)
        #expect(MapResultsSnap.height(start: 700, translation: 100, compact: 108, expanded: 700) == 600)
        #expect(MapResultsSnap.target(start: 108, predictedTranslation: -450, compact: 108, expanded: 700) == .expanded)
        #expect(MapResultsSnap.target(start: 700, predictedTranslation: 450, compact: 108, expanded: 700) == .compact)
        #expect(MapResultsSnap.target(start: 700, predictedTranslation: 40, compact: 108, expanded: 700) == .expanded)
        #expect(MapResultsSnap.target(start: 108, predictedTranslation: -40, compact: 108, expanded: 700) == .compact)
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
                #expect(layouts[2].frame.minY == 48, "Expanded side panels leave a 4pt gap below the toolbar")
                #expect(layouts.allSatisfy { abs($0.frame.maxX - (size.width - 16)) < 0.01 })
                #expect(layouts.allSatisfy { $0.bottomOcclusion == 0 && $0.trailingOcclusion == layouts[0].trailingOcclusion })
                #expect(layouts.allSatisfy { $0.frame.maxY == size.height + 21 }, "Both states meet the physical bottom edge through the safe area")
                #expect(layouts[0].frame.minY > layouts[1].frame.minY, "Expansion moves the top edge upward")
            }
        }
    }

    @Test func nativeMeasurementsRejectPreviousOrientationAndInvalidFrames() {
        let size = CGSize(width: 800, height: 382)
        let frame = CGRect(x: 410, y: 40, width: 334, height: 354)
        let measurement = MapResultsPresentationGeometry(frame: frame, containerSize: size)
        #expect(measurement.frame(in: size) == frame)
        #expect(measurement.frame(in: CGSize(width: 382, height: 800)) == nil)
        #expect(MapResultsPresentationGeometry(frame: .zero, containerSize: size).frame(in: size) == nil)
    }

    @Test func nativeFrameDrivesCameraAndCompassClearance() throws {
        let size = CGSize(width: 800, height: 382)
        let frame = CGRect(x: 410, y: 40, width: 334, height: 354)
        let layout = MapResultsLayout(size: size, topInset: 44, bottomInset: 20, detent: .medium)
        #expect(layout.resolvedTrailingOcclusion(presentedFrame: frame) == 402)
        #expect(layout.resolvedTrailingOcclusion(presentedFrame: frame) > layout.trailingOcclusion,
                "Native safe-area placement can cover more map than the custom-panel estimate")
        let center = try #require(MapCompassLayout.center(size: size, topInset: 44, bottomInset: 20,
            showingResults: true, detent: .medium, largeText: false, resultsFrame: frame))
        let target = CGRect(x: center.x - 22, y: center.y - 22, width: 44, height: 44)
        #expect(target.maxX == frame.minX - 12)
        #expect(!target.intersects(frame))
    }

    @Test func nativeFallbackProtectsReclaimedSafeAreaUntilMeasured() {
        if #available(iOS 27.0, *) {
            let layout = MapResultsLayout(size: CGSize(width: 800, height: 382),
                topInset: 44, bottomInset: 20, detent: .medium)
            let fallback = layout.presentationFrame(measuredFrame: nil, leadingSafeInset: 62, trailingSafeInset: 16)
            #expect(fallback.minX == layout.frame.minX - 46)
            let native = CGRect(x: 410, y: 40, width: 334, height: 354)
            #expect(layout.presentationFrame(measuredFrame: native, leadingSafeInset: 62, trailingSafeInset: 16) == native)
        }
    }

    @Test func shortPhoneOpeningSheetLeavesRoomForAccessibleRouteFraming() {
        let height: CGFloat = 551, top: CGFloat = 116
        let opening = NativeMapResultsSizing.openingHeight(height: height,
                                                         largeText: true, topInset: top)
        #expect(opening >= 160, "Opening retains a scrolling detail surface")
        #expect(height - top - 64 - opening - 24 >= 96, "Large text must not leave Show on map waiting for an impossible fit")
    }

    @Test(arguments: [CGSize(width: 390, height: 810), CGSize(width: 768, height: 990), CGSize(width: 800, height: 360)])
    func controlsStayAtTopRightBehindExpandedResults(size: CGSize) {
        let center = MapResultsLayout.controlsCenter(size: size, topInset: 106)
        let controls = CGRect(x: center.x - 26, y: center.y - 77, width: 52, height: 154)
        #expect(CGRect(origin: .zero, size: size).contains(controls))
        #expect(controls.minY == 118 && controls.maxX == size.width - 16)
        for detent in MapResultsDetent.allCases {
            let panel = MapResultsLayout(size: size, topInset: 106, bottomInset: 34, detent: detent)
            if panel.isSidePanel {
                #expect(panel.frame.maxX == controls.maxX)
                if detent == .expanded {
                    #expect(panel.frame.contains(controls), "Expanded results intentionally cover the controls")
                }
            }
        }
    }

    @Test(arguments: [CGSize(width: 390, height: 810), CGSize(width: 768, height: 990), CGSize(width: 800, height: 360)])
    func detentsLeaveNavigationAvailable(size: CGSize) {
        for detent in MapResultsDetent.allCases {
            let layout = MapResultsLayout(size: size, topInset: 106, bottomInset: 34, detent: detent)
            #expect(layout.frame.minY >= (layout.isSidePanel ? 110 : 118) && layout.frame.maxY <= size.height + 34)
            #expect(layout.frame.minX >= (layout.isSidePanel ? 12 : 4) && layout.frame.maxX <= size.width)
            if layout.isSidePanel {
                #expect(size.width - layout.trailingOcclusion - 16 >= 160)
                #expect(layout.bottomOcclusion == 0)
            } else {
                #expect(layout.frame.minY >= 118, "Expanded results leave navigation clear")
                #expect(layout.trailingOcclusion == 0)
            }
        }
    }
}

import Testing
import UIKit
@testable import ActivityMap

@MainActor struct DetailBackGestureTests {
    @Test(arguments: [CGFloat(0), CGFloat(900)])
    func nestedHorizontalContentOwnsPansAtBothTimelineEnds(offset: CGFloat) {
        let vertical = UIScrollView(frame: CGRect(x: 0, y: 0, width: 320, height: 640))
        vertical.contentSize = CGSize(width: 320, height: 1200)
        let timeline = UIScrollView(frame: CGRect(x: 0, y: 80, width: 280, height: 180))
        timeline.contentSize = CGSize(width: 1180, height: 180)
        timeline.contentOffset.x = offset
        let cell = UIButton(frame: CGRect(x: 0, y: 0, width: 20, height: 20))
        vertical.addSubview(timeline)
        timeline.addSubview(cell)
        #expect(DetailBackScrollPolicy.horizontalOwner(of: cell) === timeline)
        #expect(DetailBackScrollPolicy.isHorizontalPan(timeline.panGestureRecognizer))
        #expect(!DetailBackScrollPolicy.isHorizontalPan(vertical.panGestureRecognizer))
        #expect(DetailBackScrollPolicy.horizontalOwner(of: vertical) == nil)
        timeline.semanticContentAttribute = .forceRightToLeft
        #expect(DetailBackScrollPolicy.horizontalOwner(of: cell) === timeline)
    }

    @Test func scrollOwnershipUsesExtentInsetsAndEnabledState() {
        let scroll = UIScrollView(frame: CGRect(x: 0, y: 0, width: 320, height: 180))
        scroll.contentSize = scroll.bounds.size
        #expect(!DetailBackScrollPolicy.ownsHorizontalScrolling(scroll))
        scroll.contentSize.width += 0.5
        #expect(!DetailBackScrollPolicy.ownsHorizontalScrolling(scroll), "Rounding overflow is not horizontal interaction")
        scroll.contentInset.right = 20
        #expect(DetailBackScrollPolicy.ownsHorizontalScrolling(scroll))
        scroll.contentInset = .zero
        scroll.contentSize.width = 320
        scroll.alwaysBounceHorizontal = true
        #expect(DetailBackScrollPolicy.ownsHorizontalScrolling(scroll))
        scroll.isScrollEnabled = false
        #expect(!DetailBackScrollPolicy.ownsHorizontalScrolling(scroll))
    }

    @Test func onlyTheScrollPanClaimsHorizontalOwnership() {
        let scroll = UIScrollView(frame: CGRect(x: 0, y: 0, width: 320, height: 180))
        scroll.contentSize = CGSize(width: 1000, height: 180)
        let tap = UITapGestureRecognizer()
        scroll.addGestureRecognizer(tap)
        #expect(DetailBackScrollPolicy.isHorizontalPan(scroll.panGestureRecognizer))
        #expect(!DetailBackScrollPolicy.isHorizontalPan(tap))
    }

    @Test func fullContentPopYieldsToHorizontalPanButEdgeAndVerticalBackRemainNative() throws {
        let root = UIViewController()
        let controller = DetailBackGesture.Controller()
        let navigation = UINavigationController(rootViewController: root)
        navigation.setViewControllers([root, controller], animated: false)
        navigation.loadViewIfNeeded()
        controller.loadViewIfNeeded()
        let content = try #require(navigation.interactiveContentPopGestureRecognizer)
        let edge = try #require(navigation.interactivePopGestureRecognizer)
        let previousContent = GestureDelegate(), previousEdge = GestureDelegate()
        content.delegate = previousContent
        edge.delegate = previousEdge
        content.isEnabled = false
        edge.isEnabled = false
        controller.viewDidAppear(false)
        defer { controller.restore() }
        #expect(content.delegate === controller)
        #expect(edge.delegate === controller)
        let horizontal = UIScrollView(frame: CGRect(x: 0, y: 0, width: 320, height: 180))
        horizontal.contentSize = CGSize(width: 1000, height: 180)
        let vertical = UIScrollView(frame: CGRect(x: 0, y: 0, width: 320, height: 600))
        vertical.contentSize = CGSize(width: 320, height: 1200)
        #expect(controller.gestureRecognizer(content, shouldRequireFailureOf: horizontal.panGestureRecognizer))
        #expect(!controller.gestureRecognizer(content, shouldBeRequiredToFailBy: horizontal.panGestureRecognizer))
        #expect(!controller.gestureRecognizer(content, shouldRecognizeSimultaneouslyWith: horizontal.panGestureRecognizer))
        #expect(controller.gestureRecognizer(content, shouldBeRequiredToFailBy: vertical.panGestureRecognizer))
        #expect(!controller.gestureRecognizer(edge, shouldRequireFailureOf: horizontal.panGestureRecognizer))
        #expect(!controller.gestureRecognizer(edge, shouldBeRequiredToFailBy: horizontal.panGestureRecognizer))
        #expect(content.isEnabled && edge.isEnabled)
        controller.restore()
        #expect(content.delegate === previousContent && edge.delegate === previousEdge)
        #expect(!content.isEnabled && !edge.isEnabled)
    }
}

@MainActor private final class GestureDelegate: NSObject, UIGestureRecognizerDelegate {}

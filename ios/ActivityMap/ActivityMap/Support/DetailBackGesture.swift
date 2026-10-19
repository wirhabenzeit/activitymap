import SwiftUI
import UIKit

/// Hiding UIKit's Back button or navigation bar disables its pop gesture.
/// Keep the native transition recognizer, with a depth/transition guard, and
/// restore its original delegate when this detail leaves the hierarchy.
struct DetailBackGesture: UIViewControllerRepresentable {
    var navigationReference: DetailNavigationReference? = nil
    func makeUIViewController(context: Context) -> Controller {
        let controller = Controller()
        controller.navigationReference = navigationReference
        return controller
    }
    func updateUIViewController(_ controller: Controller, context: Context) {}
    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) {
        controller.restore()
    }

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        var navigationReference: DetailNavigationReference?
        private weak var gesture: UIGestureRecognizer?
        private weak var previousDelegate: (any UIGestureRecognizerDelegate)?
        private var previousEnabled = false
        private weak var contentGesture: UIGestureRecognizer?
        private weak var previousContentDelegate: (any UIGestureRecognizerDelegate)?
        private var previousContentEnabled = false

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            navigationReference?.controller = navigationController
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            navigationReference?.controller = navigationController
            // Hidden native Back controls also suppress content pop through
            // its delegate. Apply the same depth/transition guard to both
            // native recognizers, preserving content gesture arbitration below.
            if let recognizer = navigationController?.interactiveContentPopGestureRecognizer,
               contentGesture !== recognizer {
                contentGesture = recognizer
                previousContentEnabled = recognizer.isEnabled
                previousContentDelegate = recognizer.delegate
                recognizer.delegate = self
                recognizer.isEnabled = true
            }
            guard let recognizer = navigationController?.interactivePopGestureRecognizer else { return }
            guard recognizer.delegate !== self else { return }
            gesture = recognizer
            previousDelegate = recognizer.delegate
            previousEnabled = recognizer.isEnabled
            recognizer.delegate = self
            recognizer.isEnabled = true
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            restore()
        }

        func restore() {
            if let contentGesture, contentGesture.delegate === self {
                contentGesture.delegate = previousContentDelegate
                contentGesture.isEnabled = previousContentEnabled
            }
            contentGesture = nil
            previousContentDelegate = nil
            guard let gesture, gesture.delegate === self else { return }
            gesture.delegate = previousDelegate
            gesture.isEnabled = previousEnabled
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let navigationController else { return false }
            guard navigationController.viewControllers.count > 1,
                  navigationController.transitionCoordinator == nil else { return false }
            if gestureRecognizer === contentGesture {
                let location = gestureRecognizer.location(in: navigationController.view)
                if DetailBackScrollPolicy.horizontalOwner(of: navigationController.view.hitTest(location, with: nil)) != nil {
                    return false
                }
            }
            return true
        }

        // Keep UIKit's direction detection: its content recognizer can report
        // zero velocity in shouldBegin. Full-content Back yields to horizontal
        // scroll regions; the native edge gesture remains available there.
        private func contentDelegate(for recognizer: UIGestureRecognizer) -> (any UIGestureRecognizerDelegate)? {
            recognizer === contentGesture ? previousContentDelegate : nil
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            if gestureRecognizer === contentGesture,
               DetailBackScrollPolicy.isHorizontalPan(otherGestureRecognizer) { return false }
            return contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer,
                shouldRecognizeSimultaneouslyWith: otherGestureRecognizer) ?? false
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            if gestureRecognizer === contentGesture,
               DetailBackScrollPolicy.isHorizontalPan(otherGestureRecognizer) { return true }
            return contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer,
                shouldRequireFailureOf: otherGestureRecognizer) ?? false
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            if gestureRecognizer === contentGesture, otherGestureRecognizer.view is UIScrollView {
                // A horizontal timeline must receive its pan before a full-page
                // pop. Vertical detail scrolling retains native content Back.
                return !DetailBackScrollPolicy.isHorizontalPan(otherGestureRecognizer)
            }
            return contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer,
                shouldBeRequiredToFailBy: otherGestureRecognizer) ?? false
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            if gestureRecognizer === contentGesture,
               DetailBackScrollPolicy.horizontalOwner(of: touch.view) != nil { return false }
            return contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer, shouldReceive: touch) ?? true
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive press: UIPress) -> Bool {
            contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer, shouldReceive: press) ?? true
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive event: UIEvent) -> Bool {
            contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer, shouldReceive: event) ?? true
        }
    }
}

/// A weak reference to the native stack already owned by SwiftUI. Explicit
/// destination changes can end that stack's push before another presenter runs.
@MainActor final class DetailNavigationReference {
    weak var controller: UINavigationController?
}

/// Ownership is based on the touched UIKit scroll hierarchy, independent of
/// labels, layout direction and current offset. At either end of a timeline,
/// a new drag still belongs to that timeline rather than dismissing its page.
@MainActor enum DetailBackScrollPolicy {
    static func ownsHorizontalScrolling(_ scroll: UIScrollView) -> Bool {
        guard scroll.isScrollEnabled else { return false }
        let horizontalExtent = scroll.contentSize.width
            + scroll.adjustedContentInset.left + scroll.adjustedContentInset.right
        return scroll.alwaysBounceHorizontal || horizontalExtent > scroll.bounds.width + 1
    }

    static func horizontalOwner(of view: UIView?) -> UIScrollView? {
        var candidate = view
        while let current = candidate {
            if let scroll = current as? UIScrollView, ownsHorizontalScrolling(scroll) { return scroll }
            candidate = current.superview
        }
        return nil
    }

    static func isHorizontalPan(_ recognizer: UIGestureRecognizer) -> Bool {
        guard let scroll = recognizer.view as? UIScrollView,
              recognizer === scroll.panGestureRecognizer else { return false }
        return ownsHorizontalScrolling(scroll)
    }
}

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
            return true
        }

        // Keep UIKit's touch and arbitration decisions, giving horizontal Back
        // priority over the vertical scroll pan. UIKit owns direction detection;
        // its content recognizer may report zero velocity in shouldBegin.
        private func contentDelegate(for recognizer: UIGestureRecognizer) -> (any UIGestureRecognizerDelegate)? {
            recognizer === contentGesture ? previousContentDelegate : nil
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer,
                shouldRecognizeSimultaneouslyWith: otherGestureRecognizer) ?? false
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer,
                shouldRequireFailureOf: otherGestureRecognizer) ?? false
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            if gestureRecognizer === contentGesture, otherGestureRecognizer.view is UIScrollView {
                return true
            }
            return contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer,
                shouldBeRequiredToFailBy: otherGestureRecognizer) ?? false
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            contentDelegate(for: gestureRecognizer)?.gestureRecognizer?(gestureRecognizer, shouldReceive: touch) ?? true
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

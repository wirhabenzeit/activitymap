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

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            navigationReference?.controller = navigationController
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            navigationReference?.controller = navigationController
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
            guard let gesture, gesture.delegate === self else { return }
            gesture.delegate = previousDelegate
            gesture.isEnabled = previousEnabled
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let navigationController else { return false }
            return navigationController.viewControllers.count > 1
                && navigationController.transitionCoordinator == nil
        }
    }
}

/// A weak reference to the native stack already owned by SwiftUI. Explicit
/// destination changes can end that stack's push before another presenter runs.
@MainActor final class DetailNavigationReference {
    weak var controller: UINavigationController?
}

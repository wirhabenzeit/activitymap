import SwiftUI
import UIKit

/// One stationary, nonvisual status-bar owner for the blue browsing shell.
/// Keep this outside changing pages so passive presentation/geometry helpers
/// cannot supply their default contrast. Presented sheets retain their own style.
struct BrowseStatusBarStyle: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.parent?.setNeedsStatusBarAppearanceUpdate()
    }
    final class Controller: UIViewController {
        override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
        override func loadView() {
            view = UIView()
            view.backgroundColor = .clear
            view.isUserInteractionEnabled = false
        }
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            parent?.setNeedsStatusBarAppearanceUpdate()
        }
    }
}

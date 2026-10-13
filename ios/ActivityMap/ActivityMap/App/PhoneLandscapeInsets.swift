import SwiftUI
import UIKit

/// UIKit reserves symmetric landscape gutters on phones. Keep the Island
/// side protected, but let browsing use the opposite side up to a 16pt margin.
struct PhoneLandscapeInsets: Equatable {
    var leading: CGFloat = 0
    var trailing: CGFloat = 0

    static func resolve(orientation: UIInterfaceOrientation, safeArea: UIEdgeInsets,
                        idiom: UIUserInterfaceIdiom) -> Self {
        guard idiom == .phone else { return Self() }
        switch orientation {
        // Interface orientation names the Home-button side, opposite the Island.
        case .landscapeLeft: return Self(leading: max(0, safeArea.left - 16))
        case .landscapeRight: return Self(trailing: max(0, safeArea.right - 16))
        default: return Self()
        }
    }
}

/// Read the owning window, including a 180-degree landscape rotation where
/// size classes and dimensions do not change. Never guess from device motion
/// or borrow another scene's orientation in a multi-window app.
struct PhoneLandscapeInsetsReader: UIViewControllerRepresentable {
    var changed: (PhoneLandscapeInsets) -> Void

    func makeUIViewController(context: Context) -> Controller { Controller(changed: changed) }
    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.changed = changed
        controller.report()
    }

    final class Controller: UIViewController {
        var changed: (PhoneLandscapeInsets) -> Void
        private var reported: PhoneLandscapeInsets?

        init(changed: @escaping (PhoneLandscapeInsets) -> Void) {
            self.changed = changed
            super.init(nibName: nil, bundle: nil)
        }
        @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
        override func loadView() {
            view = UIView()
            view.isUserInteractionEnabled = false
        }
        override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); report() }
        override func viewSafeAreaInsetsDidChange() { super.viewSafeAreaInsetsDidChange(); report() }
        override func viewWillTransition(to size: CGSize, with coordinator: any UIViewControllerTransitionCoordinator) {
            super.viewWillTransition(to: size, with: coordinator)
            coordinator.animate(alongsideTransition: nil) { [weak self] _ in self?.report() }
        }
        func report() {
            guard let window = viewIfLoaded?.window, let scene = window.windowScene else { return }
            let next = PhoneLandscapeInsets.resolve(orientation: scene.effectiveGeometry.interfaceOrientation,
                safeArea: window.safeAreaInsets, idiom: traitCollection.userInterfaceIdiom)
            guard next != reported else { return }
            reported = next
            DispatchQueue.main.async { [weak self] in
                guard let self, self.reported == next else { return }
                self.changed(next)
            }
        }
    }
}

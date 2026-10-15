import SwiftUI
import UIKit

/// Attached to the GPX row so UIKit's iPad popover uses that exact source view.
/// Present the real system share controller directly, without a wrapper sheet.
struct ActivityGPXSharePresenter: UIViewControllerRepresentable {
    @Binding var file: ActivityGPXFile?
    var onError: (Error) -> Void

    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.onFinish = { error in
            file = nil
            if let error { onError(error) }
        }
        controller.update(file: file)
    }
    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) {
        controller.onFinish = nil
        controller.stop()
    }

    final class Controller: UIViewController, UIAdaptivePresentationControllerDelegate, UIPopoverPresentationControllerDelegate {
        var onFinish: ((Error?) -> Void)?
        private(set) var activityController: UIActivityViewController?
        private var activeFile: ActivityGPXFile?
        private var pending = false

        override func loadView() {
            view = UIView()
            view.isUserInteractionEnabled = false
            view.backgroundColor = .clear
        }

        func update(file: ActivityGPXFile?) {
            guard let file else { if activeFile != nil { stop() }; return }
            guard activeFile == nil else { return }
            activeFile = file
            pending = true
            // SwiftUI can update this representable during a layout pass.
            DispatchQueue.main.async { [weak self] in self?.presentIfReady() }
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            presentIfReady()
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            activityController?.popoverPresentationController?.sourceRect = view.bounds
        }

        private func presentIfReady() {
            guard pending, let file = activeFile, view.window != nil else { return }
            pending = false
            let controller = UIActivityViewController(activityItems: [file.url], applicationActivities: nil)
            controller.completionWithItemsHandler = { [weak self] _, _, _, error in self?.finish(error: error) }
            if let popover = controller.popoverPresentationController {
                popover.sourceView = view
                popover.sourceRect = view.bounds
                popover.permittedArrowDirections = [.up, .down]
                popover.delegate = self
            }
            controller.presentationController?.delegate = self
            activityController = controller
            present(controller, animated: true)
        }

        private func finish(error: Error? = nil) {
            guard let file = activeFile else { return }
            pending = false
            activityController?.completionWithItemsHandler = nil
            activityController = nil
            activeFile = nil
            file.remove()
            onFinish?(error)
        }

        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish() }
        func popoverPresentationControllerDidDismissPopover(_ popoverPresentationController: UIPopoverPresentationController) { finish() }

        func stop() {
            pending = false
            let lease = activeFile
            let controller = activityController
            activeFile = nil
            activityController = nil
            controller?.completionWithItemsHandler = nil
            if let controller, controller.presentingViewController != nil {
                controller.dismiss(animated: false) { lease?.remove() }
            } else { lease?.remove() }
        }
    }
}

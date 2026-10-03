import SwiftUI
import UIKit

/// A persistent 44pt grab area, independent of the animating SwiftUI content.
struct MapResultsHandle: UIViewRepresentable {
    let changed: (CGFloat) -> Void
    let ended: (CGFloat, CGFloat) -> Void
    let cancelled: () -> Void

    func makeUIView(context: Context) -> MapResultsHandleView { MapResultsHandleView() }
    func updateUIView(_ view: MapResultsHandleView, context: Context) {
        view.changed = changed
        view.ended = ended
        view.cancelled = cancelled
    }
}

final class MapResultsHandleView: UIView, UIGestureRecognizerDelegate {
    var changed: (CGFloat) -> Void = { _ in }
    var ended: (CGFloat, CGFloat) -> Void = { _, _ in }
    var cancelled: () -> Void = {}
    private(set) lazy var pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        accessibilityIdentifier = "map-results-handle"
        let indicator = UIView()
        indicator.backgroundColor = .secondaryLabel.withAlphaComponent(0.4)
        indicator.layer.cornerRadius = 2
        indicator.isUserInteractionEnabled = false
        indicator.translatesAutoresizingMaskIntoConstraints = false
        addSubview(indicator)
        NSLayoutConstraint.activate([
            indicator.widthAnchor.constraint(equalToConstant: 32),
            indicator.heightAnchor.constraint(equalToConstant: 4),
            indicator.centerXAnchor.constraint(equalTo: centerXAnchor),
            indicator.topAnchor.constraint(equalTo: topAnchor, constant: 9),
        ])
        pan.delegate = self
        addGestureRecognizer(pan)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        let velocity = pan.velocity(in: window)
        return abs(velocity.y) > abs(velocity.x)
    }

    @objc func handlePan(_ recognizer: UIPanGestureRecognizer) {
        // Window coordinates stay fixed while this view moves with the panel.
        let translation = recognizer.translation(in: window).y
        switch recognizer.state {
        case .began, .changed: changed(translation)
        case .ended:
            ended(translation, translation + recognizer.velocity(in: window).y * 0.2)
        case .cancelled, .failed: cancelled()
        default: break
        }
    }
}

import SwiftUI
import UIKit

/// SwiftUI hosts Apple's zoom/pan engine; image loading stays in the scoped cache.
struct ZoomablePhoto: UIViewRepresentable {
    let image: UIImage
    let isCurrent: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeUIView(context: Context) -> PhotoZoomScrollView { PhotoZoomScrollView() }

    func updateUIView(_ view: PhotoZoomScrollView, context: Context) {
        view.animatesZoom = !reduceMotion
        view.setImage(image)
        if !isCurrent { view.setZoomScale(1, animated: false) }
    }
}

final class PhotoZoomScrollView: UIScrollView, UIScrollViewDelegate {
    let photoView = UIImageView()
    var animatesZoom = true
    private var fittedBounds = CGSize.zero

    init() {
        super.init(frame: .zero)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 4
        bouncesZoom = true
        showsHorizontalScrollIndicator = false
        showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        panGestureRecognizer.isEnabled = false // Fit-sized drags belong to the pager.
        photoView.contentMode = .scaleAspectFit
        addSubview(photoView)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
        isAccessibilityElement = true
        accessibilityLabel = "Photo"
        accessibilityHint = "Double-tap to zoom in or reset zoom."
        accessibilityTraits = .button
        accessibilityIdentifier = "photo-viewer-image"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setImage(_ image: UIImage) {
        guard photoView.image !== image else { return }
        setZoomScale(1, animated: false)
        photoView.image = image
        fittedBounds = .zero
        setNeedsLayout()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // While zoomed, inner panning wins over horizontal page navigation.
        // At fit size its disabled recognizer fails immediately, allowing paging.
        var ancestor = superview
        while let view = ancestor {
            if let pager = view as? UIScrollView {
                pager.panGestureRecognizer.require(toFail: panGestureRecognizer)
            }
            ancestor = view.superview
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0, bounds.height > 0, let image = photoView.image else { return }
        if fittedBounds != bounds.size {
            fittedBounds = bounds.size
            setZoomScale(1, animated: false)
            let fit = min(bounds.width / image.size.width, bounds.height / image.size.height)
            let size = CGSize(width: image.size.width * fit, height: image.size.height * fit)
            photoView.frame = CGRect(origin: .zero, size: size)
            contentSize = size
            centerPhoto()
            contentOffset = CGPoint(x: -contentInset.left, y: -contentInset.top)
        } else {
            centerPhoto()
        }
        updatePanning()
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { photoView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        accessibilityValue = String(format: "%.1f times zoom", zoomScale)
        centerPhoto()
        updatePanning()
    }

    private func updatePanning() {
        panGestureRecognizer.isEnabled = zoomScale > minimumZoomScale + 0.01
    }

    private func centerPhoto() {
        let vertical = max(0, (bounds.height - contentSize.height) / 2)
        let horizontal = max(0, (bounds.width - contentSize.width) / 2)
        let inset = UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
        if contentInset != inset { contentInset = inset }
    }

    @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
        zoom(at: gesture.location(in: photoView), animated: animatesZoom)
    }

    func zoom(at point: CGPoint, animated: Bool) {
        if zoomScale > minimumZoomScale + 0.01 {
            setZoomScale(minimumZoomScale, animated: animated)
        } else {
            let scale = min(3, maximumZoomScale)
            let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
            zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2,
                            width: size.width, height: size.height), animated: animated)
        }
    }

    override func accessibilityActivate() -> Bool {
        zoom(at: photoView.convert(CGPoint(x: bounds.midX, y: bounds.midY), from: self), animated: animatesZoom)
        return true
    }
}

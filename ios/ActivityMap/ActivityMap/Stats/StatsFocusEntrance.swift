import SwiftUI
import UIKit

/// Opening a chart grows its dashboard card into the focus page, so the one
/// chart morphs in place instead of cross-fading with a second copy. The page
/// is pushed without animation over a still of the dashboard it came from.
struct StatsFocusEntrance {
    let tile: StatsTileID
    /// The card's frame in window coordinates.
    let source: CGRect
    /// The dashboard at window size, with the card's slot already empty.
    let backdrop: UIImage?
    /// What the still shows; Back collapses into it only while it is current.
    let dashboardSource: StatsDashboardSource

    /// Captures the dashboard before the push replaces it. A drawn image,
    /// unlike a snapshot view, composites below the growing card.
    @MainActor static func capture(tile: StatsTileID, source: CGRect,
                                   dashboardSource: StatsDashboardSource) -> StatsFocusEntrance {
        let window = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
        let backdrop = window.map { window in
            UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
                UIColor(AppTheme.contentBackground).setFill()
                UIBezierPath(roundedRect: source, cornerRadius: AppTheme.cornerRadius).fill()
            }
        }
        return StatsFocusEntrance(tile: tile, source: source, backdrop: backdrop, dashboardSource: dashboardSource)
    }
}

/// How a dashboard card opens its focus page. Release builds always morph;
/// DEBUG measurement journeys can select the system alternatives.
enum StatsFocusMotion {
    case morph, push, zoom
    static let current: Self = {
        #if DEBUG
        let argument = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--stats-focus-motion=") }
        switch argument?.split(separator: "=").last {
        case "push": return .push
        case "zoom": return .zoom
        default: break
        }
        #endif
        return .morph
    }()
}

extension EnvironmentValues {
    /// The navigation stack's namespace for the system zoom transition.
    @Entry var statsFocusZoom: Namespace.ID? = nil
}

/// Lets the page's Back control collapse the card before popping.
@MainActor final class StatsFocusExit {
    /// Returns false when Back should pop normally.
    var collapse: (() -> Bool)?
}

/// The dashboard still behind the growing card, aligned to the window.
struct StatsFocusBackdrop: View {
    let entrance: StatsFocusEntrance
    /// The page's frame in window coordinates.
    let page: CGRect

    var body: some View {
        if let image = entrance.backdrop {
            Image(uiImage: image)
                .resizable()
                .frame(width: image.size.width, height: image.size.height)
                .offset(x: -page.minX, y: -page.minY)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

/// One interpolated value moves and widens the card and drives the tile's own
/// expansion, so layout, chart size and colour stay on the same clock.
struct StatsFocusEntranceTile<Content: View>: View, Animatable {
    var progress: Double
    let source: CGRect?
    let page: CGRect
    /// The page's scroll offset when collapsing; the card leaves from there.
    var scroll: CGFloat = 0
    /// Receives the presented progress, for choices that must switch mid-way.
    @ViewBuilder let content: (Double) -> Content

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        let remaining = 1 - progress
        let width = source.map { $0.width + (page.width - $0.width) * progress } ?? page.width
        content(progress)
            .environment(\.statsExpansionProgress, progress)
            .frame(width: width, alignment: .topLeading)
            .offset(x: ((source?.minX ?? page.minX) - page.minX) * remaining,
                    y: ((source?.minY ?? page.minY) - page.minY + scroll) * remaining)
            .frame(maxWidth: .infinity, alignment: .leading)
            .transaction { $0.animation = nil }
    }
}

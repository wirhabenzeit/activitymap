import SwiftUI

extension EnvironmentValues {
    /// The navigation stack's namespace for zooming a card into its focus page.
    @Entry var statsFocusZoom: Namespace.ID? = nil
}

extension View {
    /// The focus page zooms out of its dashboard card and back into it, with
    /// the system's interactive dismissal. Reduce Motion cross-fades on iOS 27
    /// and uses standard navigation on iOS 26.
    @ViewBuilder func statsFocusTransition(_ id: StatsTileID, in namespace: Namespace.ID?,
                                           reduceMotion: Bool) -> some View {
        if reduceMotion {
            if #available(iOS 27.0, *) { navigationTransition(.crossFade) } else { self }
        } else if let namespace {
            navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            self
        }
    }
}

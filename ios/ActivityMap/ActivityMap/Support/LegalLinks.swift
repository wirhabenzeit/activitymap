import SwiftUI

/// The public legal and support pages (issue #585). Paths mirror
/// `LEGAL_PATHS` in `src/lib/legal.ts`, and App Store Connect uses the same
/// production URLs. They resolve against the deployment this build talks to,
/// so a device build opens `https://activitymap.cc/privacy`.
enum LegalLinks {
    static var privacy: URL { APIConfiguration.baseURL.appending(path: "privacy") }
    static var terms: URL { APIConfiguration.baseURL.appending(path: "terms") }
    static var support: URL { APIConfiguration.baseURL.appending(path: "support") }
}

/// Strava's official "Powered by Strava" artwork, unmodified (issue #587).
/// Strava's guidelines allow it near, but separate from and no more
/// prominent than, the app's own name; the orange logo is used on light
/// surfaces and the white one on dark, chosen by the asset catalog.
struct PoweredByStrava: View {
    var body: some View {
        Image("PoweredByStrava")
            .resizable()
            .aspectRatio(365.0 / 37.0, contentMode: .fit)
            .frame(height: 16)
            .accessibilityLabel(Text(AppMessages.connectPoweredByStrava()))
            .accessibilityIdentifier("powered-by-strava")
    }
}

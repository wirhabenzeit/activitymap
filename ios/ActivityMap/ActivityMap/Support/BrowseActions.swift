import SwiftUI

/// Semantic metadata owns wording/glyphs; callers own action, placement and tint.
/// Labels retain LocalizedStringResource until rendered in the environment locale.
struct BrowseActionIcon: View {
    let action: NativeActionID
    init(_ action: NativeActionID) { self.action = action }
    var body: some View { Image(systemName: ActionPresentation.glyph(action)) }
}

struct BrowseActionLabel: View {
    let action: NativeActionID
    init(_ action: NativeActionID) { self.action = action }
    @Environment(\.locale) private var locale
    var body: some View {
        Label { Text(ActionPresentation.definition(action.rawValue, locale: locale)!.title) }
              icon: { BrowseActionIcon(action) }
    }
}

/// A passive badge is deliberately smaller than the 44pt interactive toggle.
/// Both use the same active-route meaning; selected and active remain independent.
struct ActiveRoutePresentation {
    enum Variant { case badge, toggle }
    static func glyph(active: Bool, variant: Variant) -> String {
        ActionPresentation.glyph(.activate, variant: variant == .badge ? "badge" : active ? "active" : nil)
    }
    static func state(_ active: Bool, locale: Locale = .current) -> LocalizedStringResource {
        active ? AppMessages.stateActiveRoute(locale: locale) : AppMessages.stateInactiveRoute(locale: locale)
    }
}

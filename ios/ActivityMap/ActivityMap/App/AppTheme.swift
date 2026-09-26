import SwiftUI

enum AppTheme {
    static let headerBackground = Color(hex: "2E6BC9")
    static let headerForeground = Color.white
    static let sidebarBackground = Color(uiColor: .secondarySystemBackground)

    static let sidebarCollapsedWidth: CGFloat = 56
    static let sidebarExpandedWidth: CGFloat = 260
}

/// Regular glass provides contrast over detailed maps; clear glass does not.
struct MapChromeSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .glassEffect(.regular, in: Capsule())
    }
}

struct MapChromeButtonStyle: ButtonStyle {
    var isSelected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Color.primary)
            .frame(width: 44, height: 44)
            .glassEffect(
                isSelected ? .regular.tint(.blue.opacity(0.15)).interactive() : .regular.interactive(),
                in: Circle()
            )
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

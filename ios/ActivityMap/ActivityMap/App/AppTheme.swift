import SwiftUI

enum AppTheme {
    /// Shared with the web navigation brand colour (#1976d2).
    static let navigationBlue = Color(red: 25 / 255, green: 118 / 255, blue: 210 / 255)

    // Semantic roles shared by browsing and Stats. System text/surfaces adapt
    // to appearance and increased contrast; sport hues remain catalogue-owned.
    enum Spacing {
        static let tight: CGFloat = 4
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 16
        static let section: CGFloat = 24
    }

    enum Typography {
        static let title = Font.title2.weight(.semibold)
        static let heading = Font.headline
        static let secondary = Font.subheadline
        static let caption = Font.caption
        static let metric = Font.title3.weight(.semibold)
        static let statsHeadline = Font.title.weight(.semibold)
        // Decorative glyphs stay compact; their text and 44pt hit targets own
        // accessibility, including when Map chrome has fixed camera geometry.
        static let icon = Font.system(size: 18)
    }

    // One brand hue, with a lighter foreground variant on dark surfaces.
    // The asset also covers system controls using Color.accentColor.
    static let accent = Color("AccentColor")
    static let selectionBackground = accent.opacity(0.12)
    /// The List row whose detail is shown beside it; stronger than selection.
    static let inspectionBackground = accent.opacity(0.24)
    static let contentBackground = Color(uiColor: .systemGroupedBackground)
    static let secondaryText = Color(uiColor: .secondaryLabel)
    static let surface = Color(uiColor: .secondarySystemGroupedBackground)
    static let separator = Color(uiColor: .separator)
    static let cornerRadius: CGFloat = 10
    static let minimumTarget: CGFloat = 44
    static let minimumMetricColumnWidth: CGFloat = 100
    static let minimumInlineMetricColumnWidth: CGFloat = 72
    static let minimumDetailColumnWidth: CGFloat = 150

    static let headerBackground = navigationBlue
}

/// Regular glass provides contrast over detailed maps; clear glass does not.
struct MapChromeSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: AppTheme.cornerRadius))
    }
}

struct MapChromeButtonStyle: ButtonStyle {
    var isSelected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body)
            .foregroundStyle(Color.primary)
            .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
            .glassEffect(
                isSelected ? .regular.tint(AppTheme.accent.opacity(0.15)).interactive() : .regular.interactive(),
                in: RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
            )
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// List retains an opaque reading surface; Map supplies one frosted host.
private struct ActivityDetailOverMapKey: EnvironmentKey {
    static let defaultValue = false
}
extension EnvironmentValues {
    var activityDetailOverMap: Bool {
        get { self[ActivityDetailOverMapKey.self] }
        set { self[ActivityDetailOverMapKey.self] = newValue }
    }
}

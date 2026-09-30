import SwiftUI

enum AppTheme {
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

    static let accent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.44, green: 0.65, blue: 0.95, alpha: 1)
            : UIColor(red: 0.18, green: 0.42, blue: 0.79, alpha: 1)
    })
    static let contentBackground = Color(uiColor: .systemGroupedBackground)
    static let surface = Color(uiColor: .secondarySystemGroupedBackground)
    static let separator = Color(uiColor: .separator)
    static let cornerRadius: CGFloat = 10
    static let minimumTarget: CGFloat = 44
    static let minimumMetricColumnWidth: CGFloat = 100
    static let minimumInlineMetricColumnWidth: CGFloat = 72
    static let minimumDetailColumnWidth: CGFloat = 180

    /// Small glyphs need more contrast than route strokes or chart fills. Keep
    /// the catalogue hue, but use readable tones for light/dark foregrounds.
    static func sportSymbolColor(_ category: ActivityCategory) -> Color {
        let light: String
        let dark: String
        switch category {
        case .bcXcSki: (light, dark) = ("176B9E", "57B4EB")
        case .trailHike: (light, dark) = ("C5343A", "FF8589")
        case .run: (light, dark) = ("826200", "FFCA3A")
        case .ride: (light, dark) = ("4A6F13", "8AC926")
        case .misc: (light, dark) = ("6A4C93", "BDA0E4")
        }
        return Color(uiColor: UIColor { traits in
            UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light))
        })
    }
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

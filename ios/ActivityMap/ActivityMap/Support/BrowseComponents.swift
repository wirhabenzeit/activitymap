import SwiftUI

/// Presentation primitives only. Callers own values, availability and actions.
/// These components never filter, select, fetch, format or calculate activity data.
struct BrowseSectionHeading: View {
    let title: String
    var isStatsGroup = false

    var body: some View {
        Text(isStatsGroup ? title.uppercased() : title)
            .font(isStatsGroup ? AppTheme.Typography.caption.weight(.semibold) : AppTheme.Typography.heading)
            .foregroundStyle(isStatsGroup ? Color.secondary : Color.primary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel(title)
            .accessibilityAddTraits(.isHeader)
    }
}

struct BrowseSportSymbol: View {
    let category: ActivityCategory
    var isSelected = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Image(systemName: category.symbolName)
                .font(AppTheme.Typography.icon)
                .foregroundStyle(AppTheme.sportSymbolColor(category))
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(isSelected ? AppTheme.accent : AppTheme.separator, lineWidth: 1))
            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 11)).foregroundStyle(AppTheme.accent)
                    .background(.background, in: Circle())
            }
        }
        // A labelled selection button or sport legend owns accessibility.
        .accessibilityHidden(true)
    }
}

struct BrowseIconButton: View {
    let title: String
    let systemImage: String
    var isSelected = false
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            BrowseIconLabel(systemImage: systemImage, isSelected: isSelected)
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.4)
        .accessibilityLabel(title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Menus and buttons share the same visible label and minimum target. Map
/// callers can preserve their existing 48pt control geometry around this label.
struct BrowseIconLabel: View {
    let systemImage: String
    var isSelected = false

    var body: some View {
        Image(systemName: systemImage)
            .font(AppTheme.Typography.icon)
            .foregroundStyle(isSelected ? AppTheme.accent : Color.primary)
            .frame(minWidth: AppTheme.minimumTarget, minHeight: AppTheme.minimumTarget)
            .contentShape(Rectangle())
    }
}

struct BrowseBadge: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(AppTheme.Typography.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Values arrive already formatted by their existing domain owner. In
/// particular, an unavailable measurement must not be converted to zero.
struct BrowseMetricValue: View {
    enum Emphasis { case compact, detail, headline }
    let title: String
    let value: String
    var emphasis: Emphasis = .compact
    var context: String? = nil

    private var valueFont: Font {
        switch emphasis {
        case .compact: AppTheme.Typography.secondary.weight(.medium)
        case .detail: AppTheme.Typography.metric
        case .headline: AppTheme.Typography.statsHeadline
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.tight) {
            Text(title).font(AppTheme.Typography.caption).foregroundStyle(.secondary)
            Text(value).font(valueFont).monospacedDigit()
            if let context {
                Text(context).font(AppTheme.Typography.caption).foregroundStyle(.secondary)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(([value == Formatters.unknown ? "Not recorded" : value, context]
            .compactMap { $0 }).joined(separator: ". "))
    }
}

struct BrowseSurface: ViewModifier {
    var inset = AppTheme.Spacing.large

    func body(content: Content) -> some View {
        content
            .padding(inset)
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: AppTheme.cornerRadius))
            .overlay(RoundedRectangle(cornerRadius: AppTheme.cornerRadius)
                .strokeBorder(AppTheme.separator.opacity(0.35), lineWidth: 0.5))
    }
}

/// A short status with one recovery owner. Detailed account/sync explanations
/// remain in their existing destination, rather than becoming another toolbar.
struct BrowseStatusLine: View {
    let title: String
    let systemImage: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: AppTheme.Spacing.tight))
            : AnyLayout(HStackLayout(spacing: AppTheme.Spacing.small))
        layout {
            Label(title, systemImage: systemImage)
                .font(AppTheme.Typography.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(AppTheme.Typography.caption)
                    .frame(minWidth: AppTheme.minimumTarget, minHeight: AppTheme.minimumTarget)
            }
        }
    }
}

import SwiftUI

/// Localized app-owned text retains String Catalog metadata until rendering.
/// Activity titles, descriptions and other user content use `.verbatim`.
enum BrowseText {
    case localized(LocalizedStringResource)
    case verbatim(String)

    var text: Text {
        switch self {
        case .localized(let resource): Text(resource)
        case .verbatim(let value): Text(verbatim: value)
        }
    }
}

/// Presentation primitives only. Callers own values, availability and actions.
/// These components never filter, select, fetch, format or calculate activity data.
struct BrowseSectionHeading: View {
    let title: BrowseText
    init(title: BrowseText, isStatsGroup: Bool = false) {
        self.title = title; self.isStatsGroup = isStatsGroup
    }
    init(title: String, isStatsGroup: Bool = false) {
        self.title = .verbatim(title); self.isStatsGroup = isStatsGroup
    }
    init(title: LocalizedStringResource, isStatsGroup: Bool = false) {
        self.title = .localized(title); self.isStatsGroup = isStatsGroup
    }
    var isStatsGroup = false

    var body: some View {
        title.text.textCase(isStatsGroup ? .uppercase : nil)
            .font(isStatsGroup ? AppTheme.Typography.caption.weight(.semibold) : AppTheme.Typography.heading)
            .foregroundStyle(isStatsGroup ? Color.secondary : Color.primary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel(title.text)
            .accessibilityAddTraits(.isHeader)
    }
}

struct BrowseSportSymbol: View {
    let category: ActivityCategory
    var isSelected = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Image(category.assetName)
                .resizable()
                .scaledToFit()
                .foregroundStyle(category.color)
                .frame(width: 26, height: 26)
                .frame(width: 34, height: 34)
                .background(category.color.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(AppTheme.accent)
                    .background(.background, in: Circle())
            }
        }
        // A labelled selection button or sport legend owns accessibility.
        .accessibilityHidden(true)
    }
}

struct BrowseIconButton: View {
    let title: BrowseText

    init(title: String, systemImage: String, isSelected: Bool = false, action: @escaping () -> Void) {
        self.init(title: .verbatim(title), systemImage: systemImage, isSelected: isSelected, action: action)
    }

    init(title: BrowseText, systemImage: String, isSelected: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.isSelected = isSelected
        self.action = action
    }
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
        .accessibilityLabel(title.text)
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
    let title: BrowseText
    init(title: String, systemImage: String) { self.title = .verbatim(title); self.systemImage = systemImage }
    init(title: LocalizedStringResource, systemImage: String) { self.title = .localized(title); self.systemImage = systemImage }
    let systemImage: String

    var body: some View {
        Label { title.text } icon: { Image(systemName: systemImage) }
            .font(AppTheme.Typography.caption)
            .foregroundStyle(AppTheme.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct BrowseSelectionButton: View {
    let title: BrowseText
    init(title: String, isSelected: Bool, isMixed: Bool = false, action: @escaping () -> Void) {
        self.title = .verbatim(title); self.isSelected = isSelected; self.isMixed = isMixed; self.action = action
    }
    init(title: LocalizedStringResource, isSelected: Bool, isMixed: Bool = false, action: @escaping () -> Void) {
        self.title = .localized(title); self.isSelected = isSelected; self.isMixed = isMixed; self.action = action
    }
    let isSelected: Bool
    var isMixed = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isMixed ? "minus.square.fill" : isSelected ? "checkmark.square.fill" : "square")
                .font(AppTheme.Typography.icon)
                .foregroundStyle(isSelected || isMixed ? AppTheme.accent : Color.secondary)
                .frame(minWidth: AppTheme.minimumTarget, minHeight: AppTheme.minimumTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title.text)
        .accessibilityValue(Text(isMixed ? AppMessages.selectionMixed() : isSelected ? AppMessages.selectionSelected() : AppMessages.selectionNotSelected()))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Repeated List metrics use units and compact symbols instead of three
/// stacked label/value blocks. VoiceOver still receives their full names.
struct BrowseInlineMetric: View {
    let title: BrowseText
    init(title: String, value: String, systemImage: String) {
        self.title = .verbatim(title); self.value = value; self.systemImage = systemImage
    }
    init(title: LocalizedStringResource, value: String, systemImage: String) {
        self.title = .localized(title); self.value = value; self.systemImage = systemImage
    }
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: systemImage).font(.system(size: 10)).foregroundStyle(AppTheme.secondaryText)
            Text(value).font(.caption).monospacedDigit()
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title.text)
        .accessibilityValue(value == Formatters.unknown ? String(localized: AppMessages.valueNotRecorded()) : value)
    }
}

/// Values arrive already formatted by their existing domain owner. In
/// particular, an unavailable measurement must not be converted to zero.
struct BrowseMetricValue: View {
    enum Emphasis { case compact, detail, headline }
    let title: BrowseText
    init(title: String, value: String, emphasis: Emphasis = .compact, context: String? = nil, valueFirst: Bool = false) {
        self.title = .verbatim(title); self.value = value; self.emphasis = emphasis; self.context = context; self.valueFirst = valueFirst
    }
    init(title: LocalizedStringResource, value: String, emphasis: Emphasis = .compact, context: String? = nil, valueFirst: Bool = false) {
        self.title = .localized(title); self.value = value; self.emphasis = emphasis; self.context = context; self.valueFirst = valueFirst
    }
    let value: String
    var emphasis: Emphasis = .compact
    var context: String? = nil
    var valueFirst = false

    private var valueFont: Font {
        switch emphasis {
        case .compact: AppTheme.Typography.secondary.weight(.medium)
        case .detail: AppTheme.Typography.metric
        case .headline: AppTheme.Typography.statsHeadline
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.tight) {
            if valueFirst { Text(value).font(valueFont).monospacedDigit() }
            title.text.font(AppTheme.Typography.caption).foregroundStyle(AppTheme.secondaryText)
            if !valueFirst { Text(value).font(valueFont).monospacedDigit() }
            if let context {
                Text(context).font(valueFirst ? .caption2 : AppTheme.Typography.caption).foregroundStyle(AppTheme.secondaryText)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title.text)
        .accessibilityValue(([value == Formatters.unknown ? String(localized: AppMessages.valueNotRecorded()) : value, context]
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
    let title: BrowseText
    init(title: String, systemImage: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.title = .verbatim(title); self.systemImage = systemImage
        self.actionTitle = actionTitle.map(BrowseText.verbatim); self.action = action
    }
    init(title: LocalizedStringResource, systemImage: String, actionTitle: LocalizedStringResource? = nil, action: (() -> Void)? = nil) {
        self.title = .localized(title); self.systemImage = systemImage
        self.actionTitle = actionTitle.map(BrowseText.localized); self.action = action
    }
    let systemImage: String
    var actionTitle: BrowseText? = nil
    var action: (() -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: AppTheme.Spacing.tight))
            : AnyLayout(HStackLayout(spacing: AppTheme.Spacing.small))
        layout {
            Label { title.text } icon: { Image(systemName: systemImage) }
                .font(AppTheme.Typography.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let actionTitle, let action {
                Button(action: action) { actionTitle.text }
                    .font(AppTheme.Typography.caption)
                    .frame(minWidth: AppTheme.minimumTarget, minHeight: AppTheme.minimumTarget)
            }
        }
    }
}

/// Shared identification for List rows and map results. Compact rows keep the
/// local date beside the title; accessibility sizes retain full sport/time text.
struct BrowseActivityHeading: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    @Environment(\.locale) private var locale
    let activity: Activity
    var isActive = false
    var comfortable = true
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        layout {
            HStack(spacing: 4) {
                Text(verbatim: activity.name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(typeSize.isAccessibilitySize ? nil : comfortable ? 2 : 1)
                if isActive {
                    Image(systemName: ActiveRoutePresentation.glyph(active: true, variant: .badge)).font(.caption2).foregroundStyle(AppTheme.accent)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if typeSize.isAccessibilitySize {
                Text(AppMessages.activityRowSubtitle(activity.sportType.editingTitle, Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt, locale: locale, dateFormat: preferences?.dateFormat ?? .system), locale: locale))
                    .font(.caption).foregroundStyle(AppTheme.secondaryText)
            } else {
                Text(Formatters.shortDate(activity.startDateLocal, timeZone: .gmt, locale: locale, dateFormat: preferences?.dateFormat ?? .system))
                    .font(.caption2).foregroundStyle(AppTheme.secondaryText).fixedSize()
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: activity.name))
        .accessibilityValue(Text(isActive ? AppMessages.activityRowActiveAccessible(activity.sportType.editingTitle, Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt, locale: locale, dateFormat: preferences?.dateFormat ?? .system), locale: locale) : AppMessages.activityRowAccessible(activity.sportType.editingTitle, Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt, locale: locale, dateFormat: preferences?.dateFormat ?? .system), locale: locale)))
    }
}

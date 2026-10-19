import SwiftUI

/// The layout policy for all main navigation bars. Safe-area space remains
/// system-owned; these heights describe the controls below it.
struct AppToolbarLayout: Equatable {
    static let compactHeight = AppTheme.minimumTarget
    static let regularHeight: CGFloat = 54
    static let spacing: CGFloat = 8
    static let horizontalInset: CGFloat = 16

    let isCompact: Bool
    let packsListControls: Bool
    var height: CGFloat { isCompact ? Self.compactHeight : Self.regularHeight }
    var titleLineLimit: Int { isCompact ? 1 : 2 }
    var pickerHeight: CGFloat { isCompact ? 36 : AppTheme.minimumTarget }
    var pickerHorizontalInset: CGFloat { isCompact ? 2 : 3 }
    var pickerVerticalInset: CGFloat { isCompact ? 0 : 3 }

    init(size: CGSize = .zero, verticalSizeClass: UserInterfaceSizeClass?, typeSize: DynamicTypeSize) {
        let supportsCompact = !typeSize.isAccessibilitySize
        isCompact = supportsCompact && (verticalSizeClass == .compact || size.width > size.height)
        packsListControls = supportsCompact && verticalSizeClass == .compact
    }
}

extension EnvironmentValues {
    @Entry var appToolbarLayout: AppToolbarLayout? = nil
}

/// The shell supplies window geometry for iPad and split windows. Standalone
/// navigation pages still follow the same policy using their native traits.
@propertyWrapper struct AppToolbarEnvironment: DynamicProperty {
    @Environment(\.appToolbarLayout) private var inherited
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    var wrappedValue: AppToolbarLayout {
        inherited ?? AppToolbarLayout(verticalSizeClass: verticalSizeClass, typeSize: typeSize)
    }
}

/// Destinations supply actions and identity once. Both native portrait bars
/// and the compact landscape renderer consume these same slots.
struct AppToolbar: ToolbarContent {
    let leading: AnyView
    let principal: AnyView
    let trailing: AnyView
    var identifier = "app-toolbar"

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) { leading }
            .sharedBackgroundVisibility(.hidden)
        ToolbarItem(placement: .principal) { principal }
        ToolbarItemGroup(placement: .topBarTrailing) { trailing }
            .sharedBackgroundVisibility(.hidden)
    }

    var bar: some View { AppToolbarBar(items: self) }
}

private struct AppToolbarBar: View {
    let items: AppToolbar
    @AppToolbarEnvironment private var layout

    var body: some View {
        HStack(spacing: AppToolbarLayout.spacing) {
            side(items.leading, alignment: .leading)
            items.principal.layoutPriority(1)
            side(items.trailing, alignment: .trailing)
        }
        .padding(.horizontal, AppToolbarLayout.horizontalInset)
        .frame(height: layout.height)
        .foregroundStyle(.white)
        .background(AppTheme.navigationBlue.ignoresSafeArea(edges: [.top, .horizontal]))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(items.identifier)
    }

    private func side(_ content: AnyView, alignment: Alignment) -> some View {
        // EmptyView otherwise removes its flexible frame, pushing a centered
        // title to the far edge on pages without trailing actions.
        ZStack {
            Color.clear.frame(width: 0, height: 0)
            content
        }
        .frame(maxWidth: .infinity, alignment: alignment)
    }
}

extension View {
    /// Keep the page and its navigation controller mounted when layout changes.
    /// Compact chrome lives in the page's safe-area inset, so native pushes and
    /// swipe-Back keep their existing owners and retained scroll positions.
    func appNavigationBar(_ toolbar: AppToolbar, visible: Bool = true,
                          compactPlaceholder: Bool = false, embedded: Bool = false) -> some View {
        modifier(AppNavigationBar(toolbar: toolbar, visible: visible,
                                  compactPlaceholder: compactPlaceholder, embedded: embedded))
    }
}

private struct AppNavigationBar: ViewModifier {
    let toolbar: AppToolbar
    let visible: Bool
    let compactPlaceholder: Bool
    let embedded: Bool
    @AppToolbarEnvironment private var layout

    func body(content: Content) -> some View {
        content
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(visible && !layout.isCompact && !embedded ? .visible : .hidden, for: .navigationBar)
            .toolbarBackground(AppTheme.navigationBlue, for: .navigationBar)
            .toolbarBackgroundVisibility(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar { if visible && !layout.isCompact && !embedded { toolbar } }
            .safeAreaInset(edge: .top, spacing: 0) {
                if visible && (layout.isCompact || embedded) {
                    if compactPlaceholder {
                        Color.clear.frame(height: layout.height).allowsHitTesting(false)
                    } else { toolbar.bar }
                }
            }
    }
}

/// Shared visual Back control; each destination retains its navigation action.
struct AppToolbarBackButton: View {
    let label: String
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            BrowseActionIcon(.back)
                .font(.system(size: 20, weight: .medium))
                .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }
}

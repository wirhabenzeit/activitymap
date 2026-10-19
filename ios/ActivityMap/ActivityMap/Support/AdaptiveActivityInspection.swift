import SwiftUI

/// Presentation state only: the caller continues to own the inspected ID.
/// A pushed page stays pushed through rotation; a hidden pane cannot push.
struct ActivityInspectionState: Equatable {
    var pushed = false
    var awaitingWidth = false

    mutating func reconcile(hasSelection: Bool, adjacent: Bool, active: Bool, waitsForWidth: Bool) {
        guard hasSelection else { self = Self(); return }
        guard active else { return }
        if adjacent { awaitingWidth = false }
        else if !pushed && waitsForWidth { awaitingWidth = true }
        else { pushed = true; awaitingWidth = false }
    }

    mutating func layoutChanged(hasSelection: Bool, adjacent: Bool, active: Bool) {
        guard hasSelection else { self = Self(); return }
        if adjacent { awaitingWidth = false }
        else if active {
            // A rotation/size change is not a newly requested filter collapse.
            // Even a stale collapse hint must not strand inspection offscreen.
            pushed = true
            awaitingWidth = false
        }
    }

    func presentsPage(adjacent: Bool, active: Bool, waitsForWidth: Bool = false) -> Bool {
        // Also fence the initial projection, before onChange stores awaitingWidth.
        active && (pushed || (!adjacent && !awaitingWidth && !waitsForWidth))
    }
}

struct ActivityInspectionLayout {
    let width: CGFloat
    let adjacent: Bool
    let showsPanel: Bool
    let pushed: Bool
    var panelWidth: CGFloat { min(420, max(340, width * 0.42)) }
    var contentWidth: CGFloat { showsPanel ? max(0, width - panelWidth - 1) : width }
}

/// Owns the adaptive split, close affordance and native push/pop mechanics.
/// List/Stats supply independent bindings and feature-specific destinations.
struct AdaptiveActivityInspection<Content: View, Panel: View, Destination: View>: View {
    @Environment(\.locale) private var locale
    @Binding var selection: Int?
    var externalPushed: Binding<Bool>? = nil
    var active = true
    /// Retained List tabs keep an existing panel/page mounted; Stats disables
    /// inactive navigation levels so only its current level owns a destination.
    var retainsPresentationWhenInactive = false
    var registersNavigation = true
    var waitsForWidth = false
    var widthOverride: CGFloat? = nil
    var dividerIgnoresBottom = false
    var rootToolbar: AppToolbar? = nil
    var rootHeader: AppToolbar? = nil
    let closeIdentifier: String
    let panelIdentifier: String
    @ViewBuilder var content: (ActivityInspectionLayout) -> Content
    @ViewBuilder var panel: (Int) -> Panel
    @ViewBuilder var destination: (Int) -> Destination
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var localState = ActivityInspectionState()

    private var state: ActivityInspectionState {
        var state = localState
        if let externalPushed { state.pushed = externalPushed.wrappedValue }
        return state
    }

    var body: some View {
        GeometryReader { geometry in
            let width = widthOverride ?? geometry.size.width
            let adjacent = BrowsePaneLayout.supportsDetail(width: width, regular: sizeClass == .regular,
                                                           accessibilityText: typeSize.isAccessibilitySize)
            let layout = ActivityInspectionLayout(width: width, adjacent: adjacent,
                showsPanel: (active || retainsPresentationWhenInactive) && adjacent && !state.pushed && selection != nil, pushed: state.pushed)
            HStack(spacing: 0) {
                content(layout).frame(width: layout.contentWidth, alignment: .leading)
                if layout.showsPanel, let id = selection {
                    Divider().ignoresSafeArea(edges: dividerIgnoresBottom ? .bottom : [])
                    panel(id)
                        .overlay(alignment: .topTrailing) {
                            Button { selection = nil } label: {
                                BrowseActionIcon(.close)
                                    .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .padding(.trailing, AppTheme.Spacing.large)
                            .padding(.top, AppTheme.Spacing.small)
                            .accessibilityLabel(Text(AppMessages.actionCloseActivityDetails(locale: locale)))
                            .accessibilityIdentifier(closeIdentifier)
                        }
                        .frame(width: layout.panelWidth)
                        .frame(maxHeight: .infinity)
                        .accessibilityIdentifier(panelIdentifier)
                }
            }
            .modifier(InspectionRootChrome(toolbar: rootToolbar, header: rootHeader,
                                           visible: active && (!adjacent || state.pushed)))
            .modifier(ActivityInspectionNavigation(enabled: registersNavigation,
                selection: Binding(
                    get: { state.presentsPage(adjacent: adjacent, active: active || (retainsPresentationWhenInactive && state.pushed), waitsForWidth: waitsForWidth) ? selection : nil },
                    set: { id in
                        // Hidden tabs and a newly adjacent panel retain inspection.
                        if state.presentsPage(adjacent: adjacent, active: active || (retainsPresentationWhenInactive && state.pushed), waitsForWidth: waitsForWidth) {
                            selection = id
                            if id == nil { updateState(ActivityInspectionState()) }
                        }
                    }), destination: destination))
            .onChange(of: selection, initial: true) { _, _ in reconcile(adjacent: adjacent) }
            .onChange(of: adjacent) { _, _ in
                var next = state
                next.layoutChanged(hasSelection: selection != nil, adjacent: adjacent, active: active)
                updateState(next)
            }
            .onChange(of: active) { _, isActive in
                if isActive {
                    // Reactivation is not a new selection / filter-collapse request.
                    var next = state
                    next.layoutChanged(hasSelection: selection != nil, adjacent: adjacent, active: true)
                    updateState(next)
                }
            }
        }
    }

    private func reconcile(adjacent: Bool) {
        var next = state
        next.reconcile(hasSelection: selection != nil, adjacent: adjacent, active: active, waitsForWidth: waitsForWidth)
        updateState(next)
    }

    private func updateState(_ next: ActivityInspectionState) {
        localState = next
        if externalPushed?.wrappedValue != next.pushed { externalPushed?.wrappedValue = next.pushed }
    }
}

/// Only the active Stats navigation level registers this destination type.
/// It remains distinct from tile IDs and other app navigation values.
// Navigation identity represents the inspection level, not the activity. A
// neighbour replaces its content without popping/pushing another destination.
private struct InspectedActivityDestination: Hashable {}
private struct ActivityInspectionNavigation<Destination: View>: ViewModifier {
    let enabled: Bool
    @Binding var selection: Int?
    @ViewBuilder var destination: (Int) -> Destination
    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.navigationDestination(item: Binding(
                get: { selection.map { _ in InspectedActivityDestination() } },
                set: { if $0 == nil { selection = nil } }
            )) { _ in
                if let id = selection { destination(id) }
            }
        } else { content }
    }
}

private struct InspectionRootChrome: ViewModifier {
    let toolbar: AppToolbar?
    let header: AppToolbar?
    let visible: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if let header {
            content.appNavigationBar(header)
        } else if let toolbar {
            content.appNavigationBar(toolbar, visible: visible)
        } else { content }
    }
}


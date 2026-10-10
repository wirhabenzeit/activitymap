import SwiftUI

/// The same activity content as List, with inspection owned by Stats so that
/// opening a record never changes map selection or the List's inspected row.
struct StatsActivityInspection<Content: View>: View {
    let store: ActivityStore
    let dashboard: StatsDashboardState
    var active = true
    var registersNavigation = true
    let backLabel: String
    @ViewBuilder var content: () -> Content
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var pushed = false

    var body: some View {
        GeometryReader { geometry in
            let adjacent = sizeClass == .regular && geometry.size.width >= BrowsePaneLayout.minimumDetailWidth
                && !typeSize.isAccessibilitySize
            let showsPanel = active && adjacent && !pushed && dashboard.inspectedActivityID != nil
            let panelWidth = min(420, max(340, geometry.size.width * 0.42))
            HStack(spacing: 0) {
                content()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if showsPanel, let id = dashboard.inspectedActivityID {
                    Divider()
                    ActivityDetailPanel(store: store, activityID: id, headerTrailingInset: 44, hostTab: .stats, showOnMap: { id in
                        if store.showOnMap(id) == .shown { dashboard.inspectedActivityID = nil }
                    })
                    .overlay(alignment: .topTrailing) {
                        Button { dashboard.inspectedActivityID = nil } label: {
                            Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.trailing, AppTheme.Spacing.large)
                        .padding(.top, AppTheme.Spacing.small)
                        .accessibilityLabel("Close activity details")
                        .accessibilityIdentifier("stats-activity-close")
                    }
                    .frame(width: panelWidth)
                    .accessibilityIdentifier("stats-activity-panel")
                }
            }
            .environment(\.statsAvailableWidth, geometry.size.width)
            .environment(\.statsInspectedActivityID, active ? dashboard.inspectedActivityID : nil)
            .modifier(StatsInspectionNavigation(enabled: registersNavigation, store: store, dashboard: dashboard,
                                                backLabel: backLabel, selection: Binding(
                get: { active && (!adjacent || pushed) ? dashboard.inspectedActivityID : nil },
                set: { id in
                    if active && (!adjacent || pushed) { dashboard.inspectedActivityID = id }
                    if id == nil { pushed = false }
                }
            )))
            .onChange(of: dashboard.inspectedActivityID) { _, id in
                if id == nil { pushed = false }
                else if active && !adjacent { pushed = true }
            }
            .onChange(of: adjacent) { _, wide in
                // Preserve an existing navigation destination through rotation.
                if !wide && active && dashboard.inspectedActivityID != nil { pushed = true }
            }
        }
    }
}

/// Only the active navigation level registers an activity destination type.
/// Otherwise SwiftUI chooses the dashboard's registration over the focus page.
private struct StatsInspectedActivity: Hashable { let id: Int }

private struct StatsInspectionNavigation: ViewModifier {
    let enabled: Bool
    let store: ActivityStore
    let dashboard: StatsDashboardState
    let backLabel: String
    @Binding var selection: Int?
    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.navigationDestination(item: Binding(
                get: { selection.map { StatsInspectedActivity(id: $0) } },
                set: { selection = $0?.id }
            )) { item in
                ActivityDetailView(store: store, activityID: item.id, backLabel: backLabel,
                                   backIdentifier: "stats-activity-back", onMapShown: {
                    dashboard.inspectedActivityID = nil
                }, hostTab: .stats)
            }
        } else { content }
    }
}

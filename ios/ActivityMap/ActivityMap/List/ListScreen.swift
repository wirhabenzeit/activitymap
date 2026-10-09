import SwiftUI

struct ListScreen: View {
    @Bindable var store: ActivityStore
    var emptyState: BrowsingPresentation.EmptyState? = nil
    var recover: (BrowsingPresentation.Recovery) -> Void = { _ in }
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.browsePaneWidth) private var paneWidth
    @State private var hasPushedDetail = false
    /// Inspection started while the shell collapses its filter panel; the
    /// adjacent detail appears once the wider layout arrives.
    @State private var awaitingWidth = false
    @Environment(\.filtersCollapseForDetail) private var filtersCollapseForDetail
    // iPhone landscape: the shell bar carries the status/options row (#315).
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    var body: some View {
        GeometryReader { geometry in
            let width = paneWidth ?? geometry.size.width
            // Filters overlay the List or are pinned only where detail still
            // fits beside it, so this width never changes while inspecting (#354).
            let sideBySide = sizeClass == .regular && width >= BrowsePaneLayout.minimumDetailWidth && !typeSize.isAccessibilitySize
            let showsDetail = sideBySide && store.inspectedActivityID != nil && !hasPushedDetail
            let detailWidth = min(420, max(340, width * 0.42))
            let listWidth = showsDetail ? width - detailWidth - 1 : width
            HStack(spacing: 0) {
                activityList(width: listWidth, inspectedID: showsDetail ? store.inspectedActivityID : nil)
                    .frame(width: listWidth)
                if showsDetail {
                    // Flush with the status bar, which extends under the home indicator.
                    Divider().ignoresSafeArea(edges: .bottom)
                    detailColumn
                        .frame(width: detailWidth)
                        .frame(maxHeight: .infinity)
                }
            }
            // Inspecting is ordinary navigation. Back only clears inspection;
            // the retained list and selection/camera owners remain unchanged.
            .navigationDestination(item: inspectionID(sideBySide: sideBySide || awaitingWidth)) { id in
                ActivityDetailView(store: store, activityID: id)
            }
            .onChange(of: store.inspectedActivityID, initial: true) { _, id in
                if id == nil { hasPushedDetail = false; awaitingWidth = false }
                else if !sideBySide && filtersCollapseForDetail { awaitingWidth = true }
                else if !sideBySide { hasPushedDetail = true }
            }
            .onChange(of: sideBySide) { _, wide in
                if wide { awaitingWidth = false }
                // A hidden List can narrow while Map or Stats has the filter
                // panel beside it; that must not turn its detail into a page.
                else if store.inspectedActivityID != nil, store.selectedTab == .list { hasPushedDetail = true }
            }
        }
    }

    private func activityList(width: CGFloat, inspectedID: Int?) -> some View {
        List {
            ForEach(store.listedActivities) { activity in
                ActivityRowView(store: store, activity: activity, availableWidth: width,
                                isInspected: activity.id == inspectedID)
                    .listRowInsets(EdgeInsets(top: verticalSizeClass == .compact ? 2 : 4, leading: 8,
                                              bottom: verticalSizeClass == .compact ? 2 : 4, trailing: 8))
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 44 }
                    .listRowBackground(ActivityRowBackground(selected: store.selectedActivityIDs.contains(activity.id),
                                                            inspected: activity.id == inspectedID))
            }
            if let emptyState {
                BrowsingEmptyView(state: emptyState, recover: recover, scrolls: false)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .safeAreaInset(edge: .top, spacing: 0) {
            if ActivityTableLayout.supports(store.listPresentation.settings, typeSize: typeSize, availableWidth: width) {
                ActivityTableHeader(store: store, availableWidth: width,
                                    rowHeight: verticalSizeClass == .compact ? 32 : 44)
            } else if store.listPresentation.settings.width == .columns && !typeSize.isAccessibilitySize {
                // A resized window or older saved preferences can exceed the
                // column budget. Keep every metric visible and explain the fallback.
                HStack {
                    Text("These metrics need more room.")
                        .font(.caption).foregroundStyle(AppTheme.secondaryText)
                    Spacer(minLength: 8)
                    Button("Use Details") { store.listPresentation.settings.width = .details }
                        .font(.caption.weight(.medium)).frame(minHeight: 44)
                }
                .padding(.horizontal, AppTheme.Spacing.small)
                .background(AppTheme.surface)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if verticalSizeClass != .compact {
                HStack(spacing: AppTheme.Spacing.small) {
                    SelectionBar(store: store, includesTotal: true)
                    Spacer(minLength: 8)
                    ListControls(presentation: store.listPresentation, iconOnly: true)
                }
                .padding(.horizontal, AppTheme.Spacing.small)
                .background(.bar)
                .overlay(alignment: .top) { Color(uiColor: .separator).frame(height: 0.5) }
                .accessibilityIdentifier("list-status-bar")
            }
        }
        .modifier(ListOptionsSheets(presentation: store.listPresentation, availableWidth: width))
    }

    @ViewBuilder private var detailColumn: some View {
        if let id = store.inspectedActivityID {
            ActivityDetailPanel(store: store, activityID: id, headerTrailingInset: 44)
                .overlay(alignment: .topTrailing) {
                    Button { store.dismissInspection() } label: {
                        Image(systemName: "xmark")
                            .frame(width: 44, height: 44)
                            // A plain button only hits drawn pixels; keep the full target.
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, AppTheme.Spacing.large)
                    .padding(.top, AppTheme.Spacing.small)
                    .accessibilityLabel("Close activity details")
                }
        }
    }

    private func inspectionID(sideBySide: Bool) -> Binding<Int?> {
        Binding(
            get: { (!sideBySide || hasPushedDetail) && store.selectedTab == .list ? store.inspectedActivityID : nil },
            set: { id in
                // Keep an already-pushed detail open through width changes.
                // Tab changes retain inspection; native Back clears it in List.
                if id == nil, (!sideBySide || hasPushedDetail), store.selectedTab == .list {
                    store.dismissInspection()
                    hasPushedDetail = false
                }
            }
        )
    }
}

/// Selection count and scoped bulk actions for the list.
struct SelectionBar: View {
    @Bindable var store: ActivityStore
    var iconOnly = false
    var includesTotal = false
    /// White on the blue shell bar instead of the List's own status bar.
    var onNavigationBar = false

    private var selectedCount: Int { store.selectedActivityIDs.count }

    private var summary: String {
        let filteredCount = store.visibleActivityIDs.count
        let visibleCount = selectedCount - store.hiddenSelectedCount
        let hidden = store.hiddenSelectedCount
        let scope = "\(visibleCount) of \(filteredCount) filtered activities selected"
        return hidden > 0 ? "\(scope) · \(hidden) hidden by filters" : scope
    }

    private var visibleSummary: String {
        let count = selectedCount - store.hiddenSelectedCount
        let total = store.visibleActivityIDs.count
        let scope = selectedCount == 0 ? "\(total) activities"
            : includesTotal ? "\(count) selected · \(total) activities" : "\(count) selected"
        return store.hiddenSelectedCount > 0 ? "\(scope) · \(store.hiddenSelectedCount) hidden" : scope
    }

    var body: some View {
        // iOS grows a menu out of its button and absorbs the button's label,
        // so only the icon is the menu: the count stays readable beside it (#283).
        HStack(spacing: 2) {
            Menu {
                Text(visibleSummary)
                Divider()
                Button("Select All Filtered Activities") {
                    store.selectAllFiltered()
                }
                .disabled(store.visibleActivityIDs.isEmpty)
                Button("Deselect All Filtered Activities") {
                    store.deselectAllFiltered()
                }
                .disabled(selectedCount == store.hiddenSelectedCount)
                Button("Clear Selection", role: .destructive) {
                    store.clearSelection()
                }
                .disabled(selectedCount == 0)
            } label: {
                Group {
                    if iconOnly {
                        Image(systemName: selectedCount > 0 ? "checkmark.square.fill" : "square")
                            .font(.body)
                            .foregroundStyle(selectedCount > 0 ? AppTheme.accent : Color.secondary)
                    } else {
                        HStack(spacing: 3) {
                            Image(systemName: selectedCount > 0 ? "checkmark.circle.fill" : "checklist")
                                .foregroundStyle(onNavigationBar ? Color.white : selectedCount > 0 ? AppTheme.accent : Color.secondary)
                            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(onNavigationBar ? AnyShapeStyle(Color.white.opacity(0.9)) : AnyShapeStyle(.secondary))
                        }
                    }
                }
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Selection actions for all filtered activities")
            .accessibilityValue(summary)
            if !iconOnly {
                Text(visibleSummary).font(.caption.weight(.medium))
                    .foregroundStyle(onNavigationBar ? AnyShapeStyle(Color.white.opacity(0.9)) : AnyShapeStyle(.secondary))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityHidden(true) // read as the menu's value
            }
        }
        .buttonStyle(.plain)
    }
}

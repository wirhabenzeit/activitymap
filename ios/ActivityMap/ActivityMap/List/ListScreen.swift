import SwiftUI

struct ListScreen: View {
    @Bindable var store: ActivityStore
    var emptyState: BrowsingPresentation.EmptyState? = nil
    var recover: (BrowsingPresentation.Recovery) -> Void = { _ in }
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.browsePaneWidth) private var paneWidth
    @Environment(\.listShellNavigation) private var shellNavigation
    @Environment(\.listRootToolbar) private var shellToolbar
    @Environment(\.listRootHeader) private var shellHeader
    @State private var localPushedDetail = false
    private var hasPushedDetail: Bool {
        get { shellNavigation?.detailPresented ?? localPushedDetail }
        nonmutating set {
            if let shellNavigation { shellNavigation.detailPresented = newValue }
            else { localPushedDetail = newValue }
        }
    }
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
            .modifier(ListRootChrome(toolbar: shellToolbar, header: shellHeader,
                                     visible: store.selectedTab == .list && (!sideBySide || hasPushedDetail)))
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
        let activities = store.listedActivities
        let speedDisplay = SpeedDisplay.forActivities(activities)
        return List {
            ForEach(activities) { activity in
                ActivityRowView(store: store, activity: activity, availableWidth: width,
                                isInspected: activity.id == inspectedID, speedDisplay: speedDisplay)
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
                                    rowHeight: verticalSizeClass == .compact ? 32 : 44, speedDisplay: speedDisplay)
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
        .modifier(ListOptionsSheets(presentation: store.listPresentation, availableWidth: width, speedDisplay: speedDisplay))
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

private struct ListRootChrome: ViewModifier {
    let toolbar: BrowseRootToolbar?
    let header: AnyView?
    let visible: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if let header {
            content
                .toolbar(.hidden, for: .navigationBar)
                .safeAreaInset(edge: .top, spacing: 0) { header }
        } else if let toolbar {
            content
                .toolbar(visible ? .visible : .hidden, for: .navigationBar)
                .toolbarBackground(AppTheme.navigationBlue, for: .navigationBar)
                .toolbarBackgroundVisibility(.visible, for: .navigationBar)
                .toolbarColorScheme(.dark, for: .navigationBar)
                .toolbar { toolbar }
        } else { content }
    }
}

/// Hosted outside the owning navigation stack, including the outer Stats shell.
struct BrowseListFooter: View {
    @Bindable var store: ActivityStore
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        if store.selectedTab == .list && (verticalSizeClass != .compact || typeSize.isAccessibilitySize) {
            HStack(spacing: 8) {
                SelectionBar(store: store, includesTotal: true, expandsCount: true)
                ListControls(presentation: store.listPresentation, store: store, iconOnly: true)
            }
            .padding(.horizontal, 8).background(.bar)
            .overlay(alignment: .top) { Color(uiColor: .separator).frame(height: 0.5) }
            .accessibilityIdentifier("list-status-bar")
        }
    }
}

/// Shared native group controls; the mode is a direct button, not a menu.
struct SelectionBar: View {
    @Bindable var store: ActivityStore
    var iconOnly = false
    var includesTotal = false
    var onNavigationBar = false
    var showsClear = true
    var expandsCount = false

    var body: some View {
        HStack(spacing: 2) {
            Button { store.setCombine(!store.isCombining) } label: {
                Image(systemName: "checklist").font(.body)
                    .foregroundStyle(onNavigationBar ? Color.white : store.isCombining ? AppTheme.accent : Color.secondary)
                    .frame(width: 32, height: 32)
                    .background(store.isCombining ? AppTheme.accent.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 10))
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Combine selections")
            .accessibilityValue(store.isCombining ? "On" : "Off")
            .accessibilityAddTraits(store.isCombining ? .isSelected : [])
            .accessibilityIdentifier("combine-selection")
            if !iconOnly {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text("\(store.selectedActivityIDs.count) selected").font(.caption.weight(.medium))
                        if store.onlySelected { Image(systemName: "line.3.horizontal.decrease").font(.caption2) }
                    }
                    if store.hiddenSelectedCount > 0 { Text("\(store.hiddenSelectedCount) hidden by filters").font(.caption2) }
                    if store.isCombining { Text("Combine on").font(.caption2) }
                    else if store.onlySelected { Text("Selected only").font(.caption2) }
                    else if includesTotal { Text("\(store.browsingActivities.count) activities").font(.caption2) }
                }.foregroundStyle(onNavigationBar ? AnyShapeStyle(Color.white) : AnyShapeStyle(.secondary))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: expandsCount ? .infinity : nil, alignment: .leading)
            }
            if showsClear && !store.selectedActivityIDs.isEmpty {
                SelectionShareButton(store: store, onNavigationBar: onNavigationBar)
                Button { store.clearSelection() } label: { Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(Rectangle()) }
                    .accessibilityLabel("Clear selection").accessibilityIdentifier("clear-selection")
            }
        }.buttonStyle(.plain)
    }
}

struct ActivitySelectionSymbol: View {
    @Bindable var store: ActivityStore
    let activity: Activity
    private var selected: Bool { store.selectedActivityIDs.contains(activity.id) }
    var body: some View {
        if store.isCombining {
            Button { store.toggleMember(activity.id) } label: {
                BrowseSportSymbol(category: activity.category, isSelected: selected)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }.buttonStyle(.plain)
                .accessibilityLabel("\(selected ? "Deselect" : "Select") \(activity.name)")
                .accessibilityValue(selected ? "Selected" : "Not selected")
                .accessibilityAddTraits(selected ? .isSelected : [])
        } else {
            BrowseSportSymbol(category: activity.category)
                .frame(width: 44, height: 44)
                .accessibilityHidden(false).accessibilityLabel(activity.sportType.rawValue)
        }
    }
}

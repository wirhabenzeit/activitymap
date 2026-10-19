import SwiftUI

struct ListScreen: View {
    @Bindable var store: ActivityStore
    var emptyState: BrowsingPresentation.EmptyState? = nil
    var recover: (BrowsingPresentation.Recovery) -> Void = { _ in }
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
    @Environment(\.filtersCollapseForDetail) private var filtersCollapseForDetail
    // iPhone landscape: the shell bar carries the status/options row (#315).
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    var body: some View {
        AdaptiveActivityInspection(selection: Binding(get: { store.inspectedActivityID }, set: { id in
            if id == nil { store.dismissInspection() }
        }), externalPushed: Binding(get: { hasPushedDetail }, set: { hasPushedDetail = $0 }),
            active: store.selectedTab == .list, retainsPresentationWhenInactive: true,
            waitsForWidth: filtersCollapseForDetail,
            widthOverride: paneWidth, dividerIgnoresBottom: true, rootToolbar: shellToolbar, rootHeader: shellHeader,
            closeIdentifier: "list-activity-close", panelIdentifier: "list-activity-panel") { layout in
            activityList(width: layout.contentWidth, inspectedID: layout.showsPanel ? store.inspectedActivityID : nil)
        } panel: { id in
            ActivityDetailPanel(store: store, activityID: id, headerTrailingInset: AppTheme.minimumTarget)
                .modifier(ListActivityContinuation(store: store, activityID: id))
        } destination: { id in
            ActivityDetailView(store: store, activityID: id)
                .modifier(ListActivityContinuation(store: store, activityID: id))
        }
        // The footer belongs to the root page, so native push/pop and
        // interactive Back carry it with the list rather than hiding it later.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            BrowseListFooter(store: store)
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

}

/// Root-page controls remain available beside an adjacent inspector and
/// leave with the list during native navigation to a full-page detail.
struct BrowseListFooter: View {
    @Bindable var store: ActivityStore
    @AppToolbarEnvironment private var toolbarLayout
    var body: some View {
        if store.selectedTab == .list && !toolbarLayout.packsListControls {
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

    private var combineForeground: Color {
        if onNavigationBar { return store.isCombining ? AppTheme.navigationBlue : .white }
        return store.isCombining ? AppTheme.accent : .secondary
    }

    private var combineBackground: Color {
        guard store.isCombining else { return .clear }
        return onNavigationBar ? .white : AppTheme.accent.opacity(0.14)
    }

    var body: some View {
        HStack(spacing: 2) {
            Button { store.setCombine(!store.isCombining) } label: {
                Image(systemName: "checklist").font(.body)
                    .foregroundStyle(combineForeground)
                    .frame(width: 32, height: 32)
                    .background(combineBackground, in: RoundedRectangle(cornerRadius: 10))
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

/// Continue within the current sorted/filtered List, independently of map selection.
private struct ListActivityContinuation: ViewModifier {
    let store: ActivityStore
    let activityID: Int
    private var sequence: ActivityDetailSequence {
        ActivityDetailSequence(ids: store.listedActivities.map(\.id), currentID: activityID)
    }

    func body(content: Content) -> some View {
        content
            .environment(\.activityDetailPaging, ActivityDetailPaging(position: { id in
                ActivityDetailSequence(ids: store.listedActivities.map(\.id), currentID: id).position
            }, previous: { if let id = sequence.previousID { inspect(id) } },
               next: { if let id = sequence.nextID { inspect(id) } },
               canGoPrevious: { id in ActivityDetailSequence(ids: store.listedActivities.map(\.id), currentID: id).previousID != nil },
               canGoNext: { id in ActivityDetailSequence(ids: store.listedActivities.map(\.id), currentID: id).nextID != nil }))
            .environment(\.activityDetailContinuation, continuation)
    }

    private var continuation: ActivityDetailContinuation? {
        let previous = sequence.previousID.flatMap { store.activity(id: $0) }
            .map { ActivityDetailContinuation.Destination(id: $0.id, name: $0.name) }
        let next = sequence.nextID.flatMap { store.activity(id: $0) }
            .map { ActivityDetailContinuation.Destination(id: $0.id, name: $0.name) }
        guard previous != nil || next != nil else { return nil }
        return ActivityDetailContinuation(currentID: activityID, previous: previous, next: next,
            isEnabled: store.selectedTab == .list) { direction in
                // Resolve again on release: a filter or sort change must never
                // continue to an activity from a stale sequence.
                let target = direction == .previous ? previous : next
                let liveID = direction == .previous ? sequence.previousID : sequence.nextID
                guard let target, liveID == target.id else { return }
                inspect(target.id)
            }
    }

    private func inspect(_ id: Int) {
        guard store.selectedTab == .list, store.inspectedActivityID == activityID else { return }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { store.inspect(id) }
    }
}

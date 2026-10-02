import SwiftUI

struct ListScreen: View {
    @Bindable var store: ActivityStore
    var emptyState: BrowsingPresentation.EmptyState? = nil
    var recover: (BrowsingPresentation.Recovery) -> Void = { _ in }
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var hasPushedDetail = false

    var body: some View {
        GeometryReader { geometry in
            let sideBySide = sizeClass == .regular && geometry.size.width >= 650
            HStack(spacing: 0) {
                activityList
                    .frame(width: sideBySide ? min(400, max(360, geometry.size.width * 0.45)) : nil)
                    // The list column has phone-like width even on a wide host.
                    .environment(\.horizontalSizeClass, sideBySide ? .compact : sizeClass)
                if sideBySide {
                    Divider()
                    detailColumn
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            // Inspecting is ordinary navigation. Back only clears inspection;
            // the retained list and selection/camera owners remain unchanged.
            .navigationDestination(item: inspectionID(sideBySide: sideBySide)) { id in
                ActivityDetailView(store: store, activityID: id)
            }
            .onChange(of: store.inspectedActivityID, initial: true) { _, id in
                if id == nil { hasPushedDetail = false }
                else if !sideBySide { hasPushedDetail = true }
            }
            .onChange(of: sideBySide) { _, wide in
                if !wide, store.inspectedActivityID != nil { hasPushedDetail = true }
            }
        }
    }

    private var activityList: some View {
        List {
            ForEach(store.listedActivities) { activity in
                ActivityRowView(store: store, activity: activity)
                    .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 44 }
                    .listRowBackground(store.selectedActivityIDs.contains(activity.id) ? AppTheme.accent.opacity(0.07) : Color(uiColor: .systemBackground))
            }
            if let emptyState {
                BrowsingEmptyView(state: emptyState, recover: recover, scrolls: false)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .safeAreaInset(edge: .top, spacing: 0) {
            if ActivityTableLayout.supports(store.listPresentation.settings, typeSize: typeSize) {
                ActivityTableHeader(store: store)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: AppTheme.Spacing.small) {
                        SelectionBar(store: store)
                        Spacer(minLength: 0)
                        ListControls(presentation: store.listPresentation)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        SelectionBar(store: store)
                        ListControls(presentation: store.listPresentation).padding(.leading, 44)
                    }
                }
                .padding(.horizontal, AppTheme.Spacing.small)
                .background(.thinMaterial, ignoresSafeAreaEdges: [])
                .accessibilityIdentifier("list-browse-toolbar")
            }
        }
    }

    @ViewBuilder private var detailColumn: some View {
        if let id = store.inspectedActivityID {
            ActivityDetailPanel(store: store, activityID: id, headerTrailingInset: 44)
                .overlay(alignment: .topTrailing) {
                    Button { store.dismissInspection() } label: {
                        Image(systemName: "xmark")
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, AppTheme.Spacing.large)
                    .padding(.top, AppTheme.Spacing.small)
                    .accessibilityLabel("Close activity details")
                }
        } else {
            ContentUnavailableView("Choose an activity", systemImage: "figure.run",
                                   description: Text("Open an activity from the list to see its details."))
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

    private var selectedCount: Int { store.selectedActivityIDs.count }

    private var summary: String {
        let filteredCount = store.selection.visibleIDs.count
        let visibleCount = selectedCount - store.hiddenSelectedCount
        let hidden = store.hiddenSelectedCount
        let scope = "\(visibleCount) of \(filteredCount) filtered activities selected"
        return hidden > 0 ? "\(scope) · \(hidden) hidden by filters" : scope
    }

    private var visibleSummary: String {
        let count = selectedCount - store.hiddenSelectedCount
        let scope = selectedCount == 0 ? "\(store.selection.visibleIDs.count) activities" : "\(count) selected"
        return store.hiddenSelectedCount > 0 ? "\(scope) · \(store.hiddenSelectedCount) hidden" : scope
    }

    var body: some View {
        HStack(spacing: 0) {
            Menu {
                Text(visibleSummary)
                Divider()
                Button("Select All Filtered Activities") {
                    store.selectAllFiltered()
                }
                .disabled(store.selection.visibleIDs.isEmpty)
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
                            .frame(width: 44, height: 44)
                    } else {
                        HStack(spacing: 4) {
                            Image(systemName: selectedCount > 0 ? "checkmark.circle.fill" : "checklist")
                                .foregroundStyle(selectedCount > 0 ? AppTheme.accent : Color.secondary)
                            Text(visibleSummary).font(.caption.weight(.medium))
                                .fixedSize(horizontal: false, vertical: true)
                            Image(systemName: "chevron.down").font(.system(size: 9))
                        }
                        .foregroundStyle(.secondary)
                        .frame(minHeight: 44)
                    }
                }
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Selection actions for all filtered activities")
            .accessibilityValue(summary)
        }
        .buttonStyle(.plain)
    }
}

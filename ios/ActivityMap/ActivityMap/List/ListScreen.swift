import SwiftUI

struct ListScreen: View {
    @Bindable var store: ActivityStore
    var emptyState: BrowsingPresentation.EmptyState? = nil
    var recover: (BrowsingPresentation.Recovery) -> Void = { _ in }
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        GeometryReader { geometry in
            List {
                if store.listPresentation.settings.summaryMode != .off {
                    ActivitySummaryView(store: store)
                }
                ForEach(store.listedActivities) { activity in
                    ActivityRowView(store: store, activity: activity)
                        .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    if sizeClass == .regular, store.inspectedActivityID == activity.id {
                        VStack(spacing: 0) {
                            HStack {
                                Text("Activity details").font(.headline)
                                Spacer()
                                Button("Close") { store.dismissInspection() }
                                    .frame(minWidth: 44, minHeight: 44)
                                    .accessibilityLabel("Close activity details")
                            }
                            .padding(.horizontal, 20)
                            ActivityDetailPanel(store: store, activityID: activity.id)
                                .frame(height: max(220, min(560, geometry.size.height - 160)))
                        }
                        .listRowInsets(EdgeInsets())
                    }
                }
                if let emptyState {
                    BrowsingEmptyView(state: emptyState, recover: recover, scrolls: false)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
            }
            .listStyle(.plain)
            .safeAreaInset(edge: .top, spacing: 0) {
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
                .background(.bar, ignoresSafeAreaEdges: [])
            }
        }
        // List inspection is independent of selection and the active route.
        .sheet(item: inspectedActivity) { activity in
            ActivityDetailView(store: store, activityID: activity.id)
        }
    }

    private var inspectedActivity: Binding<Activity?> {
        Binding(
            get: { sizeClass != .regular && store.selectedTab == .list ? store.inspectedActivity : nil },
            set: { if $0 == nil, sizeClass != .regular, store.selectedTab == .list { store.dismissInspection() } }
        )
    }
}

/// Selection count and scoped bulk actions for the list.
private struct SelectionBar: View {
    @Bindable var store: ActivityStore
    @Environment(\.dynamicTypeSize) private var typeSize

    private var selectedCount: Int { store.selectedActivityIDs.count }

    private var summary: String {
        let filteredCount = store.filteredActivities.count
        let visibleCount = selectedCount - store.hiddenSelectedCount
        let hidden = store.hiddenSelectedCount
        let scope = "\(visibleCount) of \(filteredCount) filtered activities selected"
        return hidden > 0 ? "\(scope) · \(hidden) hidden by filters" : scope
    }

    private var visibleSummary: String {
        let count = selectedCount - store.hiddenSelectedCount
        let scope = selectedCount == 0 ? "\(store.filteredActivities.count) activities" : "\(count)/\(store.filteredActivities.count) selected"
        return store.hiddenSelectedCount > 0 ? "\(scope) · \(store.hiddenSelectedCount) hidden" : scope
    }

    private var allFilteredSelected: Bool {
        let count = selectedCount - store.hiddenSelectedCount
        return count > 0 && count == store.filteredActivities.count
    }

    var body: some View {
        HStack(spacing: 0) {
            BrowseSelectionButton(title: allFilteredSelected ? "Deselect all filtered activities" : "Select all filtered activities",
                                  isSelected: allFilteredSelected,
                                  isMixed: !allFilteredSelected && selectedCount > store.hiddenSelectedCount) {
                if allFilteredSelected { store.deselectAllFiltered() }
                else { store.selectAllFiltered() }
            }
            .disabled(store.filteredActivities.isEmpty)
            Menu {
                Button("Select All Filtered Activities") {
                    store.selectAllFiltered()
                }
                .disabled(store.filteredActivities.isEmpty)
                Button("Deselect All Filtered Activities") {
                    store.deselectAllFiltered()
                }
                .disabled(selectedCount == store.hiddenSelectedCount)
                Button("Clear Selection", role: .destructive) {
                    store.clearSelection()
                }
                .disabled(selectedCount == 0)
            } label: {
                HStack(spacing: 4) {
                    Text(visibleSummary).font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                    Image(systemName: "chevron.down").font(.system(size: 9))
                }
                .foregroundStyle(.secondary)
                .frame(minHeight: 44)
            }
            .accessibilityLabel("Selection actions for all filtered activities")
            .accessibilityValue(summary)
        }
        .buttonStyle(.plain)
    }
}

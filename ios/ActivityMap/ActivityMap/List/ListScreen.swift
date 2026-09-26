import SwiftUI

struct ListScreen: View {
    @Bindable var store: ActivityStore

    var body: some View {
        List(store.filteredActivities) { activity in
            ActivityRowView(store: store, activity: activity)
        }
        .listStyle(.plain)
        .safeAreaInset(edge: .top, spacing: 0) {
            SelectionBar(store: store)
        }
        // List inspection is independent of selection and the active route.
        .sheet(item: inspectedActivity) { activity in
            ActivityDetailView(activity: activity)
        }
    }

    private var inspectedActivity: Binding<Activity?> {
        Binding(
            get: { store.selectedTab == .list ? store.inspectedActivity : nil },
            set: { if $0 == nil, store.selectedTab == .list { store.dismissInspection() } }
        )
    }
}

/// Selection count and scoped bulk actions for the list.
private struct SelectionBar: View {
    @Bindable var store: ActivityStore

    private var selectedCount: Int { store.selectedActivityIDs.count }

    private var summary: String {
        guard selectedCount > 0 else { return "No activities selected" }
        let hidden = store.hiddenSelectedCount
        return hidden > 0
            ? "\(selectedCount) selected · \(hidden) hidden by filters"
            : "\(selectedCount) selected"
    }

    var body: some View {
        HStack {
            Text(summary)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
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
                Label("Selection", systemImage: "checklist")
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel("Selection actions")
        }
        .padding(.horizontal)
        .background(.bar)
    }
}

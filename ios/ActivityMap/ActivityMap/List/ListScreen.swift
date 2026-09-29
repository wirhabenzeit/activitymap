import SwiftUI

struct ListScreen: View {
    @Bindable var store: ActivityStore
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        GeometryReader { geometry in
            List(store.listedActivities) { activity in
                ActivityRowView(store: store, activity: activity)
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
            .listStyle(.plain)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 0) {
                    ListControls(presentation: store.listPresentation)
                    SelectionBar(store: store)
                }
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
        guard typeSize.isAccessibilitySize else { return summary }
        let count = selectedCount - store.hiddenSelectedCount
        let scope = "\(count)/\(store.filteredActivities.count) selected"
        return store.hiddenSelectedCount > 0 ? "\(scope) · \(store.hiddenSelectedCount) hidden" : scope
    }

    private var selectionSymbol: String {
        let count = selectedCount - store.hiddenSelectedCount
        if count == 0 { return "square" }
        return count == store.filteredActivities.count ? "checkmark.square.fill" : "minus.square.fill"
    }

    var body: some View {
        HStack {
            Text(visibleSummary)
                .accessibilityLabel(summary)
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
                Label("Selection", systemImage: selectionSymbol)
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel("Selection actions for all filtered activities")
            .accessibilityValue(summary)
        }
        .padding(.horizontal)
        .background(.bar, ignoresSafeAreaEdges: [])
    }
}

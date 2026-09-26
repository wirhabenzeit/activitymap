import SwiftUI

/// A focused overlap chooser; the persistent map results panel belongs to #209.
struct RoutePickerSheet: View {
    @Bindable var picker: RoutePicker
    @Bindable var store: ActivityStore
    @Environment(\.dismiss) private var dismiss

    private var candidates: [Activity] {
        let byID = Dictionary(uniqueKeysWithValues: store.filteredActivities.map { ($0.id, $0) })
        return picker.candidateIDs.compactMap { byID[$0] }
    }

    var body: some View {
        Group {
            if let id = picker.detailID, let activity = candidates.first(where: { $0.id == id }) {
                ActivityDetailView(activity: activity)
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if candidates.count > 1 {
                            Button {
                                picker.detailID = nil
                            } label: {
                                Label("\(candidates.count) routes here", systemImage: "chevron.left")
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .padding(.horizontal)
                            }
                            .background(.bar)
                        }
                    }
            } else {
                NavigationStack {
                    List(candidates) { activity in
                        let selected = store.selectedActivityIDs.contains(activity.id)
                        HStack(spacing: 12) {
                            Button {
                                store.toggleSelection(activity.id)
                            } label: {
                                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(selected ? "Deselect" : "Select") \(activity.name)")

                            Button {
                                if !selected { store.addToSelection([activity.id]) }
                                picker.showDetail(activity.id, store: store)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(activity.name).foregroundStyle(.primary)
                                    Text(Formatters.shortDate(activity.startDateLocal, timeZone: .gmt))
                                        .font(.caption).foregroundStyle(.secondary)
                                    if store.activeActivityID == activity.id {
                                        Label("Active route", systemImage: "location.fill")
                                            .font(.caption)
                                    }
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Activate route and open details")
                        }
                    }
                    .navigationTitle("\(candidates.count) routes here")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { dismiss() }
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }
}

import SwiftUI

/// PROTOTYPE: search-first header. Typing only previews results; the filter
/// state changes only through the explicit rows.
struct SearchFirstSheet: View {
    @Bindable var store: ActivityStore
    @Environment(\.dismiss) private var dismiss
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    @State private var query = ""
    @FocusState private var focused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var matchingActivities: [Activity] {
        guard !trimmed.isEmpty else { return [] }
        return store.activities
            .filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
            .sorted { $0.startDate > $1.startDate }
    }
    private var places: [LibraryPlace] { trimmed.isEmpty ? [] : Array(store.placeLibrary.search(trimmed).places.prefix(10)) }

    var body: some View {
        NavigationStack {
            List {
                if !trimmed.isEmpty {
                    let activities = matchingActivities
                    Section("Activities") {
                        if activities.isEmpty { Text("No activities").foregroundStyle(.secondary) }
                        ForEach(activities.prefix(20)) { activity in
                            Button {
                                store.showOnMap(activity.id)
                                dismiss()
                            } label: { activityRow(activity) }
                            .foregroundStyle(.primary)
                        }
                    }
                    Section("Places") {
                        if places.isEmpty { Text("No places").foregroundStyle(.secondary) }
                        ForEach(places) { item in
                            Button {
                                store.selectPlace(item)
                                dismiss()
                            } label: {
                                HStack(spacing: 10) {
                                    PlaceGlyph(kind: item.place.kind).frame(width: 18, height: 18)
                                    VStack(alignment: .leading) {
                                        Text(item.place.name)
                                        Text("\(item.kindLabel) · \(item.activityCount) activities")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .foregroundStyle(.primary)
                        }
                    }
                    Section {
                        Button {
                            store.searchText = trimmed
                            dismiss()
                        } label: {
                            Label("Filter to \(activities.count) activities named “\(trimmed)”",
                                  systemImage: "line.3.horizontal.decrease")
                        }
                        .accessibilityIdentifier("search-first-apply-filter")
                    }
                }
            }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Activities or places")
            .searchFocused($focused)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .onAppear { focused = true }
        }
        .tint(AppTheme.accent)
    }

    private func activityRow(_ activity: Activity) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(activity.name).lineLimit(1)
            Text("\(Formatters.shortDate(activity.startDateLocal, timeZone: .gmt)) · \(Formatters.distance(activity.distance, units: preferences?.units ?? .metric))")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

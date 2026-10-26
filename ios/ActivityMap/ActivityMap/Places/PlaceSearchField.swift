import SwiftUI

/// Place matches as one row of chips, choosing one filters to that place.
private struct PlaceMatchRow: View {
    let options: [LibraryPlace]
    let hasQuery: Bool
    let units: UnitSystem
    let select: (LibraryPlace) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                if options.isEmpty {
                    Text(hasQuery ? "No matching places" : "Type to filter by name or find a place")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                }
                ForEach(options) { item in
                    Button { select(item) } label: {
                        Label { Text(item.place.name).lineLimit(1) } icon: {
                            PlaceGlyph(kind: item.place.kind).frame(width: 14, height: 14)
                        }
                        .font(.subheadline)
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .accessibilityLabel("Place: \(item.place.name). \(placeDescription(item))")
                    .accessibilityIdentifier("place-suggestion-\(item.id)")
                }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
        }
        .scrollIndicators(.hidden)
    }

    private func placeDescription(_ item: LibraryPlace) -> String {
        let elevation = item.place.elevationM.map { " · \(Int(($0 / units.elevationScale).rounded())) \(units.elevationUnit)" } ?? ""
        return "\(item.kindLabel)\(elevation) · \(item.activityCount) \(item.activityCount == 1 ? "activity" : "activities")"
    }
}

/// Activity-name and place search as rows of a filter form, so it scrolls
/// with the other filters. Typing filters immediately; place matches show
/// under the field while it has text and focus, and the chosen place sits in
/// the field as a pill.
struct InlinePlaceSearch: View {
    @Bindable var store: ActivityStore
    var autofocus = false
    /// Called when Search is pressed.
    var onFinish: () -> Void = {}
    @FocusState private var focused: Bool
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    private var hasQuery: Bool { !store.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            SelectedPlacePill(store: store)
            TextField(store.selectedPlace == nil ? "Activities or places" : "Activity name", text: $store.searchText)
                .focused($focused)
                .submitLabel(.search)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit { focused = false; onFinish() }
                .onAppear { if autofocus { focused = true } }
                .accessibilityIdentifier("activity-search")
            if !store.searchText.isEmpty {
                Button { store.searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Clear search")
                .accessibilityIdentifier("clear-activity-search")
            }
        }
        if let selected = store.selectedPlace, store.placeLibrary.byID[selected.id] == nil {
            Text("No activities for this place.").font(.caption).foregroundStyle(.secondary)
        }
        if focused, hasQuery {
            // Selecting a place clears the name text and keeps the keyboard.
            PlaceMatchRow(options: store.placeLibrary.search(store.searchText).places, hasQuery: true, units: units) {
                store.selectPlace($0)
            }
            .listRowInsets(EdgeInsets())
        }
    }
}

/// The selected place as a pill: its name opens the details, the cross removes
/// it. Beside a field it takes at most half the row, truncating long names.
struct SelectedPlacePill: View {
    @Bindable var store: ActivityStore
    @Environment(\.dismiss) private var dismiss
    @State private var detail: LibraryPlace?

    var body: some View {
        if let selected = store.selectedPlace {
            HStack(spacing: 0) {
                Button { detail = store.placeLibrary.byID[selected.id] } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "mappin").font(.caption)
                        Text(selected.name).font(.subheadline.weight(.medium))
                            .lineLimit(1).truncationMode(.tail)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(store.placeLibrary.byID[selected.id] == nil)
                .accessibilityLabel("Place: \(selected.name). View details")
                .accessibilityIdentifier("selected-place-details")
                .layoutPriority(1)
                Button { store.selectedPlace = nil } label: {
                    Image(systemName: "xmark").font(.caption.weight(.semibold))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove place filter: \(selected.name)")
                .accessibilityIdentifier("remove-place-filter")
            }
            .padding(.leading, 10)
            .foregroundStyle(AppTheme.accent)
            .background(AppTheme.accent.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("selected-place-token")
            .sheet(item: $detail) { item in
                NavigationStack {
                    if let current = store.placeLibrary.byID[item.id] {
                        PlaceDetailView(item: current) { destination in
                            store.show(current, in: destination)
                            detail = nil
                            dismiss()
                        }
                    } else { Text("No activities for this place.").padding() }
                }
            }
        }
    }
}

/// The iPad sidebar and rail show a launcher row that opens the inline search
/// in its own sheet, with the selected place as a removable pill beside it.
struct PlaceSearchField: View {
    @Bindable var store: ActivityStore
    @State private var searchPresented = false

    var body: some View {
        HStack(spacing: 8) {
            SelectedPlacePill(store: store)
            Button { searchPresented = true } label: {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    Text(store.searchText.isEmpty ? (store.selectedPlace == nil ? "Activities or places" : "Activity name") : store.searchText)
                        .foregroundStyle(store.searchText.isEmpty ? Color.secondary : Color.primary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Search activity names or choose a place")
            .accessibilityValue(store.searchText)
            .accessibilityIdentifier("activity-search-open")
            if !store.searchText.isEmpty {
                Button { store.searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary).frame(width: 44, height: 44)
                }.buttonStyle(.borderless).accessibilityLabel("Clear Search")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity-search-field")
        .sheet(isPresented: $searchPresented) { PlaceSearchSheet(store: store) }
        .onChange(of: store.placeUserID) { _, _ in searchPresented = false }
        .onChange(of: store.filterResetRevision) { _, _ in searchPresented = false }
        if let selected = store.selectedPlace, store.placeLibrary.byID[selected.id] == nil {
            Text("No activities for this place.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// The inline search in its own sheet, focused on open. Search or Done
/// returns to the form; name text and places filter as they are chosen.
private struct PlaceSearchSheet: View {
    @Bindable var store: ActivityStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form { InlinePlaceSearch(store: store, autofocus: true) { dismiss() } }
                .navigationTitle("Search").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }.accessibilityIdentifier("place-search-done")
                    }
                }
        }
        .tint(AppTheme.accent)
    }
}

/// Reusable compact inspection; showing it does not select activities.
struct PlaceDetailView: View {
    let item: LibraryPlace
    var showsDone = true
    let show: (AppTab) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }

    var body: some View {
        List {
            Label { Text(item.place.name).font(.headline) } icon: { PlaceGlyph(kind: item.place.kind).frame(width: 20, height: 20) }
            Text(item.kindLabel)
            if let elevation = item.place.elevationM { Text("\(Int((elevation / units.elevationScale).rounded())) \(units.elevationUnit)") }
            Text("\(item.activityCount) \(item.activityCount == 1 ? "activity" : "activities")")
            Text(String(format: "Location: %.4f, %.4f", item.place.latitude, item.place.longitude)).foregroundStyle(.secondary)
            LabeledContent("First visit", value: Formatters.dayKey(item.firstVisit, timeZone: .gmt))
            LabeledContent("Latest visit", value: Formatters.dayKey(item.latestVisit, timeZone: .gmt))
            Button("Show activities") { show(.list) }
            Button("Show on map") { show(.map) }
        }
        .navigationTitle("Place").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if showsDone { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

extension ActivityStore {
    /// Place details' Show actions filter to the place in the chosen tab.
    func show(_ place: LibraryPlace, in destination: AppTab) {
        selectPlace(place)
        setOnlySelected(false)
        selectedTab = destination
        if destination == .map {
            mapContext.showPlaces = true
            mapContext.request(.fitFiltered)
        }
    }
}

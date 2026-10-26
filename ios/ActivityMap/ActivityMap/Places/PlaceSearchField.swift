import SwiftUI

extension PlaceFilter: Identifiable {}

extension View {
    /// System search for activity names and places: the selected place is a
    /// search token and place hints are search suggestions, so the system owns
    /// keyboard avoidance and replaces the content while suggestions show.
    func placeSearch(store: ActivityStore, isPresented: Binding<Bool>, onSelectPlace: @escaping () -> Void = {},
                     onSubmit: @escaping () -> Void = {}) -> some View {
        modifier(PlaceSearch(store: store, isPresented: isPresented, onSelectPlace: onSelectPlace, onSubmit: onSubmit))
    }
}

private struct PlaceSearch: ViewModifier {
    @Bindable var store: ActivityStore
    @Binding var isPresented: Bool
    let onSelectPlace: () -> Void
    let onSubmit: () -> Void
    // Leaving system search empties its field and tokens. The field edits a
    // copy that reaches the store only while searching, so Cancel keeps the
    // filter; it is cleared in the field or by Reset. Ending search from code
    // clears the field after its animation, too late to restore typed text,
    // so Search only hides the keyboard.
    @State private var query: String
    @State private var tokens: [PlaceFilter]
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    private var hasQuery: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var options: [LibraryPlace] { hasQuery ? store.placeLibrary.search(query).places : [] }
    private var storeTokens: [PlaceFilter] { store.selectedPlace.map { [$0] } ?? [] }

    init(store: ActivityStore, isPresented: Binding<Bool>, onSelectPlace: @escaping () -> Void, onSubmit: @escaping () -> Void) {
        self.store = store
        _isPresented = isPresented
        self.onSelectPlace = onSelectPlace
        self.onSubmit = onSubmit
        _query = State(initialValue: store.searchText)
        _tokens = State(initialValue: store.selectedPlace.map { [$0] } ?? [])
    }

    func body(content: Content) -> some View {
        content
            .searchable(text: $query, tokens: $tokens, isPresented: $isPresented,
                        placement: .navigationBarDrawer(displayMode: .always),
                        prompt: Text(tokens.isEmpty ? "Activities or places" : "Activity name")) { token in
                Label(token.name, systemImage: "mappin")
            }
            .searchSuggestions {
                ForEach(options) { item in
                    suggestion(item)
                        .searchCompletion(PlaceFilter(id: item.id, name: item.place.name, userID: store.placeUserID ?? ""))
                }
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit(of: .search, onSubmit)
            .onChange(of: query) { _, value in
                if isPresented { store.searchText = value } else if value != store.searchText { restoreField() }
            }
            .onChange(of: tokens) { _, value in
                // One place at a time: a newly completed token replaces the old one.
                if let added = value.last, added != store.selectedPlace, let place = store.placeLibrary.byID[added.id] {
                    store.selectPlace(place)
                    // Choosing a place ends search (the system may already
                    // have) and clears the text, so only the token needs
                    // redrawing once the field has emptied itself.
                    isPresented = false
                    tokens = []
                    onSelectPlace()
                } else if value != storeTokens {
                    if isPresented { store.selectedPlace = value.last } else { restoreField() }
                }
            }
            .onChange(of: store.searchText) { _, value in if query != value { restoreField() } }
            .onChange(of: store.selectedPlace) { _, _ in if tokens != storeTokens { restoreField() } }
    }

    /// The field finishes clearing itself after search ends; restoring in
    /// the same update would leave it showing nothing.
    private func restoreField() {
        DispatchQueue.main.async {
            query = store.searchText
            tokens = storeTokens
        }
    }

    private func suggestion(_ item: LibraryPlace) -> some View {
        HStack(spacing: 12) {
            PlaceGlyph(kind: item.place.kind)
                .frame(width: 16, height: 16)
                .foregroundStyle(Color.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.place.name).foregroundStyle(Color.primary).lineLimit(1)
                Text(placeDescription(item)).font(.caption).foregroundStyle(Color.secondary).lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Place: \(item.place.name). \(placeDescription(item))")
        .accessibilityIdentifier("place-suggestion-\(item.id)")
    }

    private func placeDescription(_ item: LibraryPlace) -> String {
        let elevation = item.place.elevationM.map { " · \(Int(($0 / units.elevationScale).rounded())) \(units.elevationUnit)" } ?? ""
        return "\(item.kindLabel)\(elevation) · \(item.activityCount) \(item.activityCount == 1 ? "activity" : "activities")"
    }
}

/// The selected place inside a filter form whose search lives in the
/// navigation bar; the token there removes it, this row inspects it.
struct SelectedPlaceRow: View {
    @Bindable var store: ActivityStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let selected = store.selectedPlace {
            if let current = store.placeLibrary.byID[selected.id] {
                NavigationLink {
                    PlaceDetailView(item: current, showsDone: false) { destination in
                        store.show(current, in: destination)
                        dismiss()
                    }
                } label: {
                    Label { Text(selected.name).lineLimit(1) } icon: {
                        PlaceGlyph(kind: current.place.kind).frame(width: 16, height: 16)
                    }
                }
                .accessibilityLabel("Place: \(selected.name). View details")
                .accessibilityIdentifier("selected-place-token")
            } else {
                Text("No activities for this place.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

/// Where the form cannot host system search (the iPad sidebar and rail), a
/// launcher opens it in its own sheet.
struct PlaceSearchField: View {
    @Bindable var store: ActivityStore
    @Environment(\.dismiss) private var dismiss
    @State private var searchPresented = false
    @State private var detail: LibraryPlace?
    @State private var fieldWidth: CGFloat = 320

    var body: some View {
        HStack(spacing: 8) {
            if store.selectedPlace != nil {
                selectedPlaceToken
                    .frame(maxWidth: fieldWidth * (store.searchText.isEmpty ? 0.65 : 0.5), alignment: .leading)
            }
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
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { fieldWidth = $0 }
        .sheet(isPresented: $searchPresented) { PlaceSearchSheet(store: store) }
        .sheet(item: $detail) { item in detailContent(item) }
        .onChange(of: store.placeUserID) { _, _ in detail = nil; searchPresented = false }
        .onChange(of: store.filterResetRevision) { _, _ in searchPresented = false }
        if let selected = store.selectedPlace, store.placeLibrary.byID[selected.id] == nil {
            Text("No activities for this place.").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var selectedPlaceToken: some View {
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
                .layoutPriority(1)
                Button { store.selectedPlace = nil } label: {
                    Image(systemName: "xmark").font(.caption.weight(.semibold))
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove place filter: \(selected.name)")
            }
            .padding(.leading, 10)
            .foregroundStyle(AppTheme.accent)
            .background(AppTheme.accent.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("selected-place-token")
        }
    }

    private func detailContent(_ item: LibraryPlace) -> some View {
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

/// System search in its own sheet, focused on open. Choosing a place, Search
/// or Done returns to the form; name text keeps filtering as it is typed.
private struct PlaceSearchSheet: View {
    @Bindable var store: ActivityStore
    @Environment(\.dismiss) private var dismiss
    @State private var searching = true

    var body: some View {
        NavigationStack {
            ContentUnavailableView("Search activity names or places", systemImage: "magnifyingglass")
                .placeSearch(store: store, isPresented: $searching, onSelectPlace: { dismiss() }, onSubmit: { dismiss() })
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

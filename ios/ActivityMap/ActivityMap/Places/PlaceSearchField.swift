import SwiftUI

/// The filter form only hosts a launcher. Editing lives in its own fixed-size
/// sheet so inserting search suggestions cannot relayout the filter form.
struct PlaceSearchField: View {
    @Bindable var store: ActivityStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
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
        .sheet(isPresented: $searchPresented) {
            ActivityPlaceSearchSheet(store: store)
                .presentationDetents(typeSize.isAccessibilitySize ? [.large] : [.height(76)])
                .presentationCompactAdaptation(.none)
                .presentationDragIndicator(.hidden)
        }
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
                    store.selectPlace(current)
                    store.setOnlySelected(false)
                    store.selectedTab = destination
                    if destination == .map {
                        store.mapContext.showPlaces = true
                        store.mapContext.request(.fitFiltered)
                    }
                    detail = nil
                    dismiss()
                }
            } else { Text("No activities for this place.").padding() }
        }
    }
}

/// A text-only sheet; place hints are owned by the keyboard accessory.
private struct ActivityPlaceSearchSheet: View {
    @Bindable var store: ActivityStore
    @Environment(\.dismiss) private var dismiss
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    @State private var activeSuggestion: Int?
    @State private var query: String
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var inputFontSize: CGFloat = 17
    private var hintHeight: CGFloat { max(44, inputFontSize * 1.2 + 16) }
    private var units: UnitSystem { preferences?.units ?? .metric }
    private var hasQuery: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var options: [LibraryPlace] { hasQuery ? store.placeLibrary.search(query).places : [] }

    init(store: ActivityStore) {
        self.store = store
        _query = State(initialValue: store.searchText)
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                KeyboardPlaceSearchInput(text: $query, fontSize: inputFontSize, accessoryHeight: hintHeight,
                                         showsAccessory: hasQuery, onSubmit: submit, onMoveSuggestion: moveSuggestion,
                                         onCancel: { dismiss() },
                                         accessory: hintBar.environment(\.dynamicTypeSize, typeSize))
                    .frame(maxWidth: .infinity)
                    .onChange(of: query) { _, value in
                        activeSuggestion = nil
                        store.searchText = value
                    }
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).accessibilityLabel("Clear Search")
                }
                Button("Done", action: submit)
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("place-search-done")
            }
            .padding(.horizontal, 16)
        }
        .padding(.top, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .tint(AppTheme.accent)
    }

    private var hintBar: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.element.id) { index, item in
                        Button {
                            store.selectPlace(item)
                            dismiss()
                        } label: {
                            HStack(spacing: 6) {
                                PlaceGlyph(kind: item.place.kind).frame(width: 14, height: 14)
                                Text(item.place.name).font(.body).lineLimit(1)
                                if options.filter({ $0.place.name == item.place.name }).count > 1 {
                                    Text("\(item.activityCount)").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .padding(.horizontal, 16)
                            .frame(minWidth: 96, minHeight: hintHeight)
                            .background(activeSuggestion == index ? AppTheme.accent.opacity(0.12) : .clear)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.primary)
                        .accessibilityLabel("Place: \(item.place.name). \(placeDescription(item))")
                        .accessibilityIdentifier("place-suggestion-\(item.id)")
                        .id(item.id)
                        if index < options.count - 1 { Divider().frame(height: 20) }
                    }
                    if options.isEmpty {
                        Text("No places found.").font(.subheadline).foregroundStyle(.secondary)
                            .padding(.horizontal, 16).frame(height: hintHeight)
                    }
                }
            }
            .clipped()
            .padding(.horizontal, 16)
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.never)
            .accessibilityLabel("Place suggestions")
            .accessibilityIdentifier("place-search-suggestions")
            .onChange(of: query) { _, _ in
                if let first = options.first { proxy.scrollTo(first.id, anchor: .leading) }
            }
            .onChange(of: activeSuggestion) { _, index in
                if let index, options.indices.contains(index) { proxy.scrollTo(options[index].id) }
            }
        }
        .frame(height: hintHeight)
        .overlay(alignment: .top) { Divider() }
        .animation(nil, value: query)
    }

    private func submit() {
        if let activeSuggestion, options.indices.contains(activeSuggestion) {
            store.selectPlace(options[activeSuggestion])
        } else {
            store.searchText = query
        }
        dismiss()
    }

    private func moveSuggestion(_ direction: Int) {
        guard !options.isEmpty else { return }
        activeSuggestion = min(options.count - 1, max(0, (activeSuggestion ?? (direction > 0 ? -1 : options.count)) + direction))
    }

    private func placeDescription(_ item: LibraryPlace) -> String {
        let elevation = item.place.elevationM.map { " · \(Int(($0 / units.elevationScale).rounded())) \(units.elevationUnit)" } ?? ""
        return "\(item.kindLabel)\(elevation) · \(item.activityCount) \(item.activityCount == 1 ? "activity" : "activities")"
    }
}

/// Reusable compact inspection; showing it does not select activities.
struct PlaceDetailView: View {
    let item: LibraryPlace
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
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
}

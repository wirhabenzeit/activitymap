import SwiftUI

/// The place filter as a pill in Filters: its name opens the details, the
/// cross removes it. Long names truncate.
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
    /// Filters to the chosen place; on the map, the camera flies there.
    func choosePlace(_ place: LibraryPlace) {
        selectPlace(place)
        guard selectedTab == .map else { return }
        mapContext.request(.place(latitude: place.place.latitude, longitude: place.place.longitude, sheetFraction: 0))
    }

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

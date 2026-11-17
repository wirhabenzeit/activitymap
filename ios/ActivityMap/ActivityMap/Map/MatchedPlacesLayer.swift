import MapLibre
import SwiftUI

struct MatchedPlacesLayer: View {
    let places: [DisplayMatchedPlace]
    let loader: ActivityPlacesLoader
    var overview = false
    var onSelect: ((DisplayMatchedPlace) -> Void)?
    let positions: MapPositionState
    let proxy: MapProxy
    var body: some View {
        ForEach(places) { entry in
            let coordinate = CLLocationCoordinate2D(latitude: entry.place.latitude, longitude: entry.place.longitude)
            GeographicOverlay(coordinate: coordinate, positions: positions, proxy: proxy) {
                Button {
                    if let onSelect { onSelect(entry) }
                    else { loader.focus = loader.focus?.placeID == entry.id ? nil
                        : PlaceFocus(activityID: entry.activityIDs[0], placeID: entry.id) }
                } label: {
                    MatchedPlaceSymbol(place: entry.place, active: loader.focus?.placeID == entry.id, mapMarker: true)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(entry.place.name), \(entry.place.kindLabel), \(entry.activityIDs.count) \(overview ? "activities" : "selected routes")")
                .accessibilityAddTraits(loader.focus?.placeID == entry.id ? .isSelected : [])
                .accessibilityIdentifier("matched-place-\(entry.id)")
            }
            if loader.focus?.placeID == entry.id {
                // The card has its own bottom anchor. Its changing size must
                // never change the marker's fixed 44pt centered annotation.
                GeographicOverlay(coordinate: coordinate, positions: positions, proxy: proxy, anchor: .bottom) {
                    MatchedPlaceCard(place: entry.place, routeCount: entry.activityIDs.count, overview: overview) { loader.focus = nil }
                        .padding(.bottom, 16)
                }

            }
        }
    }
}

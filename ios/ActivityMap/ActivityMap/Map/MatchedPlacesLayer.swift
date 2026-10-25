import MapboxMaps
import SwiftUI

struct MatchedPlacesLayer: MapContent {
    let places: [DisplayMatchedPlace]
    let loader: ActivityPlacesLoader
    private var attributionSource: GeoJSONSource {
        var source = GeoJSONSource(id: "matched-places-attribution")
        source.data = .featureCollection(.init(features: []))
        source.attribution = "<a href=\"https://www.openstreetmap.org/copyright\">© OpenStreetMap contributors</a>"
        return source
    }
    var body: some MapContent {
        attributionSource
        ForEvery(places) { entry in
            let coordinate = CLLocationCoordinate2D(latitude: entry.place.latitude, longitude: entry.place.longitude)
            MapViewAnnotation(coordinate: coordinate) {
                Button {
                    loader.focus = loader.focus?.placeID == entry.id ? nil
                        : PlaceFocus(activityID: entry.activityIDs[0], placeID: entry.id)
                } label: {
                    MatchedPlaceSymbol(place: entry.place, active: loader.focus?.placeID == entry.id)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(entry.place.name), \(entry.place.kindLabel), \(entry.activityIDs.count) selected routes")
                .accessibilityAddTraits(loader.focus?.placeID == entry.id ? .isSelected : [])
                .accessibilityIdentifier("matched-place-\(entry.id)")
            }
            .variableAnchors([ViewAnnotationAnchorConfig(anchor: .center)])
            .allowOverlap(true)
            // Camera padding can cover the whole short landscape viewport.
            // Keep geographic annotations visible in the actual map bounds.
            .ignoreCameraPadding(true)
            .priority(loader.focus?.placeID == entry.id ? 1 : 0)

            if loader.focus?.placeID == entry.id {
                // The card has its own bottom anchor. Its changing size must
                // never change the marker's fixed 44pt centered annotation.
                MapViewAnnotation(coordinate: coordinate) {
                    MatchedPlaceCard(place: entry.place, routeCount: entry.activityIDs.count) { loader.focus = nil }
                        .padding(.bottom, 16)
                }
                .variableAnchors([ViewAnnotationAnchorConfig(anchor: .bottom)])
                .allowOverlap(true)
                .ignoreCameraPadding(true)
                .priority(2)
            }
        }
    }
}

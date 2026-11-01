import MapboxMaps
import SwiftUI

struct MatchedPlacesLayer: MapContent {
    let places: [DisplayMatchedPlace]
    let loader: ActivityPlacesLoader
    var overview = false
    var onSelect: ((DisplayMatchedPlace) -> Void)?
    private var attributionSource: GeoJSONSource {
        var source = GeoJSONSource(id: "matched-places-attribution")
        source.data = .featureCollection(.init(features: []))
        // Places come from OSM; Copernicus terrain decides which are listed.
        source.attribution = "<a href=\"https://www.openstreetmap.org/copyright\">© OpenStreetMap contributors</a>, <a href=\"https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model\">© DLR e.V. and Airbus, Copernicus programme</a>"
        return source
    }
    var body: some MapContent {
        attributionSource
        if overview {
            GeoJSONSource(id: "matched-places-labels").data(.featureCollection(.init(features: places.map { entry in
                var feature = Feature(geometry: .point(Point(CLLocationCoordinate2D(latitude: entry.place.latitude, longitude: entry.place.longitude))))
                feature.properties = ["name": .string(entry.place.name)]
                return feature
            })))
            SymbolLayer(id: "matched-places-labels-layer", source: "matched-places-labels")
                .minZoom(Double(MapPlaceLayout.labelZoom)).textField(Exp(.get) { "name" })
                .textSize(12).textAnchor(.top).textOffset(x: 0, y: 1.4)
                .textColor(UIColor.black).textHaloColor(UIColor.white).textHaloWidth(1.5)
        }
        ForEvery(places) { entry in
            let coordinate = CLLocationCoordinate2D(latitude: entry.place.latitude, longitude: entry.place.longitude)
            MapViewAnnotation(coordinate: coordinate) {
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
                    MatchedPlaceCard(place: entry.place, routeCount: entry.activityIDs.count, overview: overview) { loader.focus = nil }
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

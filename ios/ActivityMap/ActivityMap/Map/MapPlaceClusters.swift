import MapboxMaps
import SwiftUI

struct MapPlaceClusters: MapContent {
    let groups: [MapPlaceLayout.Group]
    let places: [String: DisplayMatchedPlace]
    let focusedID: String?
    let openGroupID: String?
    let openGroup: (MapPlaceLayout.Group) -> Void
    let select: (DisplayMatchedPlace) -> Void
    let close: () -> Void

    static func offset(_ group: MapPlaceLayout.Group, groups: [MapPlaceLayout.Group], focusedID: String?) -> CGPoint {
        guard let focused = groups.first(where: { $0.id == focusedID }),
              hypot(group.x - focused.x, group.y - focused.y) < MapPlaceLayout.pinSpacing else { return .zero }
        return CGPoint(x: 40, y: 24)
    }

    var body: some MapContent {
        ForEvery(groups.filter { $0.pointIDs.count > 1 }) { group in
            if let anchor = places[group.id] {
                let coordinate = CLLocationCoordinate2D(latitude: anchor.place.latitude, longitude: anchor.place.longitude)
                let offset = Self.offset(group, groups: groups, focusedID: focusedID)
                let kind = DisplayMatchedPlace.clusterKind(group.pointIDs.compactMap { places[$0] })
                MapViewAnnotation(coordinate: coordinate) {
                    Button { openGroup(group) } label: {
                        MapMarkerPin(count: group.pointIDs.count) {
                            if let kind {
                                PlaceGlyph(kind: kind).fill(.white).frame(width: 22, height: 22)
                            } else {
                                Image(systemName: "mappin.and.ellipse").font(.system(size: 14, weight: .semibold))
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Explore \(group.pointIDs.count) visited places")
                    .accessibilityIdentifier("place-cluster-\(group.id)")
                }
                .variableAnchors([ViewAnnotationAnchorConfig(anchor: .center, offsetX: offset.x, offsetY: -offset.y)])
                .allowOverlap(true).ignoreCameraPadding(true)

                if openGroupID == group.id {
                    MapViewAnnotation(coordinate: coordinate) {
                        VStack(spacing: 0) {
                            HStack {
                                Text("\(group.pointIDs.count) visited places").font(.caption.weight(.semibold))
                                Spacer()
                                Button(action: close) {
                                    Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(Rectangle())
                                }.accessibilityLabel("Close places")
                            }.padding(.leading, 12)
                            ScrollView {
                                VStack(spacing: 0) {
                                    ForEach(group.pointIDs, id: \.self) { id in
                                        if let entry = places[id] {
                                            Button { select(entry) } label: {
                                                HStack {
                                                    MatchedPlaceSymbol(place: entry.place)
                                                    Text(entry.place.name).font(.caption).multilineTextAlignment(.leading)
                                                    Spacer(minLength: 0)
                                                }.padding(.horizontal, 12).frame(minHeight: 44)
                                            }.accessibilityIdentifier("choose-place-\(id)")
                                        }
                                    }
                                }
                            }.frame(maxHeight: 220)
                        }
                        .buttonStyle(.plain).frame(width: 240)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12)).padding(.bottom, 20)
                    }
                    .variableAnchors([ViewAnnotationAnchorConfig(anchor: .bottom), ViewAnnotationAnchorConfig(anchor: .top)])
                    .allowOverlap(true).ignoreCameraPadding(true).priority(3)
                }
            }
        }
    }
}

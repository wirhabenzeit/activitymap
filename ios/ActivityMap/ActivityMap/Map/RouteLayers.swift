import MapboxMaps
import SwiftUI

struct RouteLayers: MapStyleContent {
    let data: GeoJSONSourceData
    let visibleIDs: Set<Int>
    let selectedIDs: Set<Int>
    let activeID: Int?

    var body: some MapStyleContent {
        let visibleFilter = RouteSource.filter(ids: visibleIDs.sorted())
        let selectedFilter = RouteSource.filter(ids: selectedIDs.intersection(visibleIDs).sorted())
        let activeFilter = RouteSource.filter(ids: activeID.map { [$0] } ?? [])

        GeoJSONSource(id: RouteSource.id)
            .data(data)

        LineLayer(id: RouteSource.ordinaryLayerID, source: RouteSource.id)
            .filter(visibleFilter)
            .lineColor(RouteSource.lineColor)
            .lineWidth(3)
            .lineJoin(.round)
            .lineCap(.round)

        // Width and contrasting casings preserve category colors while adding
        // non-color selected/active feedback, including on busy raster maps.
        LineLayer(id: "routeSelectedCasing", source: RouteSource.id)
            .filter(selectedFilter)
            .lineColor(.white)
            .lineWidth(8)
            .lineJoin(.round)
            .lineCap(.round)
        LineLayer(id: "routeSelected", source: RouteSource.id)
            .filter(selectedFilter)
            .lineColor(RouteSource.lineColor)
            .lineWidth(5)
            .lineJoin(.round)
            .lineCap(.round)
        LineLayer(id: "routeActiveCasing", source: RouteSource.id)
            .filter(activeFilter)
            .lineColor(.black)
            .lineWidth(12)
            .lineJoin(.round)
            .lineCap(.round)
        LineLayer(id: "routeActiveHalo", source: RouteSource.id)
            .filter(activeFilter)
            .lineColor(.white)
            .lineWidth(9)
            .lineJoin(.round)
            .lineCap(.round)
        LineLayer(id: "routeActive", source: RouteSource.id)
            .filter(activeFilter)
            .lineColor(RouteSource.lineColor)
            .lineWidth(6)
            .lineJoin(.round)
            .lineCap(.round)
    }
}

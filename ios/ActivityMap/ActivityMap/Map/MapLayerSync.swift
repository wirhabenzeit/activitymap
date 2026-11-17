import MapLibre
import UIKit

/// Idempotent across data changes; a fresh style reinstalls all app-owned layers.
enum MapLayerSync {
    static func sync(style: MLNStyle, base: BaseStyle, overlays: Set<SharedRasterOverlayDefinition>,
                     routes: RouteLayers, places: [DisplayMatchedPlace], showPlaceLabels: Bool, pitched: Bool = false) {
        for layer in style.layers where layer is MLNFillExtrusionStyleLayer { layer.isVisible = pitched }
        func raster(id: String, url: String, tileSize: Double, attribution: String?, opacity: Double) {
            guard style.source(withIdentifier: id) == nil else { return }
            var options: [MLNTileSourceOption: Any] = [.tileSize: tileSize]
            if let attribution { options[.attributionHTMLString] = attribution }
            let source = MLNRasterTileSource(identifier: id, tileURLTemplates: [url], options: options)
            style.addSource(source)
            let layer = MLNRasterStyleLayer(identifier: id + "-layer", source: source)
            layer.rasterOpacity = NSExpression(forConstantValue: opacity)
            if let route = style.layer(withIdentifier: RouteSource.ordinaryLayerID) { style.insertLayer(layer, below: route) }
            else { style.addLayer(layer) }
        }
        func remove(_ id: String) {
            if let layer = style.layer(withIdentifier: id + "-layer") { style.removeLayer(layer) }
            if let source = style.source(withIdentifier: id) { style.removeSource(source) }
        }
        // Raster bases share the fallback style, so switching between two of
        // them must replace the source even though no style load occurs.
        let baseID = "selected-raster-base-" + base.id
        for source in style.sources where source.identifier.hasPrefix("selected-raster-base-") && source.identifier != baseID {
            remove(source.identifier)
        }
        if let config = base.rasterSource {
            raster(id: baseID, url: config.url, tileSize: config.tileSize, attribution: base.attribution, opacity: 1)
        }
        for overlay in SharedMapCatalog.rasterOverlays {
            let id = overlay.id + "-source"
            if overlays.contains(overlay) {
                raster(id: id, url: overlay.url, tileSize: overlay.tileSize, attribution: overlay.attribution, opacity: overlay.opacity)
            } else { remove(id) }
        }
        routes.sync(style: style)
        let rasterIDs = (base.rasterSource == nil ? [] : [baseID + "-layer"])
            + SharedMapCatalog.rasterOverlays.filter(overlays.contains).map { $0.id + "-source-layer" }
        if style.layers.map(\.identifier).filter(rasterIDs.contains) != rasterIDs,
           let route = style.layer(withIdentifier: RouteSource.ordinaryLayerID) {
            for id in rasterIDs {
                guard let layer = style.layer(withIdentifier: id) else { continue }
                style.removeLayer(layer)
                style.insertLayer(layer, below: route)
            }
        }
        if !places.isEmpty, style.source(withIdentifier: "matched-places-attribution") == nil {
            style.addSource(MLNVectorTileSource(identifier: "matched-places-attribution", tileURLTemplates: [], options: [
                .attributionHTMLString: "<a href=\"https://www.openstreetmap.org/copyright\">© OpenStreetMap contributors</a>, <a href=\"https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model\">© DLR e.V. and Airbus, Copernicus programme</a>"
            ]))
        } else if places.isEmpty, let source = style.source(withIdentifier: "matched-places-attribution") {
            style.removeSource(source)
        }
        let id = "matched-places-labels"
        let features = places.map { entry in
            let feature = MLNPointFeature()
            feature.coordinate = .init(latitude: entry.place.latitude, longitude: entry.place.longitude)
            feature.attributes = ["name": entry.place.name]
            return feature
        }
        let shape = MLNShapeCollectionFeature(shapes: features)
        let source: MLNShapeSource
        if let existing = style.source(withIdentifier: id) as? MLNShapeSource {
            source = existing
            source.shape = shape
        } else {
            source = MLNShapeSource(identifier: id, shape: MLNShapeCollectionFeature(shapes: features), options: nil)
            style.addSource(source)
        }
        let layer = style.layer(withIdentifier: id + "-layer") as? MLNSymbolStyleLayer ?? MLNSymbolStyleLayer(identifier: id + "-layer", source: source)
        layer.isVisible = showPlaceLabels
        layer.minimumZoomLevel = Float(MapPlaceLayout.labelZoom)
        layer.text = NSExpression(forKeyPath: "name")
        layer.textFontNames = NSExpression(forConstantValue: ["Noto Sans Regular"])
        layer.textFontSize = NSExpression(forConstantValue: 12)
        layer.textAnchor = NSExpression(forConstantValue: "top")
        layer.textOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0, dy: 1.4)))
        layer.textColor = NSExpression(forConstantValue: UIColor.black)
        layer.textHaloColor = NSExpression(forConstantValue: UIColor.white)
        layer.textHaloWidth = NSExpression(forConstantValue: 1.5)
        if style.layer(withIdentifier: layer.identifier) == nil { style.addLayer(layer) }
    }
}

import MapboxMaps
import Observation
import SwiftUI

struct MapCamera {
    var center: CLLocationCoordinate2D
    var zoom: CGFloat
    var bearing: Double
    var pitch: CGFloat

    static let initial = MapCamera(center: CLLocationCoordinate2D(latitude: 46.95, longitude: 9.1),
                                   zoom: 6.5, bearing: 0, pitch: 0)
    var viewport: Viewport { .camera(center: center, zoom: zoom, bearing: bearing, pitch: pitch) }
}

/// Survives MapScreen recreation. Actual camera updates are not observable:
/// dragging must not invalidate the SwiftUI hierarchy on every rendering frame.
@Observable
final class MapContext {
    @ObservationIgnored private(set) var camera = MapCamera.initial
    var baseStyle = BaseStyle.standard
    var activeOverlays = Set(SharedMapCatalog.rasterOverlays.filter(\.visibleByDefault))
    private(set) var isPitched = false
    private(set) var scopeRevision = 0
    private(set) var pendingRequest: Request?
    var hiddenTargetID: Int?
    var navigationError: String?

    struct Request: Equatable {
        let id = UUID()
        let action: Action
    }
    enum Action: Equatable {
        case activity(Int), fitSelection, fitFiltered, resetBearing, resetView, pitch(CGFloat)
    }

    func record(_ state: CameraState) {
        camera = MapCamera(center: state.center, zoom: state.zoom, bearing: state.bearing, pitch: state.pitch)
        let pitched = state.pitch > 1
        if isPitched != pitched { isPitched = pitched }
    }

    func request(_ action: Action) {
        navigationError = nil
        pendingRequest = Request(action: action)
    }

    func consume(_ request: Request) {
        guard pendingRequest?.id == request.id else { return }
        pendingRequest = nil
    }

    func clearScope() {
        camera = .initial
        isPitched = false
        pendingRequest = nil
        hiddenTargetID = nil
        navigationError = nil
        scopeRevision += 1
        // Basemap and overlay preferences are device presentation settings.
    }
}

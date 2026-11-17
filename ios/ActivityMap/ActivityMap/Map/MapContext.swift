import CoreLocation
import Observation
import SwiftUI

struct MapCamera {
    var center: CLLocationCoordinate2D
    var zoom: CGFloat
    var bearing: Double = 0
    var pitch: CGFloat = 0
    var padding: UIEdgeInsets = .zero

    init(center: CLLocationCoordinate2D, zoom: CGFloat, bearing: Double = 0, pitch: CGFloat = 0, padding: UIEdgeInsets = .zero) {
        self.center = center; self.zoom = zoom; self.bearing = bearing; self.pitch = pitch; self.padding = padding
    }
    init(center: CLLocationCoordinate2D, padding: UIEdgeInsets, zoom: CGFloat, bearing: Double = 0, pitch: CGFloat = 0) {
        self.init(center: center, zoom: zoom, bearing: bearing, pitch: pitch, padding: padding)
    }
    static let initial = MapCamera(center: CLLocationCoordinate2D(latitude: 46.95, longitude: 9.1),
                                   zoom: 6.5, bearing: 0, pitch: 0)

}

/// Survives MapScreen recreation. Actual camera updates are not observable:
/// dragging must not invalidate the SwiftUI hierarchy on every rendering frame.
@Observable
final class MapContext {
    @ObservationIgnored private(set) var camera = MapCamera.initial
    @ObservationIgnored private let defaults: UserDefaults?
    @ObservationIgnored var saveCamera: (() -> Void)?
    var showPhotos = false { didSet { saveAppearance() } }
    var showPlaces = false { didSet { saveAppearance() } }
    var baseStyle = BaseStyle.street { didSet { saveAppearance() } }
    var activeOverlays = Set(SharedMapCatalog.rasterOverlays.filter(\.visibleByDefault)) { didSet { saveAppearance() } }

    private struct Appearance: Codable {
        var baseStyle: String
        var overlays: [String]
        var photos: Bool
        var places: Bool
    }
    private let appearanceKey = "browsing.v1.mapAppearance"
    init(defaults: UserDefaults? = nil) {
        self.defaults = defaults
        if let data = defaults?.data(forKey: appearanceKey),
           let saved = try? JSONDecoder().decode(Appearance.self, from: data) {
            baseStyle = BaseStyle.restored(id: saved.baseStyle)
            activeOverlays = Set(SharedMapCatalog.rasterOverlays.filter { saved.overlays.contains($0.id) })
            showPhotos = saved.photos
            showPlaces = saved.places
        }
    }
    private func saveAppearance() {
        guard let defaults, let data = try? JSONEncoder().encode(Appearance(baseStyle: baseStyle.id,
            overlays: activeOverlays.map(\.id).sorted(), photos: showPhotos, places: showPlaces)) else { return }
        defaults.set(data, forKey: appearanceKey)
    }
    func restoreCamera(_ saved: MapCamera?) {
        camera = saved ?? .initial
        isPitched = camera.pitch > 1
        scopeRevision += 1
    }
    private(set) var isPitched = false
    private(set) var scopeRevision = 0
    private(set) var pendingRequest: Request?
    private(set) var locatedPosition: CLLocationCoordinate2D?
    var hiddenTargetID: Int?
    /// A place picked in header search, pinned without filtering. A map tap clears it.
    var highlightedPlaceID: String?
    var navigationError: String?

    struct Request: Equatable {
        let id = UUID()
        let action: Action
    }
    enum Action: Equatable {
        case activity(Int), fitActivity(Int), fitSelection, fitFiltered, resetBearing, resetView, pitch(CGFloat)
        case locate(latitude: Double, longitude: Double)
        /// A place chosen in search, centred above the sheet covering this
        /// fraction of the map's height.
        case place(latitude: Double, longitude: Double, sheetFraction: CGFloat)
    }

    func record(_ state: MapCamera) {
        camera = MapCamera(center: state.center, zoom: state.zoom, bearing: state.bearing, pitch: state.pitch, padding: state.padding)
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

    func cancelLocationRequest() {
        if case .locate = pendingRequest?.action { pendingRequest = nil }
    }

    func recordLocatedPosition(_ coordinate: CLLocationCoordinate2D) {
        guard coordinate.latitude.isFinite, coordinate.longitude.isFinite,
              CLLocationCoordinate2DIsValid(coordinate) else { return }
        locatedPosition = coordinate
    }

    func clearScope() {
        camera = .initial
        locatedPosition = nil
        isPitched = false
        pendingRequest = nil
        hiddenTargetID = nil
        highlightedPlaceID = nil
        navigationError = nil
        scopeRevision += 1
        // Basemap and overlay preferences are device presentation settings.
    }
}

extension MapCamera: Equatable {
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.center.latitude == rhs.center.latitude && lhs.center.longitude == rhs.center.longitude
            && lhs.zoom == rhs.zoom && lhs.bearing == rhs.bearing && lhs.pitch == rhs.pitch && lhs.padding == rhs.padding
    }
}

import MapboxMaps
import Observation
import SwiftUI

struct MapCamera {
    var center: CLLocationCoordinate2D
    var zoom: CGFloat
    var bearing: Double
    var pitch: CGFloat
    var padding: UIEdgeInsets = .zero

    static let initial = MapCamera(center: CLLocationCoordinate2D(latitude: 46.95, longitude: 9.1),
                                   zoom: 6.5, bearing: 0, pitch: 0)
    var viewport: Viewport {
        .camera(center: center, zoom: zoom, bearing: bearing, pitch: pitch)
            .padding(EdgeInsets(top: padding.top, leading: padding.left, bottom: padding.bottom, trailing: padding.right))
    }
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
    var baseStyle = BaseStyle.standard { didSet { saveAppearance() } }
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
            baseStyle = BaseStyle.all.first { $0.id == saved.baseStyle } ?? .standard
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

    func record(_ state: CameraState) {
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

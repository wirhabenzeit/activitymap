import CoreLocation
import Foundation

struct Activity: Identifiable {
    let id: Int
    var name: String
    var description: String?
    var sportType: SportType
    var startDate: Date
    /// Activity-local wall time encoded with a UTC-shaped suffix, not an instant
    /// to convert through the device timezone or the activity's timezone again.
    var startDateLocal: Date
    var timezone: String

    var distance: Double? // meters; nil is unknown, not a measured zero
    var movingTime: Int? // seconds
    var elapsedTime: Int? // seconds
    var totalElevationGain: Double? // meters
    var elevHigh: Double?
    var elevLow: Double?
    var averageSpeed: Double? // meters/second

    var averageHeartrate: Double?
    var maxHeartrate: Double?
    var averageWatts: Double?
    var maxWatts: Double?
    var weightedAverageWatts: Double?

    var commute: Bool?
    var coordinates: [CLLocationCoordinate2D]

    var isPrivate: Bool? = nil
    var flagged: Bool? = nil
    var trainer: Bool? = nil
    var manual: Bool? = nil
    var maxSpeed: Double? = nil
    var calories: Double? = nil
    var kilojoules: Double? = nil
    var hasHeartrate: Bool? = nil
    var deviceWatts: Bool? = nil
    var kudosCount: Int? = nil
    var achievementCount: Int? = nil
    var commentCount: Int? = nil
    var photoCount: Int? = nil
    var totalPhotoCount: Int? = nil
    var geometryState: ActivityMapAPI.GeometryState = .summary
    var geometrySource: GeometrySource = .none
    var hasInvalidGeometry = false
    /// Validated server bounds, which may describe summary geometry. Camera
    /// fitting must use the actual chosen coordinates when these differ.
    var mapBounds: ActivityBounds? = nil
    var startCoordinate: CLLocationCoordinate2D? = nil
    var endCoordinate: CLLocationCoordinate2D? = nil
    var photosState: ActivityMapAPI.PhotosState? = nil
    var streams: ActivityMapAPI.StreamMetadata? = nil
    var lastUpdated: Date? = nil
    var lastSummarySeenAt: Date? = nil
    var lastDetailedFetchedAt: Date? = nil

    var category: ActivityCategory { sportType.category }
    var localDayKey: String { Formatters.dayKey(startDateLocal, timeZone: .gmt) }

    enum GeometrySource { case none, summary, detailed }
}

/// GeoJSON order: west, south, east, north. west > east denotes an
/// antimeridian crossing and must not be normalized into a world-wide box.
struct ActivityBounds: Equatable {
    let west: Double
    let south: Double
    let east: Double
    let north: Double

    init?(_ values: [Double]) {
        guard values.count == 4, values.allSatisfy(\.isFinite),
              (-180...180).contains(values[0]), (-180...180).contains(values[2]),
              (-90...90).contains(values[1]), (-90...90).contains(values[3]),
              values[1] <= values[3] else { return nil }
        west = values[0]; south = values[1]; east = values[2]; north = values[3]
    }
}

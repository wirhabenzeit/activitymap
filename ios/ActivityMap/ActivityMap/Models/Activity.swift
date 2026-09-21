import CoreLocation
import Foundation

struct Activity: Identifiable {
    let id: Int
    var name: String
    var description: String?
    var sportType: SportType
    var startDate: Date

    var distance: Double // meters
    var movingTime: Int // seconds
    var elapsedTime: Int // seconds
    var totalElevationGain: Double // meters
    var elevHigh: Double?
    var elevLow: Double?
    var averageSpeed: Double // meters/second

    var averageHeartrate: Double?
    var maxHeartrate: Double?
    var averageWatts: Double?
    var maxWatts: Double?
    var weightedAverageWatts: Double?

    var commute: Bool
    var coordinates: [CLLocationCoordinate2D]

    var category: ActivityCategory { sportType.category }
}

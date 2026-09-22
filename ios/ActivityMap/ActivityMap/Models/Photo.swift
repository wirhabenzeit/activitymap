import CoreLocation
import Foundation

/// Photo metadata only. Downloaded image files will have a separate cache.
struct Photo: Identifiable {
    let id: String
    let activityID: String
    let caption: String?
    let urls: [String: String]
    let location: CLLocationCoordinate2D?
    let createdAt: Date?
}

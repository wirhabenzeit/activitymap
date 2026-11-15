import Foundation
import CoreLocation

/// Versioned local preferences, separated from activity data and transient
/// selection/navigation. Tests and previews opt in with an isolated defaults suite.
@MainActor
final class BrowsingPreferences {
    private let defaults: UserDefaults
    private(set) var scope: StoreScope?
    private let prefix = "browsing.v1."

    struct Camera: Codable {
        let latitude: Double
        let longitude: Double
        let zoom: Double
        let bearing: Double
        let pitch: Double
        init(_ camera: MapCamera) {
            latitude = camera.center.latitude; longitude = camera.center.longitude
            zoom = Double(camera.zoom); bearing = camera.bearing; pitch = Double(camera.pitch)
        }
        var value: MapCamera? {
            guard latitude.isFinite, longitude.isFinite, zoom.isFinite, bearing.isFinite, pitch.isFinite,
                  (-90...90).contains(latitude), (-180...180).contains(longitude),
                  (0...22).contains(zoom), (0...85).contains(pitch) else { return nil }
            return MapCamera(center: .init(latitude: latitude, longitude: longitude),
                             zoom: CGFloat(zoom), bearing: bearing, pitch: CGFloat(pitch))
        }
    }

    init(defaults: UserDefaults) { self.defaults = defaults }

    func activate(_ scope: StoreScope?) { self.scope = scope }
    private func key(_ name: String, scope: StoreScope) -> String { prefix + StoreScope.key([scope.key, name]) }

    func filters() -> ActivityFilterState {
        guard let scope, let data = defaults.data(forKey: key("filters", scope: scope)),
              var filters = try? JSONDecoder().decode(ActivityFilterState.self, from: data) else { return ActivityFilterState() }
        if filters.place?.userID != scope.userID { filters.place = nil }
        if let range = filters.dateDayRange {
            filters.dateDayRange = ActivityDayRange(start: range.start, end: range.end)
        }
        func valid(_ filter: NumericFilter?) -> NumericFilter? {
            guard let filter, filter.value.isFinite, filter.value >= 0,
                  filter.upperLimit.map({ $0.isFinite && $0 >= filter.value }) ?? true else { return nil }
            return filter
        }
        filters.distanceFilter = valid(filters.distanceFilter)
        filters.elevationFilter = valid(filters.elevationFilter)
        filters.durationFilter = valid(filters.durationFilter)
        return filters
    }

    func save(filters: ActivityFilterState) {
        guard let scope, let data = try? JSONEncoder().encode(filters) else { return }
        defaults.set(data, forKey: key("filters", scope: scope))
    }
    func camera() -> MapCamera? {
        guard let scope, let data = defaults.data(forKey: key("camera", scope: scope)),
              let saved = try? JSONDecoder().decode(Camera.self, from: data) else { return nil }
        return saved.value
    }
    func save(camera: MapCamera) {
        guard let scope, let data = try? JSONEncoder().encode(Camera(camera)) else { return }
        defaults.set(data, forKey: key("camera", scope: scope))
    }
    func remove(scope: StoreScope) {
        defaults.removeObject(forKey: key("filters", scope: scope))
        defaults.removeObject(forKey: key("camera", scope: scope))
    }
}

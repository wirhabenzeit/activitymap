import MapboxMaps
import Observation

/// Owned by the activity store so switching tabs also reuses this snapshot.
/// Selection, camera and filter updates never construct library GeoJSON.
@Observable
final class RouteGeometryCache {
    private(set) var revision: Int?
    private(set) var buildCount = 0
    private(set) var data: GeoJSONSourceData = .featureCollection(FeatureCollection(features: []))

    func update(activities: [Activity], revision: Int) {
        guard self.revision != revision else { return }
        data = RouteSource.data(for: activities)
        self.revision = revision
        buildCount += 1
    }
}

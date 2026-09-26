import CoreLocation

/// Maps detached DTOs without changing their missing-value semantics.
/// Geometry failure is local to the route, never the readable activity.
enum StoredModelMapper {
    enum MappingError: Error { case invalidActivityID(String), unsupportedSport(String) }

    static func activity(_ dto: ActivityMapAPI.Activity) throws -> Activity {
        guard let id = Int(dto.id) else { throw MappingError.invalidActivityID(dto.id) }
        guard let sport = SportType(rawValue: dto.sportType.rawValue) else {
            throw MappingError.unsupportedSport(dto.sportType.rawValue)
        }
        var coordinates: [CLLocationCoordinate2D] = []
        var geometrySource = Activity.GeometrySource.none
        var hasInvalidGeometry = false
        if dto.geometryState == .detailed, let detailed = dto.mapPolyline, !detailed.isEmpty {
            do {
                coordinates = try Polyline.decode(detailed)
                geometrySource = .detailed
            } catch { hasInvalidGeometry = true }
        }
        if coordinates.isEmpty, let summary = dto.mapSummaryPolyline, !summary.isEmpty {
            do {
                coordinates = try Polyline.decode(summary)
                geometrySource = .summary
            } catch { hasInvalidGeometry = true }
        }
        var activity = Activity(
            id: id, name: dto.name, description: dto.description, sportType: sport,
            startDate: dto.startDate, startDateLocal: dto.startDateLocal, timezone: dto.timezone,
            distance: dto.distance, movingTime: dto.movingTime, elapsedTime: dto.elapsedTime,
            totalElevationGain: dto.totalElevationGain,
            elevHigh: dto.elevHigh, elevLow: dto.elevLow, averageSpeed: dto.averageSpeed,
            averageHeartrate: dto.averageHeartrate, maxHeartrate: dto.maxHeartrate,
            averageWatts: dto.averageWatts, maxWatts: dto.maxWatts.map(Double.init),
            weightedAverageWatts: dto.weightedAverageWatts.map(Double.init),
            commute: dto.commute, coordinates: coordinates)
        activity.isPrivate = dto.private
        activity.flagged = dto.flagged
        activity.trainer = dto.trainer
        activity.manual = dto.manual
        activity.maxSpeed = dto.maxSpeed
        activity.calories = dto.calories
        activity.kilojoules = dto.kilojoules
        activity.hasHeartrate = dto.hasHeartrate
        activity.deviceWatts = dto.deviceWatts
        activity.kudosCount = dto.kudosCount
        activity.achievementCount = dto.achievementCount
        activity.commentCount = dto.commentCount
        activity.photoCount = dto.photoCount
        activity.totalPhotoCount = dto.totalPhotoCount
        activity.geometryState = dto.geometryState
        activity.geometrySource = geometrySource
        activity.hasInvalidGeometry = hasInvalidGeometry
        // The server can use [0, 0, 0, 0] when there is no GPS. Bounds alone
        // must not invent geometry or make an unrenderable route navigable.
        activity.mapBounds = coordinates.isEmpty ? nil : dto.mapBbox.flatMap(ActivityBounds.init)
        activity.startCoordinate = coordinate(dto.startLatlng)
        activity.endCoordinate = coordinate(dto.endLatlng)
        activity.photosState = dto.photosState
        activity.streams = dto.streams
        activity.lastUpdated = dto.lastUpdated
        activity.lastSummarySeenAt = dto.lastSummarySeenAt
        activity.lastDetailedFetchedAt = dto.lastDetailedFetchedAt
        return activity
    }

    private static func coordinate(_ values: [Double]?) -> CLLocationCoordinate2D? {
        guard let values, values.count == 2 else { return nil }
        let result = CLLocationCoordinate2D(latitude: values[0], longitude: values[1])
        return CLLocationCoordinate2DIsValid(result) ? result : nil
    }

    static func photo(_ dto: ActivityMapAPI.Photo) -> Photo {
        let location = coordinate(dto.location)
        return Photo(
            id: dto.uniqueID, activityID: dto.activityID, caption: dto.caption,
            urls: dto.urls ?? [:], location: location, createdAt: dto.createdAt)
    }
}

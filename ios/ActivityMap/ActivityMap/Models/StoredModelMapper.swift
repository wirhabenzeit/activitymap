import CoreLocation

/// Maps detached DTO values read from LocalStore to the existing UI models.
/// Missing numeric metrics use the mockup's zero convention; the stored DTO
/// retains nulls and every field for later UI changes.
enum StoredModelMapper {
    enum MappingError: Error { case invalidActivityID(String), unsupportedSport(String) }

    static func activity(_ dto: ActivityMapAPI.Activity) throws -> Activity {
        guard let id = Int(dto.id) else { throw MappingError.invalidActivityID(dto.id) }
        guard let sport = SportType(rawValue: dto.sportType.rawValue) else {
            throw MappingError.unsupportedSport(dto.sportType.rawValue)
        }
        let encoded: String?
        if dto.geometryState == .detailed, let detailed = dto.mapPolyline, !detailed.isEmpty {
            encoded = detailed
        } else {
            encoded = dto.mapSummaryPolyline
        }
        return Activity(
            id: id, name: dto.name, description: dto.description, sportType: sport,
            startDate: dto.startDate, distance: dto.distance ?? 0,
            movingTime: dto.movingTime ?? 0, elapsedTime: dto.elapsedTime ?? 0,
            totalElevationGain: dto.totalElevationGain ?? 0,
            elevHigh: dto.elevHigh, elevLow: dto.elevLow, averageSpeed: dto.averageSpeed ?? 0,
            averageHeartrate: dto.averageHeartrate, maxHeartrate: dto.maxHeartrate,
            averageWatts: dto.averageWatts, maxWatts: dto.maxWatts.map(Double.init),
            weightedAverageWatts: dto.weightedAverageWatts.map(Double.init),
            commute: dto.commute ?? false,
            coordinates: try encoded.map(Polyline.decode) ?? [])
    }

    static func photo(_ dto: ActivityMapAPI.Photo) -> Photo {
        let location = dto.location.flatMap { values -> CLLocationCoordinate2D? in
            guard values.count == 2 else { return nil }
            let coordinate = CLLocationCoordinate2D(latitude: values[0], longitude: values[1])
            return CLLocationCoordinate2DIsValid(coordinate) ? coordinate : nil
        }
        return Photo(
            id: dto.uniqueID, activityID: dto.activityID, caption: dto.caption,
            urls: dto.urls ?? [:], location: location, createdAt: dto.createdAt)
    }
}

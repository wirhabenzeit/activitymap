import Foundation

nonisolated struct PlaceFilter: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let userID: String
}

nonisolated struct LibraryPlace: Identifiable, Equatable, Sendable {
    var place: ActivityMapAPI.MatchedPlace
    var activityIDs: Set<Int>
    var firstVisit: Date
    var latestVisit: Date
    var id: String { place.id }
    var activityCount: Int { activityIDs.count }
    var kindLabel: String {
        place.kinds.sorted { $0.rawValue < $1.rawValue }.map {
            $0 == .peak ? "Peak" : $0 == .pass ? "Pass" : "Hut"
        }.joined(separator: " · ")
    }
}

nonisolated struct PlaceEvidence: Sendable {
    let activityID: Int
    let start: Date
    let status: String
    let places: [ActivityMapAPI.MatchedPlace]
}

/// Local read model of current synchronized bundles. No catalogue download or
/// per-activity reads. Override composition for #463 belongs at effectivePlaces.
nonisolated struct PlaceLibrary: Sendable {
    let userID: String?
    let places: [LibraryPlace]
    let byID: [String: LibraryPlace]
    let statusCounts: [String: Int]
    let complete: Bool

    static func currentResult(_ activity: ActivityMapAPI.Activity, userID: String, version: String?) -> ActivityMapAPI.ActivityPlaces? {
        guard let result = activity.placeMatches, let version,
              result.userID == userID, result.activityID == activity.id,
              result.matchingVersion == version else { return nil }
        if let metadata = activity.streams {
            guard result.streamGeneration == metadata.generation, result.streamRevision == metadata.revision,
                  result.status != .complete || metadata.state == .current else { return nil }
        }
        return result
    }

    @MainActor static func effectivePlaces(_ activity: Activity) -> [ActivityMapAPI.MatchedPlace] {
        activity.placeMatches?.status == .complete ? activity.placeMatches!.places : []
    }

    /// One activity's validated result status and effective places. Stats
    /// rankings carry this off the main actor into the same aggregation.
    @MainActor static func evidence(_ activity: Activity, userID: String?) -> PlaceEvidence {
        let result = activity.placeMatches
        let valid = userID != nil && result?.userID == userID && result?.activityID == String(activity.id)
        return PlaceEvidence(activityID: activity.id, start: activity.startDateLocal,
                             status: valid ? result!.status.rawValue : "unknown",
                             places: valid ? effectivePlaces(activity) : [])
    }

    @MainActor init(activities: [Activity], userID: String?, libraryComplete: Bool = true) {
        self.init(evidence: activities.map { Self.evidence($0, userID: userID) }, userID: userID, libraryComplete: libraryComplete)
    }

    init(evidence: [PlaceEvidence], userID: String?, libraryComplete: Bool = true) {
        self.userID = userID
        var byID: [String: LibraryPlace] = [:]
        var statuses: [String: Int] = [:]
        for activity in evidence {
            statuses[activity.status, default: 0] += 1
            for place in activity.places {
                if var existing = byID[place.id] {
                    existing.activityIDs.insert(activity.activityID)
                    let kinds = Array(Set(existing.place.kinds + place.kinds)).sorted { $0.rawValue < $1.rawValue }
                    existing.place = ActivityMapAPI.MatchedPlace(id: existing.id, name: existing.place.name, kinds: kinds, longitude: existing.place.longitude, latitude: existing.place.latitude, elevationM: existing.place.elevationM, visits: existing.place.visits)
                    existing.firstVisit = min(existing.firstVisit, activity.start)
                    existing.latestVisit = max(existing.latestVisit, activity.start)
                    byID[place.id] = existing
                } else {
                    byID[place.id] = LibraryPlace(place: place, activityIDs: [activity.activityID], firstVisit: activity.start, latestVisit: activity.start)
                }
            }
        }
        self.byID = byID
        places = byID.values.sorted {
            if $0.activityCount != $1.activityCount { return $0.activityCount > $1.activityCount }
            if $0.place.name != $1.place.name { return $0.place.name < $1.place.name }
            return $0.id < $1.id
        }
        statusCounts = statuses
        complete = libraryComplete && statuses.keys.allSatisfy { $0 == "complete" }
    }

    static func normalizedSearch(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func search(_ query: String, offset: Int = 0, limit: Int = 8) -> (places: [LibraryPlace], total: Int) {
        let text = Self.normalizedSearch(query)
        let matches = places.filter { Self.normalizedSearch($0.place.name).contains(text) || text.isEmpty }
        return (Array(matches.dropFirst(max(0, offset)).prefix(max(0, min(100, limit)))), matches.count)
    }
}

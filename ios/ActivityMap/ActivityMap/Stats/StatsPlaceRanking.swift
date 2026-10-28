import Foundation

/// Most visited places (#461): distinct activities per place in a Stats
/// window, aggregated by PlaceLibrary from the activities' synced evidence.
nonisolated struct StatsPlaceRanking: Equatable, Sendable {
    struct Row: Identifiable, Equatable, Sendable {
        let place: LibraryPlace
        /// Competition rank: equal counts share a rank (1, 2, 2, 2, 5).
        let rank: Int
        var id: String { place.id }
    }
    static let limit = 50
    static let compactLimit = 5

    let rows: [Row]
    /// Distinct places of the kind, before the display limit.
    let total: Int
    /// Activities in the window, and those with a completed place check.
    let activities: Int
    let checked: Int

    /// Only a fully checked window of a fully loaded history may present its
    /// ranking, or an empty one, as the complete answer.
    func exhaustive(historyComplete: Bool) -> Bool { historyComplete && checked == activities }
}

nonisolated extension StatsEngine {
    func placeRanking(today: Int, kind: ActivityMapAPI.PlaceKind, range: StatsWindow,
                      limit: Int = StatsPlaceRanking.limit) -> StatsPlaceRanking {
        let first = range == .allTime ? Int.min : StatsDates.start(year: StatsDates.parts(today).year!)
        let scoped = activities.filter { $0.day >= first && $0.day <= today }
        let library = PlaceLibrary(evidence: scoped.map {
            $0.places ?? PlaceEvidence(activityID: $0.id ?? 0, start: $0.start, status: "unknown", places: [])
        }, userID: nil)
        let places = library.places.filter { $0.place.kinds.contains(kind) }.sorted {
            if $0.activityCount != $1.activityCount { return $0.activityCount > $1.activityCount }
            if $0.latestVisit != $1.latestVisit { return $0.latestVisit > $1.latestVisit }
            if $0.place.name != $1.place.name { return $0.place.name < $1.place.name }
            return $0.id < $1.id
        }
        var rank = 0
        let rows = places.prefix(max(0, limit)).enumerated().map { index, place in
            if index == 0 || places[index - 1].activityCount != place.activityCount { rank = index + 1 }
            return StatsPlaceRanking.Row(place: place, rank: rank)
        }
        return .init(rows: rows, total: places.count, activities: scoped.count,
                     checked: library.statusCounts["complete"] ?? 0)
    }
}

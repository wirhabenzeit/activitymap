import CoreLocation
import Foundation

enum SampleData {
    // A handful of hand-authored route shapes around eastern Switzerland,
    // reused with small offsets/scales to populate the map with variety.
    private static let routeShapes: [[CLLocationCoordinate2D]] = [
        // Zurich/Winterthur area loop
        [
            .init(latitude: 47.499, longitude: 8.724),
            .init(latitude: 47.512, longitude: 8.741),
            .init(latitude: 47.527, longitude: 8.760),
            .init(latitude: 47.541, longitude: 8.782),
            .init(latitude: 47.556, longitude: 8.805),
            .init(latitude: 47.549, longitude: 8.830),
            .init(latitude: 47.531, longitude: 8.812),
        ],
        // St. Gallen ridge line
        [
            .init(latitude: 47.423, longitude: 9.377),
            .init(latitude: 47.408, longitude: 9.401),
            .init(latitude: 47.389, longitude: 9.421),
            .init(latitude: 47.371, longitude: 9.447),
            .init(latitude: 47.352, longitude: 9.470),
            .init(latitude: 47.338, longitude: 9.492),
        ],
        // Chur / Graubunden network
        [
            .init(latitude: 46.851, longitude: 9.532),
            .init(latitude: 46.832, longitude: 9.558),
            .init(latitude: 46.809, longitude: 9.577),
            .init(latitude: 46.784, longitude: 9.601),
            .init(latitude: 46.762, longitude: 9.633),
            .init(latitude: 46.738, longitude: 9.658),
            .init(latitude: 46.719, longitude: 9.639),
            .init(latitude: 46.703, longitude: 9.605),
        ],
        // Liechtenstein loop
        [
            .init(latitude: 47.166, longitude: 9.508),
            .init(latitude: 47.152, longitude: 9.523),
            .init(latitude: 47.138, longitude: 9.540),
            .init(latitude: 47.121, longitude: 9.556),
            .init(latitude: 47.134, longitude: 9.573),
            .init(latitude: 47.153, longitude: 9.561),
        ],
        // Bellinzona / Ticino valley
        [
            .init(latitude: 46.194, longitude: 9.024),
            .init(latitude: 46.212, longitude: 9.041),
            .init(latitude: 46.231, longitude: 9.057),
            .init(latitude: 46.249, longitude: 9.079),
            .init(latitude: 46.264, longitude: 9.103),
            .init(latitude: 46.248, longitude: 9.121),
        ],
        // Walensee shoreline
        [
            .init(latitude: 47.117, longitude: 9.116),
            .init(latitude: 47.132, longitude: 9.145),
            .init(latitude: 47.148, longitude: 9.178),
            .init(latitude: 47.163, longitude: 9.211),
            .init(latitude: 47.150, longitude: 9.237),
        ],
    ]

    private static func offset(
        _ coordinates: [CLLocationCoordinate2D],
        latOffset: Double,
        lonOffset: Double
    ) -> [CLLocationCoordinate2D] {
        coordinates.map {
            CLLocationCoordinate2D(latitude: $0.latitude + latOffset, longitude: $0.longitude + lonOffset)
        }
    }

    private static let names: [SportType: [String]] = [
        .backcountrySki: ["Backcountry Powder Day", "Ski Tour to the Hut", "Sunrise Ski Ascent"],
        .nordicSki: ["Classic Track Loop", "Skate Ski Intervals"],
        .hike: ["Ridge Hike", "Alpine Hut Hike", "Sunday Family Hike"],
        .trailRun: ["Trail Run Loop", "Vertical K Attempt", "Forest Trail Run"],
        .run: ["Morning Run", "Easy Recovery Run", "Tempo Run", "Long Sunday Run"],
        .virtualRun: ["Treadmill Intervals"],
        .ride: ["Road Ride", "Valley Loop Ride", "Coffee Ride"],
        .gravelRide: ["Gravel Adventure", "Farm Roads Gravel Ride"],
        .mountainBikeRide: ["MTB Singletrack", "Enduro Descent"],
        .eBikeRide: ["E-Bike Exploration"],
        .swim: ["Lake Swim"],
        .weightTraining: ["Strength Session"],
        .yoga: ["Recovery Yoga"],
    ]

    static let activities: [Activity] = {
        var result: [Activity] = []
        var id = 1
        let calendar = Calendar.current
        let today = Date()

        let plan: [(SportType, Int)] = [
            (.backcountrySki, 4), (.nordicSki, 3),
            (.hike, 5), (.trailRun, 4),
            (.run, 8), (.virtualRun, 1),
            (.ride, 6), (.gravelRide, 3), (.mountainBikeRide, 3), (.eBikeRide, 2),
            (.swim, 2), (.weightTraining, 3), (.yoga, 2),
        ]

        for (sport, count) in plan {
            for i in 0..<count {
                let shape = routeShapes[id % routeShapes.count]
                let jitterLat = Double((id * 37) % 11 - 5) * 0.004
                let jitterLon = Double((id * 53) % 11 - 5) * 0.004
                let coords = offset(shape, latOffset: jitterLat, lonOffset: jitterLon)

                let daysAgo = (id * 7 + i * 3) % 420
                let date = calendar.date(byAdding: .day, value: -daysAgo, to: today) ?? today

                let baseDistance: Double
                switch sport.category {
                case .bcXcSki: baseDistance = 12_000
                case .trailHike: baseDistance = 14_000
                case .run: baseDistance = 9_000
                case .ride: baseDistance = 45_000
                case .misc: baseDistance = 3_000
                }
                let distance = baseDistance * Double.random(in: 0.6...1.6)
                let avgSpeed = sport.category == .ride ? 7.5 : (sport.category == .misc ? 1.2 : 2.8)
                let movingTime = Int(distance / avgSpeed)
                let elapsedTime = movingTime + Int.random(in: 0...900)
                let elevation = sport.category == .ride || sport.category == .trailHike || sport.category == .bcXcSki
                    ? Double.random(in: 150...1400)
                    : Double.random(in: 0...120)

                let hasHR = Bool.random()
                let hasWatts = sport.category == .ride && Bool.random()

                let title = names[sport]?.randomElement() ?? sport.rawValue

                result.append(
                    Activity(
                        id: id,
                        name: title,
                        description: id % 4 == 0 ? "Great conditions, felt strong the whole way." : nil,
                        sportType: sport,
                        startDate: date,
                        startDateLocal: date.addingTimeInterval(Double(TimeZone.current.secondsFromGMT(for: date))),
                        timezone: TimeZone.current.identifier,
                        distance: distance,
                        movingTime: movingTime,
                        elapsedTime: elapsedTime,
                        totalElevationGain: elevation,
                        elevHigh: Double.random(in: 400...2800),
                        elevLow: Double.random(in: 350...900),
                        averageSpeed: avgSpeed * Double.random(in: 0.85...1.15),
                        averageHeartrate: hasHR ? Double.random(in: 118...162) : nil,
                        maxHeartrate: hasHR ? Double.random(in: 165...190) : nil,
                        averageWatts: hasWatts ? Double.random(in: 140...230) : nil,
                        maxWatts: hasWatts ? Double.random(in: 400...900) : nil,
                        weightedAverageWatts: hasWatts ? Double.random(in: 150...240) : nil,
                        commute: sport == .ride && id % 6 == 0,
                        coordinates: coords
                    )
                )
                id += 1
            }
        }
        return result.sorted { $0.startDate > $1.startDate }
    }()
}

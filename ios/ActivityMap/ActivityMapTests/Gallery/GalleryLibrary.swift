import CoreLocation
import Foundation
@testable import ActivityMap

/// Activities shown in the screenshot gallery, decoded through the production
/// mapper. Prefers, in order: a full local export named by
/// `ACTIVITYMAP_GALLERY_LIBRARY`, the committed curated `gallery-activities.json`
/// (from `scripts/export-gallery-library.mjs`), then a deterministic synthetic set.
enum GalleryLibrary {
    struct Loaded {
        let source: String
        let activities: [Activity]
    }

    static func load() throws -> Loaded {
        let environment = ProcessInfo.processInfo.environment["ACTIVITYMAP_GALLERY_LIBRARY"]
            .flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
        let curated = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("gallery-activities.json")
        for (url, source) in [(environment, "local export"), (curated, "curated")] {
            guard let url, FileManager.default.fileExists(atPath: url.path) else { continue }
            return Loaded(source: source, activities: try decode(Data(contentsOf: url)))
        }
        return Loaded(source: "synthetic", activities: synthetic)
    }

    private struct Export: Decodable { let activities: [ActivityMapAPI.Activity] }

    private static func decode(_ data: Data) throws -> [Activity] {
        try ActivityMapAPI.makeDecoder().decode(Export.self, from: data).activities
            .map(StoredModelMapper.activity)
            .sorted { $0.startDate > $1.startDate }
    }

    /// Deterministic stand-in with overlapping loops around central Switzerland,
    /// GPS-less entries and recorded zeros. No randomness or wall-clock dates.
    static let synthetic: [Activity] = {
        let anchor = Date(timeIntervalSince1970: 1_790_000_000) // 2026-09-21
        let plan: [(SportType, String, Double, Int, Double, (Double, Double)?)] = [
            (.ride, "Lunch Ride", 24_900, 3_300, 506, (47.37, 8.54)),
            (.ride, "Evening Ride over the Pfannenstiel", 25_700, 3_400, 410, (47.31, 8.66)),
            (.ride, "Afternoon Ride", 72_800, 10_200, 1_422, (47.25, 8.75)),
            (.gravelRide, "Stöcklichrüz", 60_600, 9_800, 1_344, (47.20, 8.85)),
            (.mountainBikeRide, "Evening Mountain Bike Ride", 15_000, 3_600, 276, (47.40, 8.50)),
            (.virtualRide, "Zwift - Short Mix in Watopia", 10_400, 1_200, 120, nil),
            (.run, "Lunch Run", 7_000, 2_100, 26, (47.38, 8.53)),
            (.run, "Long Sunday Run along the lake", 18_400, 5_900, 140, (47.33, 8.57)),
            (.trailRun, "Uetliberg Trail Run", 14_600, 5_400, 479, (47.35, 8.49)),
            (.backcountrySki, "Gross Ruchen", 20_400, 21_000, 2_123, (46.86, 8.78)),
            (.backcountrySki, "Piz Sarsura, Piz Grialetsch & Sarclettahorn", 22_100, 25_000, 2_350, (46.70, 9.95)),
            (.nordicSki, "Evening Nordic Ski", 18_300, 4_200, 233, (47.10, 8.70)),
            (.hike, "Fluebrig", 13_700, 18_000, 1_214, (47.13, 8.90)),
            (.hike, "Afternoon Hike", 18_300, 21_600, 1_551, (47.28, 9.45)),
            (.walk, "Morning Walk", 13_000, 10_800, 246, (47.22, 8.72)),
            (.swim, "Lunch Swim", 1_200, 1_800, 0, (47.36, 8.55)),
            (.weightTraining, "Gymbro!", 0, 3_000, 0, nil),
        ]
        return plan.enumerated().map { index, item in
            let (sport, name, distance, moving, elevation, center) = item
            let start = anchor.addingTimeInterval(-Double(index) * 86_400 * 2.6)
            var activity = Activity(
                id: 1_000 + plan.count - index, name: name, sportType: sport, startDate: start,
                startDateLocal: start.addingTimeInterval(7_200), timezone: "Europe/Zurich",
                distance: distance, movingTime: moving, elapsedTime: moving + 420,
                totalElevationGain: elevation, averageSpeed: moving > 0 ? distance / Double(moving) : nil,
                commute: false, coordinates: center.map { loop(around: $0, radius: 0.02 + distance / 2_000_000, seed: index) } ?? []
            )
            if sport.category == .ride {
                activity.averageWatts = 180 + Double(index * 9)
                activity.weightedAverageWatts = 200 + Double(index * 9)
                activity.maxWatts = 640
            }
            if index % 3 == 0 {
                activity.averageHeartrate = 138
                activity.maxHeartrate = 174
            }
            return activity
        }
    }()

    private static func loop(around center: (Double, Double), radius: Double, seed: Int) -> [CLLocationCoordinate2D] {
        (0...48).map { step in
            let angle = Double(step) / 48 * 2 * .pi
            let wobble = 1 + 0.18 * sin(angle * Double(3 + seed % 4) + Double(seed))
            return CLLocationCoordinate2D(latitude: center.0 + radius * wobble * sin(angle) * 0.68,
                                          longitude: center.1 + radius * wobble * cos(angle))
        }
    }
}

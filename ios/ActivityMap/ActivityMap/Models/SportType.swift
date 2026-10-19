import SwiftUI

nonisolated enum ActivityCategory: String, CaseIterable, Identifiable, Sendable {
    case bcXcSki
    case trailHike
    case run
    case ride
    case misc

    var id: String { rawValue }

    var localizedName: LocalizedStringResource { SportPresentation.name(rawValue) }
    var name: String { String(localized: localizedName) }

    // Generated from shared/presentation by scripts/generate-presentation.mjs.
    var assetName: String { "Sport-\(rawValue)" }
    @MainActor var color: Color { Color(assetName) }

    var sportTypes: [SportType] {
        SportType.allCases.filter { $0.category == self }
    }
}

nonisolated enum SportType: String, CaseIterable, Identifiable, Sendable {
    case backcountrySki = "BackcountrySki"
    case nordicSki = "NordicSki"
    case rollerSki = "RollerSki"

    case hike = "Hike"
    case trailRun = "TrailRun"
    case rockClimbing = "RockClimbing"
    case snowshoe = "Snowshoe"

    case run = "Run"
    case virtualRun = "VirtualRun"

    case ride = "Ride"
    case virtualRide = "VirtualRide"
    case gravelRide = "GravelRide"
    case mountainBikeRide = "MountainBikeRide"
    case eBikeRide = "EBikeRide"
    case eMountainBikeRide = "EMountainBikeRide"
    case handcycle = "Handcycle"
    case velomobile = "Velomobile"

    case alpineSki = "AlpineSki"
    case badminton = "Badminton"
    case canoeing = "Canoeing"
    case crossfit = "Crossfit"
    case elliptical = "Elliptical"
    case golf = "Golf"
    case highIntensityIntervalTraining = "HighIntensityIntervalTraining"
    case iceSkate = "IceSkate"
    case inlineSkate = "InlineSkate"
    case kayaking = "Kayaking"
    case kitesurf = "Kitesurf"
    case pickleball = "Pickleball"
    case pilates = "Pilates"
    case racquetball = "Racquetball"
    case rowing = "Rowing"
    case sail = "Sail"
    case skateboard = "Skateboard"
    case snowboard = "Snowboard"
    case soccer = "Soccer"
    case squash = "Squash"
    case stairStepper = "StairStepper"
    case standUpPaddling = "StandUpPaddling"
    case surfing = "Surfing"
    case swim = "Swim"
    case tableTennis = "TableTennis"
    case tennis = "Tennis"
    case virtualRow = "VirtualRow"
    case walk = "Walk"
    case weightTraining = "WeightTraining"
    case wheelchair = "Wheelchair"
    case windsurf = "Windsurf"
    case workout = "Workout"
    case yoga = "Yoga"

    var id: String { rawValue }

    var category: ActivityCategory {
        ActivityCategory(rawValue: SportPresentation.categoryIDs[rawValue] ?? "misc") ?? .misc
    }
}

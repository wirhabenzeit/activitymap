import SwiftUI

enum ActivityCategory: String, CaseIterable, Identifiable {
    case bcXcSki
    case trailHike
    case run
    case ride
    case misc

    var id: String { rawValue }

    var name: String {
        switch self {
        case .bcXcSki: return "BC & XC Ski"
        case .trailHike: return "Trail / Hike"
        case .run: return "Run"
        case .ride: return "Ride"
        case .misc: return "Miscellaneous"
        }
    }

    var color: Color {
        switch self {
        case .bcXcSki: return Color(hex: "1982C4")
        case .trailHike: return Color(hex: "FF595E")
        case .run: return Color(hex: "FFCA3A")
        case .ride: return Color(hex: "8AC926")
        case .misc: return Color(hex: "6A4C93")
        }
    }

    var symbolName: String {
        switch self {
        case .bcXcSki: return "figure.skiing.crosscountry"
        case .trailHike: return "figure.hiking"
        case .run: return "figure.run"
        case .ride: return "figure.outdoor.cycle"
        case .misc: return "figure.mixed.cardio"
        }
    }

    var sportTypes: [SportType] {
        SportType.allCases.filter { $0.category == self }
    }
}

enum SportType: String, CaseIterable, Identifiable {
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
        switch self {
        case .backcountrySki, .nordicSki, .rollerSki:
            return .bcXcSki
        case .hike, .trailRun, .rockClimbing, .snowshoe:
            return .trailHike
        case .run, .virtualRun:
            return .run
        case .ride, .virtualRide, .gravelRide, .mountainBikeRide, .eBikeRide,
             .eMountainBikeRide, .handcycle, .velomobile:
            return .ride
        default:
            return .misc
        }
    }
}

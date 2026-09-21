import Foundation

enum Formatters {
    static func distance(_ meters: Double) -> String {
        String(format: "%.1fkm", meters / 1000)
    }

    static func elevation(_ meters: Double) -> String {
        String(format: "%.0fm", meters)
    }

    static func speed(_ metersPerSecond: Double) -> String {
        String(format: "%.1fkmh", metersPerSecond * 3.6)
    }

    static func watts(_ watts: Double) -> String {
        String(format: "%.0fW", watts)
    }

    static func heartrate(_ bpm: Double) -> String {
        String(format: "%.0fbpm", bpm)
    }

    static func duration(_ seconds: Int) -> String {
        let days = seconds / 86400
        let hours = (seconds % 86400) / 3600
        let minutes = (seconds % 3600) / 60
        if days > 0 {
            return "\(days)d\(hours)h"
        }
        return String(format: "%dh%02dm", hours, minutes)
    }

    static func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd/yy"
        return formatter.string(from: date)
    }

    static func shortDateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd/yy HH:mm"
        return formatter.string(from: date)
    }

    static func monthYear(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM yyyy"
        return formatter.string(from: date)
    }
}

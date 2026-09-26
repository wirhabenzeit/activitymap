import SwiftUI

struct CalendarHeatmapView: View {
    let activities: [Activity]

    private var weekCount: Int { 52 }

    private var dailyDistance: [Date: Double] {
        let calendar = Formatters.activityCalendar
        var totals: [Date: Double] = [:]
        for activity in activities {
            guard let distance = activity.distance else { continue }
            let day = calendar.startOfDay(for: activity.startDateLocal)
            totals[day, default: 0] += distance
        }
        return totals
    }

    private var days: [Date] {
        let calendar = Formatters.activityCalendar
        let today = calendar.startOfDay(for: Date())
        return (0..<(weekCount * 7)).reversed().map {
            calendar.date(byAdding: .day, value: -$0, to: today) ?? today
        }
    }

    private var maxDistance: Double {
        max(dailyDistance.values.max() ?? 1, 1)
    }

    private let columns = Array(repeating: GridItem(.fixed(11), spacing: 3), count: 52)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Activity by day")
                .font(.headline)

            let rows = 7
            let grid = Array(0..<rows).map { row in
                Array(0..<weekCount).map { col in days[col * rows + row] }
            }

            VStack(alignment: .leading, spacing: 3) {
                ForEach(0..<rows, id: \.self) { row in
                    HStack(spacing: 3) {
                        ForEach(0..<weekCount, id: \.self) { col in
                            let day = grid[row][col]
                            let distance = dailyDistance[day]
                            RoundedRectangle(cornerRadius: 2)
                                .fill(colorFor(distance))
                                .frame(width: 11, height: 11)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func colorFor(_ distance: Double?) -> Color {
        guard let distance, distance > 0 else { return Color(uiColor: .systemGray5) }
        let intensity = min(distance / maxDistance, 1)
        return Color.orange.opacity(0.25 + intensity * 0.75)
    }
}

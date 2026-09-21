import Charts
import SwiftUI

struct ProgressChartView: View {
    let activities: [Activity]

    private struct ProgressPoint: Identifiable {
        let id = UUID()
        let year: Int
        let dayOfYear: Int
        let cumulativeKm: Double
    }

    private var points: [ProgressPoint] {
        let calendar = Calendar.current
        let byYear = Dictionary(grouping: activities) { calendar.component(.year, from: $0.startDate) }

        var result: [ProgressPoint] = []
        for (year, yearActivities) in byYear {
            let sorted = yearActivities.sorted { $0.startDate < $1.startDate }
            var cumulative: Double = 0
            for activity in sorted {
                cumulative += activity.distance / 1000
                let day = calendar.ordinality(of: .day, in: .year, for: activity.startDate) ?? 0
                result.append(ProgressPoint(year: year, dayOfYear: day, cumulativeKm: cumulative))
            }
        }
        return result.sorted { $0.dayOfYear < $1.dayOfYear }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Cumulative distance, by year")
                .font(.headline)

            Chart(points) { point in
                LineMark(
                    x: .value("Day of year", point.dayOfYear),
                    y: .value("Distance", point.cumulativeKm)
                )
                .foregroundStyle(by: .value("Year", String(point.year)))
            }
            .frame(height: 260)
        }
    }
}

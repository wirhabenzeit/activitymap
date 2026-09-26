import Charts
import SwiftUI

struct TimelineChartView: View {
    let activities: [Activity]

    private struct WeekTotal: Identifiable {
        let id = UUID()
        let weekStart: Date
        let distanceKm: Double
    }

    private var weeklyTotals: [WeekTotal] {
        let calendar = Formatters.activityCalendar
        var totals: [Date: Double] = [:]
        for activity in activities {
            guard let distance = activity.distance else { continue }
            guard let weekStart = calendar.date(
                from: calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: activity.startDateLocal)
            ) else { continue }
            totals[weekStart, default: 0] += distance / 1000
        }
        return totals
            .map { WeekTotal(weekStart: $0.key, distanceKm: $0.value) }
            .sorted { $0.weekStart < $1.weekStart }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Distance per week")
                .font(.headline)

            Chart(weeklyTotals) { week in
                BarMark(
                    x: .value("Week", week.weekStart, unit: .weekOfYear),
                    y: .value("Distance", week.distanceKm)
                )
                .foregroundStyle(AppTheme.headerBackground)
            }
            .frame(height: 260)
        }
    }
}

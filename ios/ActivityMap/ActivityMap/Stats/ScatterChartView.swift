import Charts
import SwiftUI

struct ScatterChartView: View {
    let activities: [Activity]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Distance vs. elevation gain")
                .font(.headline)

            Chart(activities) { activity in
                PointMark(
                    x: .value("Distance", activity.distance / 1000),
                    y: .value("Elevation", activity.totalElevationGain)
                )
                .foregroundStyle(activity.category.color)
                .symbolSize(40)
            }
            .chartXAxisLabel("Distance (km)")
            .chartYAxisLabel("Elevation gain (m)")
            .frame(height: 260)
        }
    }
}

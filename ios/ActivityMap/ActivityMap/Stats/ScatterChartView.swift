import Charts
import SwiftUI

struct ScatterChartView: View {
    let activities: [Activity]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Distance vs. elevation gain")
                .font(.headline)

            Chart(activities) { activity in
                if let distance = activity.distance, let elevation = activity.totalElevationGain {
                    PointMark(
                        x: .value("Distance", distance / 1000),
                        y: .value("Elevation", elevation)
                    )
                    .foregroundStyle(activity.category.color)
                    .symbolSize(40)
                }
            }
            .chartXAxisLabel("Distance (km)")
            .chartYAxisLabel("Elevation gain (m)")
            .frame(height: 260)
        }
    }
}

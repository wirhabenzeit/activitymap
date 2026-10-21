#if DEBUG
import SwiftUI

/// Leaf controls which need a real accessibility automation session. These are
/// the production views with the same synthetic data as the former hosted AX
/// tests; no session, persistence or external service is involved.
struct StatsAccessibilityUITestFixture: View {
    let scenario: String
    @State private var metric = StatsMetric.distance
    @State private var inspection = StatsTileInspection()
    private let today = StatsDates.day("2026-10-10")

    var body: some View {
        Group {
            if scenario == "metric-picker" {
                StatsMetricPicker(title: "Training volume: Metric", metrics: [.distance, .time, .elevation], selection: $metric)
                    .padding().frame(width: 320)
            } else if scenario.hasPrefix("month-rhythm") {
                ScrollView {
                    StatsPeriodDetail(rhythm: .month(monthEngine.monthActivityRhythm(today: today, metric: .elevation)),
                                      history: [], metric: .elevation, today: today, openActivity: { _ in }) { EmptyView() }
                        .padding(16)
                }
                .environment(\.dynamicTypeSize, scenario.hasSuffix("large-text") ? .accessibility3 : .large)
            } else {
                VStack {
                    StatsMetricPicker(metrics: [.distance, .time], selection: $metric)
                    ScrollView {
                        StatsPeriodDetail(rhythm: .year(yearEngine.yearMonthlyRhythm(today: today, metric: metric)),
                                          history: [], metric: metric, today: today, openActivity: { _ in }) { EmptyView() }
                            .padding(16)
                    }
                }
                .environment(\.statsTileInspection, inspection)
            }
        }
        .environment(\.locale, Locale(identifier: "en_US"))
    }

    private var monthEngine: StatsEngine {
        StatsEngine(activities: [
            .init(id: 1, name: "Flat run", sport: .run, start: StatsDates.date(today - 2), distance: 5000, movingTime: 1800, elevation: 0),
            .init(id: 2, name: "Unmeasured run", sport: .run, start: StatsDates.date(today - 1), distance: 5000, movingTime: 1800, elevation: nil),
        ])
    }

    private var yearEngine: StatsEngine {
        StatsEngine(activities: [
            .init(id: 1, name: "Current", sport: .ride, start: StatsDates.date(StatsDates.day("2026-10-01")), distance: 20000, movingTime: 10800, elevation: 0),
            .init(id: 2, name: "Previous", sport: .ride, start: StatsDates.date(StatsDates.day("2025-10-01")), distance: 10000, movingTime: 7200, elevation: 0),
            .init(id: 3, name: "August", sport: .ride, start: StatsDates.date(StatsDates.day("2026-08-02")), distance: 45000, movingTime: 10800, elevation: 0),
            .init(id: 4, name: "Previous August", sport: .ride, start: StatsDates.date(StatsDates.day("2025-08-02")), distance: 30000, movingTime: 7200, elevation: 0),
        ])
    }
}
#endif

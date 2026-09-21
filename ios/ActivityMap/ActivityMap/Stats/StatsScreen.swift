import SwiftUI

enum StatsTab: String, CaseIterable, Identifiable {
    case calendar = "Calendar"
    case timeline = "Timeline"
    case progress = "Progress"
    case scatter = "Scatter"

    var id: String { rawValue }
}

struct StatsScreen: View {
    @Bindable var store: ActivityStore
    @State private var tab: StatsTab = .timeline

    var body: some View {
        VStack(spacing: 12) {
            Picker("", selection: $tab) {
                ForEach(StatsTab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.top, 8)

            ScrollView {
                Group {
                    switch tab {
                    case .calendar: CalendarHeatmapView(activities: store.filteredActivities)
                    case .timeline: TimelineChartView(activities: store.filteredActivities)
                    case .progress: ProgressChartView(activities: store.filteredActivities)
                    case .scatter: ScatterChartView(activities: store.filteredActivities)
                    }
                }
                .padding()
            }
        }
    }
}

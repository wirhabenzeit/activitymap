import SwiftUI

struct ActivityDetailView: View {
    let activity: Activity

    @State private var isRefreshing = false
    @Environment(\.dismiss) private var dismiss

    private struct StatRow: Identifiable {
        let id = UUID()
        let icon: String
        let text: String
    }

    private var stats: [StatRow] {
        var rows = [
            StatRow(icon: "calendar", text: Formatters.shortDateTime(activity.startDate)),
            StatRow(
                icon: "stopwatch",
                text: "\(Formatters.duration(activity.movingTime)) (moving), \(Formatters.duration(activity.elapsedTime)) (elapsed)"
            ),
            StatRow(icon: "ruler", text: Formatters.distance(activity.distance)),
        ]

        if let high = activity.elevHigh, let low = activity.elevLow {
            rows.append(
                StatRow(
                    icon: "mountain.2",
                    text: "+\(Formatters.elevation(activity.totalElevationGain)) (\(Formatters.elevation(high)) max, \(Formatters.elevation(low)) min)"
                )
            )
        }

        if let avg = activity.averageHeartrate, let max = activity.maxHeartrate {
            rows.append(
                StatRow(icon: "heart", text: "\(Formatters.heartrate(avg)) (avg), \(Formatters.heartrate(max)) (max)")
            )
        }

        if let weighted = activity.weightedAverageWatts, let avg = activity.averageWatts, let max = activity.maxWatts {
            rows.append(
                StatRow(
                    icon: "bolt",
                    text: "\(Formatters.watts(weighted)) (norm), \(Formatters.watts(avg)) (avg), \(Formatters.watts(max)) (max)"
                )
            )
        }

        return rows
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Image(systemName: activity.category.symbolName)
                        .font(.title2)
                        .foregroundStyle(activity.category.color)
                    VStack(alignment: .leading) {
                        Text(activity.name)
                            .font(.title3.bold())
                        if let description = activity.description {
                            Text(description)
                                .font(.subheadline)
                                .italic()
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    ForEach(stats) { stat in
                        HStack(spacing: 8) {
                            Image(systemName: stat.icon)
                                .foregroundStyle(.secondary)
                                .frame(width: 20)
                            Text(stat.text)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Spacer()

                HStack(spacing: 10) {
                    Button("Edit") {}
                        .buttonStyle(.borderedProminent)

                    Button {
                        isRefreshing = true
                        Task {
                            try? await Task.sleep(for: .seconds(1))
                            isRefreshing = false
                        }
                    } label: {
                        if isRefreshing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isRefreshing)

                    Button {} label: {
                        Image(systemName: "square.and.arrow.down")
                    }
                    .buttonStyle(.bordered)

                    Button("Strava") {}
                        .buttonStyle(.bordered)
                }
            }
            .padding()
            .navigationTitle("Activity")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

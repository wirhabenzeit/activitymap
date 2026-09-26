import SwiftUI

struct ActivityDetailView: View {
    let activity: Activity

    @State private var isRefreshing = false
    @Environment(\.dismiss) private var dismiss

    private var stats: [ActivityMetricRow] { ActivityMetricRow.rows(for: activity) }

    var body: some View {
        NavigationStack {
            ScrollView {
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
                                Text("\(stat.title): \(stat.value)")
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
            }
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

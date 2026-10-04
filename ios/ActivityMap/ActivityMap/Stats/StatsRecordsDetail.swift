import SwiftUI

struct StatsRecordsDetail: View {
    let current: StatsRecords
    let allTime: StatsRecords
    let best30: [StatsMetric: StatsBestDays]
    let year: Int
    let expanded: Bool
    var openActivity: (Int) -> Void
    @State private var range = StatsToggleOption.currentYear
    @Environment(\.dynamicTypeSize) private var typeSize
    private let metrics: [StatsMetric] = [.distance, .time, .elevation]
    private var records: StatsRecords { expanded && range == .allTime ? allTime : current }
    private func title(_ metric: StatsMetric) -> String {
        switch metric { case .distance: "Longest distance"; case .time: "Longest moving time"; case .elevation: "Biggest climb"; case .count: "Activities" }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StatsExpansionReveal(expanded: expanded) {
              VStack(alignment: .leading, spacing: 16) {
                StatsRangePicker(title: "Records period", ranges: [.currentYear, .allTime], selection: $range, label: StatsDisplay.option)
                Text(range == .allTime ? "All-time records" : "Records · \(String(year))").font(.caption).foregroundStyle(.secondary)
              }.padding(.bottom, 16)
            }
            StatsDetailGrid(expanded: expanded, compactColumns: typeSize.isAccessibilitySize ? 1 : 4) {
                ForEach(metrics, id: \.self) { metric in
                    VStack(alignment: .leading, spacing: 4) {
                        recordValue(title(metric), records.activities[metric].map { StatsDisplay.measurement($0.value, metric: metric) } ?? "—")
                        // Collapsed, say when and in which sport; expanded rows give the full detail.
                        StatsExpansionReveal(expanded: !expanded, inverted: true) {
                            if let record = records.activities[metric] {
                                Text("\(record.sport.name) · \(StatsDisplay.shortDate(record.day))").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        StatsExpansionReveal(expanded: expanded) {
                          if let record = records.activities[metric] {
                            if let id = record.activityID {
                                Button { openActivity(id) } label: {
                                    Text(record.name.isEmpty ? record.sport.name : record.name).underline()
                                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                                }.buttonStyle(.plain).font(.subheadline)
                                .accessibilityIdentifier("stats-record-\(metric.rawValue)-\(id)")
                            } else { Text(record.name).font(.subheadline) }
                            Text("\(record.sport.name) · \(StatsDisplay.date(record.day))").font(.caption).foregroundStyle(.secondary)
                          }
                        }
                    }.fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 4) {
                    recordValue("Biggest week", records.biggestWeek.map { StatsDisplay.measurement($0.value, metric: .distance) } ?? "—")
                    StatsExpansionReveal(expanded: !expanded, inverted: true) {
                        if let week = records.biggestWeek { Text("Week of \(StatsDisplay.shortDate(week.weekStart))").font(.caption).foregroundStyle(.secondary) }
                    }
                    StatsExpansionReveal(expanded: expanded) {
                        if let week = records.biggestWeek { Text("Week of \(StatsDisplay.date(week.weekStart))").font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
            StatsExpansionReveal(expanded: expanded) {
              VStack(alignment: .leading, spacing: 16) {
                Divider()
                Text("Best 30 days · \(String(year))").font(.caption).foregroundStyle(.secondary)
                if best30[.distance]?.hasCompleteWindow != true {
                    Text("The first complete 30-day window this year ends on Jan 30.").font(.caption)
                } else {
                    ForEach(metrics, id: \.self) { metric in
                        if let best = best30[metric] {
                            VStack(alignment: .leading, spacing: 4) {
                                ViewThatFits(in: .horizontal) {
                                    HStack { Text(metric.definition.label); Spacer(); Text(best.total > 0 ? StatsDisplay.measurement(best.total, metric: metric) : "—").monospacedDigit() }
                                    VStack(alignment: .leading) { Text(metric.definition.label); Text(StatsDisplay.measurement(best.total, metric: metric)).monospacedDigit() }
                                }
                                if best.total > 0 {
                                    Text("\(StatsDisplay.date(best.start)) – \(StatsDisplay.date(best.end))").foregroundStyle(.secondary)
                                    Text("Last 30 days: \(StatsDisplay.measurement(best.current, metric: metric)) · \(StatsDisplay.number(best.current / best.total * 100))% of best").foregroundStyle(.secondary)
                                } else { Text("No \(metric.definition.label.lowercased()) recorded this year.").foregroundStyle(.secondary) }
                            }.font(.caption).fixedSize(horizontal: false, vertical: true)
                            if metric != .elevation { Divider() }
                        }
                    }
                }
              }.padding(.top, 16)
            }
        }
    }
    private func recordValue(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
    }
}

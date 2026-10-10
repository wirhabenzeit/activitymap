import SwiftUI

struct StatsRecordsDetail: View {
    let current: StatsRecords
    let allTime: StatsRecords
    let best30: [StatsMetric: StatsBestDays]
    let year: Int
    let expanded: Bool
    var filtered = false
    var openActivity: (Int) -> Void
    @State private var range = StatsToggleOption.currentYear
    @Environment(\.statsTileInspection) private var inspection
    private var periodSelection: Binding<StatsToggleOption> {
        if let inspection {
            return Binding(get: { inspection.recordsRange }, set: { inspection.recordsRange = $0 })
        }
        return $range
    }
    @Environment(\.statsAvailableWidth) private var availableWidth
    @Environment(\.statsInspectedActivityID) private var inspectedID
    @State private var contentWidth: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var typeSize
    private let metrics: [StatsMetric] = [.distance, .time, .elevation]
    private var records: StatsRecords { expanded && periodSelection.wrappedValue == .allTime ? allTime : current }
    private func title(_ metric: StatsMetric) -> String {
        switch metric { case .distance: "Longest distance"; case .time: "Longest moving time"; case .elevation: "Biggest climb"; case .count: "Activities" }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StatsExpansionReveal(expanded: expanded) {
                VStack(alignment: .leading, spacing: 16) {
                    Text("\(filtered ? "Filtered activities" : "Across all sports") · Use Filters to adjust these rankings.")
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("stats-records-scope")
                    if availableWidth < BrowsePaneLayout.minimumDetailWidth {
                        StatsRangePicker(title: "Records period", ranges: [.currentYear, .allTime], selection: periodSelection, label: StatsDisplay.option)
                    }
                    let layout = contentWidth >= 700 && !typeSize.isAccessibilitySize
                        ? AnyLayout(HStackLayout(alignment: .top, spacing: 24))
                        : AnyLayout(VStackLayout(alignment: .leading, spacing: 24))
                    layout {
                        if availableWidth >= BrowsePaneLayout.minimumDetailWidth || periodSelection.wrappedValue == .currentYear {
                            podium(current, label: "This year · \(String(year))", period: "currentYear")
                        }
                        if availableWidth >= BrowsePaneLayout.minimumDetailWidth || periodSelection.wrappedValue == .allTime {
                            podium(allTime, label: "All time", period: "allTime")
                        }
                    }
                }.padding(.bottom, 16)
            }
            StatsExpansionReveal(expanded: !expanded, inverted: true) {
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
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
    }
    private func podium(_ records: StatsRecords, label: String, period: String) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(label).font(.headline).accessibilityAddTraits(.isHeader)
            ForEach(metrics, id: \.self) { metric in
                VStack(alignment: .leading, spacing: 4) {
                    Text(title(metric)).font(.caption).foregroundStyle(.secondary)
                    Divider()
                    let entries = records.rankings[metric] ?? records.activities[metric].map { [$0] } ?? []
                    if entries.isEmpty { Text("No record yet").font(.caption).foregroundStyle(.secondary) }
                    ForEach(Array(entries.enumerated()), id: \.offset) { index, record in
                        let rank = entries.firstIndex { $0.value == record.value } ?? index
                        let name = record.name.trimmingCharacters(in: .whitespacesAndNewlines)
                        if let id = record.activityID {
                            Button { openActivity(id) } label: {
                                rankedRow(rank: rank, name: name.isEmpty ? record.sport.name : name,
                                          detail: "\(record.sport.name) · \(StatsDisplay.date(record.day))",
                                          value: StatsDisplay.measurement(record.value, metric: metric))
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 4)
                            .background(inspectedID == id ? AppTheme.accent.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 6))
                            .accessibilityAddTraits(inspectedID == id ? .isSelected : [])
                            .accessibilityIdentifier("stats-record-\(period)-\(metric.rawValue)-\(id)")
                        } else {
                            rankedRow(rank: rank, name: name.isEmpty ? record.sport.name : name,
                                      detail: "\(record.sport.name) · \(StatsDisplay.date(record.day))",
                                      value: StatsDisplay.measurement(record.value, metric: metric))
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Biggest week").font(.caption).foregroundStyle(.secondary)
                Divider()
                let weeks = records.biggestWeeks.isEmpty ? records.biggestWeek.map { [$0] } ?? [] : records.biggestWeeks
                if weeks.isEmpty { Text("No record yet").font(.caption).foregroundStyle(.secondary) }
                ForEach(Array(weeks.enumerated()), id: \.offset) { index, week in
                    rankedRow(rank: weeks.firstIndex { $0.value == week.value } ?? index,
                              name: "Week of \(StatsDisplay.date(week.weekStart))",
                              detail: period == "currentYear" ? "Distance within this year" : "Total distance",
                              value: StatsDisplay.measurement(week.value, metric: .distance))
                }
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func rankedRow(rank: Int, name: String, detail: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "medal.fill")
                .foregroundStyle([Color.yellow, Color.gray, Color.brown][min(rank, 2)])
                .accessibilityLabel(["Gold", "Silver", "Bronze"][min(rank, 2)])
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 8) {
                    recordIdentity(name, detail: detail)
                    Spacer(minLength: 4)
                    Text(value).font(.subheadline.weight(rank == 0 ? .semibold : .regular)).monospacedDigit().fixedSize()
                }
                VStack(alignment: .leading, spacing: 4) {
                    recordIdentity(name, detail: detail)
                    Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
                }
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func recordIdentity(_ name: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name).font(.subheadline.weight(.medium))
            Text(detail).font(.caption).foregroundStyle(.secondary)
        }.fixedSize(horizontal: false, vertical: true)
    }

    private func recordValue(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
    }
}

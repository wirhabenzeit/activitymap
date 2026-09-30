import SwiftUI

/// A scrollable result row, never a fixed footer that steals map/list space.
struct ActivitySummaryView: View {
    @Bindable var store: ActivityStore
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var allMetricsExpanded = false

    init(store: ActivityStore, allMetricsExpanded: Bool = false) {
        self.store = store
        _allMetricsExpanded = State(initialValue: allMetricsExpanded)
    }

    private var mode: ActivitySummaryMode { store.listPresentation.settings.summaryMode }
    private var highlights: [ActivitySummaryMetric] { [.distance, .elapsedTime, .elevationGain] }

    var body: some View {
        if let summary = store.activitySummary {
            VStack(alignment: .leading, spacing: 12) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline) { heading(summary); Spacer(); hideButton }
                    VStack(alignment: .leading, spacing: 4) { heading(summary); hideButton }
                }
                .fixedSize(horizontal: false, vertical: true)
                Text(typeSize.isAccessibilitySize ? conciseScope : scopeExplanation)
                    .accessibilityLabel(scopeExplanation).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(highlights) { metric in metricView(metric, summary: summary, alwaysShowCoverage: false) }
                }
                DisclosureGroup(isExpanded: $allMetricsExpanded) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Means use only recorded activity values. Weighted average power is a source metric; activities are not weighted together.")
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                            ForEach(ActivitySummaryMetric.allCases) { metric in
                                metricView(metric, summary: summary, alwaysShowCoverage: true)
                            }
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Text("All summary metrics").frame(minHeight: 44, alignment: .leading)
                }
                .font(.subheadline)
                .accessibilityIdentifier("activity-summary-expand")
            }
            .padding(.vertical, 8)
            .accessibilityIdentifier("activity-summary")
        }
    }

    private var columns: [GridItem] {
        typeSize.isAccessibilitySize ? [GridItem(.flexible(), alignment: .leading)]
            : [GridItem(.adaptive(minimum: 140), alignment: .leading)]
    }
    private func heading(_ summary: ActivitySummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(typeSize.isAccessibilitySize ? "\(mode == .filtered ? "Filtered" : "Selected") summary" : "\(mode.title) summary")
                .font(.headline).accessibilityAddTraits(.isHeader)
                .accessibilityLabel("\(mode.title) summary")
            Text("\(summary.activityCount) \(summary.activityCount == 1 ? "activity" : "activities") · \(summary.localDayCount) \(typeSize.isAccessibilitySize ? "" : "local ")\(summary.localDayCount == 1 ? "day" : "days")")
                .accessibilityLabel("\(summary.activityCount) activities on \(summary.localDayCount) distinct activity-local calendar days")
                .font(.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("activity-summary-counts")
        }
        .fixedSize(horizontal: false, vertical: true)
    }
    private var hideButton: some View {
        Button("Hide") { store.listPresentation.settings.summaryMode = .off }
            .frame(minWidth: 44, minHeight: 44)
            .accessibilityLabel("Turn off activity summary")
    }
    private var conciseScope: String {
        if mode == .filtered { return "All filtered activities" }
        return store.hiddenSelectedCount > 0 ? "\(store.hiddenSelectedCount) hidden selections included" : "All selected activities"
    }
    private var scopeExplanation: String {
        switch mode {
        case .off: ""
        case .filtered: "All matching activities, including rows offscreen."
        case .selected:
            store.hiddenSelectedCount > 0
                ? "Includes \(store.hiddenSelectedCount) selected activities hidden by filters."
                : "All selected activities, including any hidden by filters."
        }
    }
    private func metricView(_ metric: ActivitySummaryMetric, summary: ActivitySummary, alwaysShowCoverage: Bool) -> some View {
        let aggregate = summary[metric]
        let formatted = metric.formatted(aggregate.value)
        let coverage = summary.activityCount == 0 ? "No activities in this scope" : "Recorded in \(aggregate.knownCount) of \(summary.activityCount) activities"
        return VStack(alignment: .leading, spacing: 4) {
            Text(metric.title).font(.caption).foregroundStyle(.secondary)
            Text(formatted).font(.subheadline.weight(.semibold)).monospacedDigit()
            if alwaysShowCoverage || aggregate.knownCount < summary.activityCount {
                Text(coverage).font(.caption2).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(metric.title)
        .accessibilityValue("\(formatted == Formatters.unknown ? "Not recorded" : formatted). \(coverage)")
        .accessibilityIdentifier("activity-summary-\(metric.id)")
    }
}

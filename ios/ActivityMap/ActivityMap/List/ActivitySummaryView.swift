import SwiftUI

/// A scrollable result row, never a fixed footer that steals map/list space.
struct ActivitySummaryView: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    @Bindable var store: ActivityStore
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var allMetricsExpanded = false

    init(store: ActivityStore, allMetricsExpanded: Bool = false) {
        self.store = store
        _allMetricsExpanded = State(initialValue: allMetricsExpanded)
    }

    private var mode: ActivitySummaryMode { store.listPresentation.settings.summaryMode }
    private var highlights: [ActivitySummaryMetric] { [.distance, .elapsedTime, .elevationGain] }
    private var additionalMetrics: [ActivitySummaryMetric] {
        ActivitySummaryMetric.allCases.filter { !highlights.contains($0) }
    }

    var body: some View {
        if let summary = store.activitySummary {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Summary").font(.headline).accessibilityAddTraits(.isHeader)
                        .accessibilityValue(mode.title)
                    Spacer()
                    Button { store.listPresentation.settings.summaryMode = .off } label: {
                        Image(systemName: "xmark").font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel("Turn off activity summary")
                }
                if !store.selectedActivityIDs.isEmpty {
                    Picker("Summary scope", selection: Binding(get: { mode },
                                                               set: { store.listPresentation.settings.summaryMode = $0 })) {
                        Text("Filtered").tag(ActivitySummaryMode.filtered)
                        Text("Selected").tag(ActivitySummaryMode.selected)
                    }
                    .pickerStyle(.segmented)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("activity-summary-scope")
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
                    ForEach(highlights) { metric in metricView(metric, summary: summary) }
                }
                DisclosureGroup(isExpanded: expansion) {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
                        ForEach(additionalMetrics) { metric in metricView(metric, summary: summary) }
                    }
                    .padding(.top, 8)
                } label: {
                    Text("More metrics").frame(minHeight: 44, alignment: .leading)
                }
                .font(.subheadline)
                .accessibilityIdentifier("activity-summary-expand")
            }
            .padding(.vertical, 4)
            .buttonStyle(.borderless)
            .accessibilityIdentifier("activity-summary")
        }
    }

    // A List cell and DisclosureGroup otherwise animate the same self-sizing
    // content independently. Commit the disclosure as one layout update.
    private var expansion: Binding<Bool> {
        Binding(get: { allMetricsExpanded }, set: { expanded in
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) { allMetricsExpanded = expanded }
        })
    }

    private var columns: [GridItem] {
        typeSize.isAccessibilitySize ? [GridItem(.flexible(), alignment: .leading)]
            : [GridItem(.adaptive(minimum: 140), alignment: .leading)]
    }

    private func metricView(_ metric: ActivitySummaryMetric, summary: ActivitySummary) -> some View {
        let formatted = metric.formatted(summary[metric].value, units: units, locale: locale)
        return VStack(alignment: .leading, spacing: 4) {
            Text(metric.title).font(.caption).foregroundStyle(.secondary)
            Text(formatted).font(.title3.weight(.semibold)).monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(metric.title)
        .accessibilityValue(formatted == Formatters.unknown ? "Not recorded" : formatted)
        .accessibilityIdentifier("activity-summary-\(metric.id)")
    }
}

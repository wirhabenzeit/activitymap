import SwiftUI

/// Shared building blocks of the expanded Stats explorers: a large headline,
/// the activities of the selected period and an optional data table.

struct StatsExplorerHeadline: View {
    let value: String
    let unit: String
    let caption: String
    var note: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(Text(value).font(AppTheme.Typography.statsHeadline)) \(Text(unit).font(.caption).foregroundColor(.secondary))")
                .monospacedDigit().fixedSize(horizontal: false, vertical: true)
            Text(caption).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let note { Text(note).font(.subheadline).fixedSize(horizontal: false, vertical: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The activities inside the selected bar: a heading with previous/next steps
/// (a precise alternative to tapping a thin bar), then one row per activity.
struct StatsExplorerActivities: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    @Environment(\.statsInspectedActivityID) private var inspectedActivityID
    let heading: String
    let activities: [StatsActivity]
    let metric: StatsMetric
    let identifierPrefix: String
    let openActivity: (Int) -> Void
    var emptyText = "No matching activities in this period."
    var step: ((Int) -> Void)? = nil
    var canStep: (back: Bool, forward: Bool) = (true, true)

    private var sorted: [StatsActivity] {
        activities.enumerated().sorted { a, b in
            if a.element.start != b.element.start { return a.element.start < b.element.start }
            switch (a.element.id, b.element.id) {
            case let (x?, y?): return x < y
            case (nil, _?): return false
            case (_?, nil): return true
            default: return a.offset < b.offset
            }
        }.map(\.element)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 4) {
                Text(heading).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 4)
                if let step {
                    stepButton("chevron.left", label: "Previous period", enabled: canStep.back) { step(-1) }
                    stepButton("chevron.right", label: "Next period", enabled: canStep.forward) { step(1) }
                }
            }
            Divider().padding(.top, 4)
            if activities.isEmpty {
                Text(emptyText).font(.caption).foregroundStyle(.secondary).padding(.vertical, 12)
            }
            ForEach(Array(sorted.enumerated()), id: \.offset) { _, activity in
                StatsActivityRow(sport: activity.sport, name: activity.name,
                                 summary: "\(StatsDisplay.shortDate(activity.day, locale: locale)) · \(StatsDisplay.measurement(activity.value(metric), metric: metric, units: units, locale: locale))",
                                 open: activity.id.map { id in { openActivity(id) } })
                    .background(activity.id != nil && activity.id == inspectedActivityID ? Color.accentColor.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 8))
                    .accessibilityIdentifier(activity.id.map { "\(identifierPrefix)\($0)" } ?? "")
                Divider()
            }
        }
    }

    private func stepButton(_ symbol: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.body.weight(.semibold))
                .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).foregroundStyle(enabled ? AppTheme.accent : Color.secondary.opacity(0.4))
        .disabled(!enabled).accessibilityLabel(label)
    }
}

/// Raw tables stay available but collapsed, as on the web.
extension EnvironmentValues {
    /// Opens explorer data tables on first appearance; hosts such as rendering tests set it.
    @Entry var statsExplorerDataShown = false
}

struct StatsExplorerData<Content: View>: View {
    @State private var shown = false
    @Environment(\.statsExplorerDataShown) private var startsShown
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            Button { withAnimation(.easeInOut(duration: 0.2)) { shown.toggle() } } label: {
                HStack(spacing: 6) {
                    Text(shown ? "Hide data" : "Show data").font(.subheadline.weight(.medium))
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold)).rotationEffect(.degrees(shown ? 180 : 0))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.secondary)
                .frame(minHeight: AppTheme.minimumTarget).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("stats-explorer-data-toggle")
            .accessibilityAddTraits(.isButton)
            .accessibilityValue(shown ? "Expanded" : "Collapsed")
            if shown { content() }
        }
        .onAppear { if startsShown { shown = true } }
    }
}

/// "Historical range" as a compact checkbox, small enough to sit beside the
/// comparison picker, with its definition one tap away.
struct StatsHistoricalRangeControl: View {
    @Binding var isOn: Bool
    let explanation: String
    @State private var explaining = false

    var body: some View {
        HStack(spacing: 0) {
            Toggle("Historical range", isOn: $isOn)
                .toggleStyle(StatsCheckboxToggleStyle())
                .accessibilityIdentifier("stats-historical-range")
            Button { explaining = true } label: {
                Image(systemName: "info.circle").font(.footnote)
                    .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget).contentShape(Rectangle())
            }
            .buttonStyle(.plain).foregroundStyle(.secondary)
            .accessibilityLabel("About historical range")
            .popover(isPresented: $explaining) {
                Text(explanation).font(.callout).padding().frame(maxWidth: 320)
                    .presentationCompactAdaptation(.popover)
            }
        }
    }
}

/// A checkmark beside a short label; VoiceOver still reads the full toggle title.
private struct StatsCheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: 6) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.body).foregroundStyle(configuration.isOn ? AppTheme.accent : Color.secondary)
                Text("Range").font(.caption).foregroundStyle(.secondary)
            }
            .frame(minHeight: AppTheme.minimumTarget).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(configuration.isOn ? "Historical range, shown" : "Historical range, hidden")
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(configuration.isOn ? "On" : "Off")
    }
}

/// Selecting among earlier periods to compare with, as a native menu.
struct StatsComparisonPicker: View {
    let title: String
    let options: [(start: Int, label: String)]
    @Binding var selection: Int
    var identifier: String

    var body: some View {
        HStack(spacing: 6) {
            Text("Comparing with").font(.caption).foregroundStyle(.secondary)
            Picker(title, selection: $selection) {
                ForEach(options, id: \.start) { Text($0.label).tag($0.start) }
            }
            .pickerStyle(.menu).labelsHidden().fixedSize().accessibilityLabel(title)
            .accessibilityIdentifier(identifier)
        }
        .frame(minHeight: AppTheme.minimumTarget)
    }
}

/// A horizontally scrolling table whose header row and numbers align.
struct StatsExplorerTable<Row: Identifiable, Cell: View>: View {
    let title: String
    let headers: [String]
    let rows: [Row]
    var note: String? = nil
    @ViewBuilder let cells: (Row) -> Cell

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
            ScrollView(.horizontal) {
                Grid(alignment: .trailing, horizontalSpacing: 20, verticalSpacing: 4) {
                    GridRow {
                        ForEach(Array(headers.enumerated()), id: \.offset) { index, header in
                            Text(header).foregroundStyle(.secondary).gridColumnAlignment(index == 0 ? .leading : .trailing)
                        }
                    }.accessibilityAddTraits(.isHeader)
                    ForEach(rows) { row in
                        GridRow { cells(row) }.accessibilityElement(children: .combine)
                    }
                }
                .font(.caption).monospacedDigit().fixedSize(horizontal: true, vertical: false).padding(.vertical, 4)
            }
            if let note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
    }
}

import SwiftUI

struct ListControls: View {
    @Bindable var presentation: ActivityListPresentation
    @State private var sortOpen = false
    @State private var displayOpen = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { controls }
            VStack(alignment: .leading, spacing: 0) { controls }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
        .background(.bar, ignoresSafeAreaEdges: [])
        .sheet(isPresented: $sortOpen) {
            NavigationStack {
                Form {
                    Section {
                        Picker("Direction", selection: $presentation.settings.sort.direction) {
                            ForEach(ActivitySortDirection.allCases) { Text($0.title).tag($0) }
                        }
                        Button("No sort — use Activity ID descending") {
                            presentation.settings.sort = ActivityListSort()
                        }
                    } footer: {
                        Text("Unknown values appear last in both directions. Equal values use Activity ID descending.")
                    }
                    Section {
                        Picker("Sort by", selection: $presentation.settings.sort.field) {
                            ForEach(ActivitySortField.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.inline)
                    }
                }
                .navigationTitle("Sort activities")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sortOpen = false } } }
            }
        }
        .sheet(isPresented: $displayOpen) {
            NavigationStack {
                Form {
                    Section {
                        Picker("Summary", selection: $presentation.settings.summaryMode) {
                            ForEach(ActivitySummaryMode.allCases) { Text($0.title).tag($0) }
                        }
                    } footer: {
                        Text("Filtered totals include every matching activity. Selected totals include selections hidden by filters. This continuous list has no page scope.")
                    }
                    Section("Layout") {
                        Picker("Density", selection: $presentation.settings.density) {
                            ForEach(ActivityListDensity.allCases) { Text($0.title).tag($0) }
                        }
                        Picker("Metrics layout", selection: $presentation.settings.width) {
                            ForEach(ActivityListWidth.allCases) { Text($0.title).tag($0) }
                        }
                    }
                    Section {
                        ForEach(ActivityListMetric.allCases) { metric in
                            Toggle(metric.title, isOn: Binding(
                                get: { presentation.settings.visibleMetrics.contains(metric) },
                                set: { visible in
                                    if visible { presentation.settings.visibleMetrics.insert(metric) }
                                    else { presentation.settings.visibleMetrics.remove(metric) }
                                }))
                        }
                        Button("Restore default display") {
                            presentation.settings.visibleMetrics = [.distance, .elapsedTime, .elevationGain]
                            presentation.settings.density = .comfortable
                            presentation.settings.width = .fitWidth
                        }
                    } header: { Text("Visible metrics") }
                    footer: { Text("Name, sport and local date always stay visible. Open Details to inspect all available information, including hidden metrics.") }
                }
                .navigationTitle("List display")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { displayOpen = false } } }
            }
        }
    }

    @ViewBuilder private var controls: some View {
        Button { sortOpen = true } label: {
            Label(typeSize.isAccessibilitySize ? "Sort" : "\(presentation.settings.sort.field.title) · \(presentation.settings.sort.direction.title)", systemImage: "arrow.up.arrow.down")
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 44, alignment: .leading)
        }
        .accessibilityLabel("Sort activities")
        .accessibilityValue("\(presentation.settings.sort.field.title), \(presentation.settings.sort.direction.title)")
        .accessibilityIdentifier("list-sort-control")
        Button { displayOpen = true } label: {
            Label("Display", systemImage: "slider.horizontal.3")
                .frame(minHeight: 44)
        }
        .accessibilityLabel("List display options")
        .accessibilityIdentifier("list-display-control")
    }
}

import SwiftUI

struct ListControls: View {
    @Bindable var presentation: ActivityListPresentation
    var iconOnly = false
    @State private var sortOpen = false
    @State private var displayOpen = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        controls
        .font(.caption)
        .foregroundStyle(.primary)
        .buttonStyle(.plain)
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
                    footer: { Text("Name, sport and local date always stay visible. Distance, elapsed time and elevation use table columns in Fit Width. Additional metrics and accessibility text use stacked rows. Open Details to inspect hidden metrics.") }
                }
                .navigationTitle("List display")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { displayOpen = false } } }
            }
        }
    }

    private var controls: some View {
        Menu {
            Button { sortOpen = true } label: {
                Label("Sort activities", systemImage: "arrow.up.arrow.down")
            }
            .accessibilityValue("\(presentation.settings.sort.field.title), \(presentation.settings.sort.direction.title)")
            .accessibilityIdentifier("list-sort-control")
            Button { displayOpen = true } label: {
                Label("Columns and layout", systemImage: "rectangle.split.3x1")
            }
            .accessibilityIdentifier("list-display-control")
        } label: {
            Group {
                if iconOnly || typeSize.isAccessibilitySize {
                    Image(systemName: "slider.horizontal.3")
                } else {
                    Label("View", systemImage: "slider.horizontal.3")
                }
            }
            .foregroundStyle(AppTheme.accent)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("List view options")
        .accessibilityValue("Sorted by \(presentation.settings.sort.field.title), \(presentation.settings.sort.direction.title)")
    }
}

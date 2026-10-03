import SwiftUI

struct ListControls: View {
    @Bindable var presentation: ActivityListPresentation
    var iconOnly = false
    @Binding var sortOpen: Bool
    @Binding var displayOpen: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        controls
        .font(.caption)
        .foregroundStyle(.primary)
        .buttonStyle(.plain)
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

/// Owned by the retained list, never by an adaptive header branch.
struct ListOptionsSheets: ViewModifier {
    @Bindable var presentation: ActivityListPresentation
    @Binding var sortOpen: Bool
    @Binding var displayOpen: Bool

    func body(content: Content) -> some View {
        content
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
                    footer: { Text("Name, sport and local date always stay visible. Fit Width shows aligned sortable columns whenever the chosen metrics fit, including on phones. Adding more metrics can switch to stacked rows and remove the column headings. Scroll Metrics uses horizontally scrolling values in each row. Accessibility text uses stacked rows. Open Details to inspect hidden metrics.") }
                }
                .navigationTitle("List display")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { displayOpen = false } } }
            }
        }
    }
}

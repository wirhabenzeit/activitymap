import SwiftUI

struct ListControls: View {
    @Bindable var presentation: ActivityListPresentation
    var iconOnly = false
    var onNavigationBar = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        controls
        .font(.caption)
        .foregroundStyle(.primary)
        .buttonStyle(.plain)
    }

    private var controls: some View {
        Menu {
            Button { presentation.sortOpen = true } label: {
                Label("Sort activities", systemImage: "arrow.up.arrow.down")
            }
            .accessibilityValue("\(presentation.settings.sort.field.title), \(presentation.settings.sort.direction.title)")
            .accessibilityIdentifier("list-sort-control")
            Button { presentation.displayOpen = true } label: {
                Label("View and metrics", systemImage: "rectangle.split.3x1")
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
            .foregroundStyle(onNavigationBar ? Color.white : AppTheme.accent)
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
    var availableWidth: CGFloat = 390

    private var metricsFitColumns: Bool {
        ActivityTableLayout.metricsFit(presentation.settings, availableWidth: availableWidth)
    }

    func body(content: Content) -> some View {
        content
        .sheet(isPresented: $presentation.sortOpen) {
            NavigationStack {
                Form {
                    Section {
                        Picker("Direction", selection: $presentation.settings.sort.direction) {
                            ForEach(ActivitySortDirection.allCases) { direction in
                                Text(presentation.settings.sort.field == .selection
                                     ? (direction == .descending ? "Selected first" : "Unselected first")
                                     : direction.title).tag(direction)
                            }
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
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { presentation.sortOpen = false } } }
            }
        }
        .sheet(isPresented: $presentation.displayOpen) {
            NavigationStack {
                Form {
                    Section {
                        HStack(spacing: 2) {
                            ForEach(ActivityListWidth.allCases) { view in
                                let disabled = view == .columns && !metricsFitColumns
                                Button { presentation.settings.width = view } label: {
                                    Text(view.title)
                                        .font(.subheadline.weight(.medium))
                                        .foregroundStyle(disabled ? .secondary : .primary)
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                        .background(presentation.settings.width == view ? AppTheme.surface : .clear,
                                                    in: RoundedRectangle(cornerRadius: 8))
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(disabled)
                                .accessibilityAddTraits(presentation.settings.width == view ? .isSelected : [])
                            }
                        }
                        .padding(3)
                        .background(Color(uiColor: .tertiarySystemFill), in: RoundedRectangle(cornerRadius: 11))
                        .accessibilityIdentifier("list-layout-picker")
                    } header: { Text("View") }
                    footer: {
                        Text(metricsFitColumns
                             ? "Columns aligns values under sortable headers. Details wraps labelled metrics beneath each activity."
                             : "These metrics need Details at this window width. Choose fewer metrics to use Columns.")
                    }
                    Section("Density") {
                        Picker("Density", selection: $presentation.settings.density) {
                            ForEach(ActivityListDensity.allCases) { Text($0.title).tag($0) }
                        }
                    }
                    Section {
                        ForEach(ActivityListMetric.allCases) { metric in
                            Toggle(metric.title, isOn: Binding(
                                get: { presentation.settings.visibleMetrics.contains(metric) },
                                set: { visible in
                                    if visible { presentation.settings.visibleMetrics.insert(metric) }
                                    else { presentation.settings.visibleMetrics.remove(metric) }
                                    if presentation.settings.width == .columns && !metricsFitColumns {
                                        presentation.settings.width = .details
                                    }
                                }))
                        }
                        Button("Restore default display") {
                            presentation.settings.visibleMetrics = [.distance, .elapsedTime, .elevationGain]
                            presentation.settings.density = .comfortable
                            presentation.settings.width = .columns
                        }
                    } header: { Text("Metrics") }
                    footer: { Text("Your selection is shared by both views. Adding more metrics than Columns can fit switches to Details. Name, sport and local date always stay visible. Larger accessibility text stacks metrics for readability.") }
                }
                .navigationTitle("List display")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { presentation.displayOpen = false } } }
            }
        }
    }
}

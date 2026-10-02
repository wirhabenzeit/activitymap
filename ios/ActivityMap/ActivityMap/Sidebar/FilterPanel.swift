import SwiftUI

struct FilterPanel: View {
    @Bindable var store: ActivityStore
    @State private var editingCustomDates = false
    @State private var startDate = Date()
    @State private var endDate = Date()

    var body: some View {
        Form {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(store.filteredActivities.count) of \(store.activities.count) activities")
                            .font(.subheadline.weight(.semibold))
                            .accessibilityIdentifier("filter-result-count")
                        if store.activeFilterCount > 0 {
                            Text("\(store.activeFilterCount) active filters").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Button("Reset") {
                        store.resetFilters()
                        editingCustomDates = false
                    }
                    .font(.caption).frame(minHeight: 44)
                    .disabled(store.activeFilterCount == 0)
                    .accessibilityLabel("Reset all filters")
                }
            }
            searchSection
            metricsSection.id(store.filterResetRevision)
            dateSection
            activitySection
            binarySection
        }
        .onChange(of: store.filterResetRevision) { _, _ in
            editingCustomDates = false
            loadDateDraft()
        }
    }

    private var searchSection: some View {
        Section("Name Search") {
            TextField("Search activity names", text: $store.searchText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier("activity-name-search")
            if !store.searchText.isEmpty {
                Button("Clear Search") { store.searchText = "" }
            }
        }
    }

    private var activitySection: some View {
        Section {
            Button("Select All Sports") { store.showAllCategories() }
            Button("Deselect All Sports") { store.activeSportTypes = [] }
            ForEach(ActivityCategory.allCases) { category in
                DisclosureGroup {
                    Button("Only \(category.name)") { store.isolateCategory(category) }
                    ForEach(category.sportTypes) { sport in
                        Toggle(sport.rawValue, isOn: Binding(
                            get: { store.activeSportTypes.contains(sport) },
                            set: { selected in
                                if selected { store.activeSportTypes.insert(sport) }
                                else { store.activeSportTypes.remove(sport) }
                            }
                        ))
                        .accessibilityIdentifier("sport-\(sport.rawValue)")
                    }
                } label: {
                    Button {
                        store.toggleCategory(category)
                    } label: {
                        HStack {
                            Label {
                                Text(category.name).foregroundStyle(.primary)
                            } icon: {
                                BrowseSportSymbol(category: category)
                            }
                            Spacer()
                            Image(systemName: store.categorySelection(category).symbolName)
                                .foregroundStyle(.tint)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(category.name)
                    .accessibilityValue(store.categorySelection(category).label)
                    .accessibilityHint("Toggle all sports in this group. Expand to choose individual sports.")
                }
            }
        } header: {
            Text("Sports · \(store.activeSportTypes.count) of \(SportType.allCases.count) selected")
        }
    }

    private var dateSection: some View {
        Section {
            Picker("Range", selection: dateSelection) {
                ForEach(ActivityDatePreset.allCases) { preset in
                    Text(preset.rawValue).tag(preset)
                }
            }
            if editingCustomDates || dateSelection.wrappedValue == .custom {
                DatePicker("From", selection: $startDate, displayedComponents: .date)
                    .environment(\.calendar, ActivityDayRange.calendar(timeZone: .current))
                DatePicker("Through", selection: $endDate, displayedComponents: .date)
                    .environment(\.calendar, ActivityDayRange.calendar(timeZone: .current))
                if customRange == nil {
                    Text("The end day must be on or after the start day. The applied range is unchanged.")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                Button("Apply Date Range") {
                    if let customRange { store.dateDayRange = customRange }
                }
                .disabled(customRange == nil)
            }
            if let range = store.dateDayRange {
                Text("Applied: \(range.start) through \(range.end), inclusive")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Clear Date Range") {
                    store.dateDayRange = nil
                    editingCustomDates = false
                }
            }
        } header: {
            Text("Activity-Local Dates")
        } footer: {
            Text("Each activity uses the day where it took place. Full calendar periods include both ends.")
        }
        .onAppear { loadDateDraft() }
        .onChange(of: store.dateDayRange) { _, _ in loadDateDraft() }
    }

    private var metricsSection: some View {
        Section {
            NumericFilterRow(title: "Distance", icon: "ruler", unit: "km", scale: 1_000, filter: $store.distanceFilter, suggestedMaximum: max(100, (store.activities.compactMap(\.distance).max() ?? 0) / 1000))
            NumericFilterRow(title: "Elapsed Duration", icon: "stopwatch", unit: "h", scale: 3_600, filter: $store.durationFilter, suggestedMaximum: max(12, Double(store.activities.compactMap(\.elapsedTime).max() ?? 0) / 3600), step: 0.25)
            NumericFilterRow(title: "Elevation Gain", icon: "mountain.2", unit: "m", scale: 1, filter: $store.elevationFilter, suggestedMaximum: max(3000, store.activities.compactMap(\.totalElevationGain).max() ?? 0), step: 50)
        } header: {
            Text("Measurements")
        } footer: {
            Text("Any leaves that end open. Active ranges exclude activities without a recorded measurement.")
        }
    }

    private var binarySection: some View {
        Section {
            binaryPicker("Commute", value: $store.commuteOnly)
            binaryPicker("Private", value: $store.privateFilter)
            binaryPicker("Flagged", value: $store.flaggedFilter)
        } header: {
            Text("Activity Details")
        } footer: {
            Text("Any includes unknown values. Yes and No match only recorded true or false values.")
        }
    }

    private func binaryPicker(_ title: String, value: Binding<Bool?>) -> some View {
        Picker(title, selection: Binding(
            get: { BinaryFilterMode(value.wrappedValue) },
            set: { value.wrappedValue = $0.value }
        )) {
            ForEach(BinaryFilterMode.allCases) { mode in Text(mode.rawValue).tag(mode) }
        }
    }

    private var customRange: ActivityDayRange? { ActivityDayRange(start: startDate, end: endDate) }

    private var dateSelection: Binding<ActivityDatePreset> {
        Binding(
            get: {
                if editingCustomDates { return .custom }
                guard let range = store.dateDayRange else { return .allTime }
                return ActivityDatePreset.allCases.first { $0 != .custom && $0.range() == range } ?? .custom
            },
            set: { preset in
                editingCustomDates = preset == .custom
                if preset == .custom { loadDateDraft() }
                else { store.dateDayRange = preset.range() }
            }
        )
    }

    private func loadDateDraft() {
        if let range = store.dateDayRange?.pickerRange() {
            startDate = range.lowerBound
            endDate = range.upperBound
        } else {
            endDate = Date()
            startDate = ActivityDayRange.calendar(timeZone: .current).date(byAdding: .year, value: -1, to: endDate) ?? endDate
        }
    }
}

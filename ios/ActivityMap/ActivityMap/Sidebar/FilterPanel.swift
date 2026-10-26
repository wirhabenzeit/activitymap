import SwiftUI

struct FilterPanel: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Bindable var store: ActivityStore
    var scope: FilterScope = .browsing
    /// One part alone, as the iPad filter rail's popovers show it; nil is the whole panel.
    var part: FilterPart? = nil
    var onDismiss: (() -> Void)? = nil
    @State private var editingCustomDates = false
    @State private var contentScrolled = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var startDate = Date()
    @State private var endDate = Date()

    private var count: Int { scope == .stats ? store.stats.matchingActivityCount(for: store) : store.browsingActivities.count }
    private var activeCount: Int { scope == .stats ? store.activeStatsFilterCount : store.activeFilterCount }

    var body: some View {
        VStack(spacing: 0) {
            if part == nil { summaryHeader }
            Form {
                if let part { single(part) } else { full }
            }
            .scrollContentBackground(.hidden)
            .listSectionSpacing(.compact)
            .contentMargins(.top, 8, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .onScrollGeometryChange(for: Bool.self) {
                $0.contentOffset.y + $0.contentInsets.top > 1
            } action: { _, scrolled in
                contentScrolled = scrolled
            }
        }
        .onChange(of: store.filterResetRevision) { _, _ in
            editingCustomDates = false
            loadDateDraft()
        }
    }

    @ViewBuilder private func single(_ part: FilterPart) -> some View {
        switch part {
        case .search: Section { searchField }
        case .selection: Section { selectionFilter }
        case .sports: activitySection
        case .dates: dateSection
        case .distance, .duration, .elevation: metricsSection([part]).id(store.filterResetRevision)
        case .details: binarySection
        }
    }

    @ViewBuilder private var full: some View {
        Section {
            searchField
            if scope != .stats { selectionFilter }
        }
        activitySection
        if scope != .stats { dateSection }
        metricsSection([.distance, .duration, .elevation]).id(store.filterResetRevision)
        binarySection
    }

    private var summaryHeader: some View {
        HStack(spacing: 12) {
            Group {
                if onDismiss != nil {
                    ViewThatFits(in: .horizontal) {
                        resultCount(compact: false).fixedSize()
                        resultCount(compact: true)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 2) {
                        resultCount(compact: false)
                        if activeCount > 0 {
                            Text("\(activeCount) active filters")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            FilterResetButton(store: store, scope: scope, iconOnly: onDismiss != nil && typeSize.isAccessibilitySize)
                .font(.subheadline)
                .fixedSize(horizontal: true, vertical: false)
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
                        .background(.quaternary, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close filters")
                .accessibilityIdentifier("filters-done")
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, onDismiss == nil ? 4 : 16)
        .padding(.bottom, 4)
        .overlay(alignment: .bottom) {
            if contentScrolled { Divider() }
        }
    }

    private func resultCount(compact: Bool) -> some View {
        Text(compact ? "\(count) / \(store.activities.count)" : "\(count) of \(store.activities.count) activities")
            .font(.subheadline.weight(.semibold))
            .accessibilityLabel("\(count) of \(store.activities.count) activities")
            .accessibilityValue("\(activeCount) active filters")
            .accessibilityIdentifier("filter-result-count")
    }

    private var selectionFilter: some View {
        Toggle("Only selected activities", isOn: Binding(get: { store.onlySelected }, set: { store.setOnlySelected($0) }))
            .disabled(store.selectedActivityIDs.isEmpty)
            .accessibilityIdentifier("only-selected-filter")
    }

    private var searchField: some View { PlaceSearchField(store: store) }

    private var activitySection: some View {
        Section {
            HStack {
                Button("All") { store.showAllCategories() }
                    .disabled(store.activeSportTypes.count == SportType.allCases.count)
                    .accessibilityLabel("Select all sports")
                Button("None") { store.activeSportTypes = [] }
                    .disabled(store.activeSportTypes.isEmpty)
                    .accessibilityLabel("Deselect all sports")
                Spacer()
                Text("\(store.activeSportTypes.count)/\(SportType.allCases.count)")
                    .font(.caption).foregroundStyle(.secondary)
                    .accessibilityLabel("\(store.activeSportTypes.count) of \(SportType.allCases.count) sport types selected")
            }
            .buttonStyle(.borderless)
            .frame(minHeight: 44)
            VStack(spacing: 8) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: typeSize.isAccessibilitySize ? 1 : 2), spacing: 8) {
                    ForEach(ActivityCategory.allCases.filter { $0 != .misc }) { sportChip($0) }
                }
                sportChip(.misc)
            }
            .listRowSeparator(.hidden)
            DisclosureGroup("Specific sport types") {
                ForEach(ActivityCategory.allCases) { category in
                    DisclosureGroup {
                        Button("Only \(category.name)") { store.isolateCategory(category) }
                            .buttonStyle(.borderless)
                            .frame(minHeight: 44)
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
                        HStack {
                            Text(category.name)
                            Spacer()
                            Text("\(store.activeSportTypes.intersection(category.sportTypes).count)/\(category.sportTypes.count)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } header: {
            // A popover already titles its single part.
            if part == nil { Text("Sports") }
        }
    }

    private func sportChip(_ category: ActivityCategory) -> some View {
        let state = store.categorySelection(category)
        return Button { store.toggleCategory(category) } label: {
            HStack(spacing: 4) {
                BrowseSportSymbol(category: category)
                    .opacity(state == .none ? 0.45 : 1)
                Text(category.name)
                    .font(.caption.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: state.symbolName).font(.caption2)
                    .foregroundStyle(state == .none ? Color.secondary : category.color)
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .frame(minHeight: 44)
            .foregroundStyle(.primary)
            .background(category.color.opacity(state == .all ? 0.12 : 0.03), in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(state == .none ? Color.secondary.opacity(0.2) : category.color.opacity(0.65)) }
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(category.name)
        .accessibilityValue(state.label)
        .accessibilityHint("Toggle this group. Use Specific sport types for individual choices.")
        .accessibilityAddTraits(state == .all ? .isSelected : [])
        .accessibilityIdentifier("sport-group-\(category.rawValue)")
        .contextMenu {
            Button("Only \(category.name)") { store.isolateCategory(category) }
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
            if part == nil { Text("Activity-Local Dates") }
        } footer: {
            Text("Each activity uses the day where it took place. Full calendar periods include both ends.")
        }
        .onAppear { loadDateDraft() }
        .onChange(of: store.dateDayRange) { _, _ in loadDateDraft() }
    }

    private func metricsSection(_ metrics: [FilterPart]) -> some View {
        Section {
            if metrics.contains(.distance) {
                NumericFilterRow(title: "Distance", icon: "ruler", unit: units.distanceUnit, scale: units.distanceScale, filter: $store.distanceFilter, suggestedMaximum: max(100, (store.activities.compactMap(\.distance).max() ?? 0) / units.distanceScale))
            }
            if metrics.contains(.duration) {
                NumericFilterRow(title: "Duration", icon: "stopwatch", unit: "h", scale: 3_600, filter: $store.durationFilter, suggestedMaximum: max(12, Double(store.activities.compactMap(\.elapsedTime).max() ?? 0) / 3600), step: 0.25)
            }
            if metrics.contains(.elevation) {
                NumericFilterRow(title: "Elevation", icon: "mountain.2", unit: units.elevationUnit, scale: units.elevationScale, filter: $store.elevationFilter, suggestedMaximum: max(3000, store.activities.compactMap(\.totalElevationGain).max() ?? 0) / units.elevationScale, step: 50)
            }
        } header: {
            if part == nil { Text("Measurements") }
        } footer: {
            Text("Drag to an outer edge to leave that end unlimited. Active ranges exclude activities without a recorded measurement.")
        }
    }

    private var binarySection: some View {
        Section {
            binaryPicker("Commute", value: $store.commuteOnly)
            binaryPicker("Private", value: $store.privateFilter)
            binaryPicker("Flagged", value: $store.flaggedFilter)
        } header: {
            if part == nil { Text("Activity Details") }
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

/// The panel's independently usable parts, in panel order.
enum FilterPart: CaseIterable, Identifiable {
    case search, selection, sports, dates, distance, duration, elevation, details

    var id: Self { self }

    var title: String {
        switch self {
        case .search: "Search"
        case .selection: "Selected activities"
        case .sports: "Sports"
        case .dates: "Dates"
        case .distance: "Distance"
        case .duration: "Duration"
        case .elevation: "Elevation"
        case .details: "Activity details"
        }
    }

    var symbol: String {
        switch self {
        case .search: "magnifyingglass"
        case .selection: "line.3.horizontal.decrease"
        case .sports: "figure.run"
        case .dates: "calendar"
        case .distance: "ruler"
        case .duration: "stopwatch"
        case .elevation: "mountain.2"
        case .details: "flag"
        }
    }

    /// Stats measures its own periods, so it has no date filter.
    static func available(in scope: FilterScope) -> [FilterPart] {
        allCases.filter { scope != .stats || ($0 != .dates && $0 != .selection) }
    }

    /// Matches the parts `ActivityStore.activeFilterCount` counts.
    @MainActor func isActive(_ store: ActivityStore) -> Bool {
        switch self {
        case .selection: store.onlySelected
        case .search: store.selectedPlace != nil || !store.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .sports: store.activeSportTypes != Set(SportType.allCases)
        case .dates: store.dateDayRange != nil
        case .distance: store.distanceFilter != nil
        case .duration: store.durationFilter != nil
        case .elevation: store.elevationFilter != nil
        case .details: store.commuteOnly != nil || store.privateFilter != nil || store.flaggedFilter != nil
        }
    }
}

enum FilterScope {
    case browsing, stats

    @MainActor func reset(_ store: ActivityStore) {
        if self == .stats { store.resetStatsActivityFilters() }
        else { store.resetFilters() }
    }
}

/// Reset also discards local numeric/date drafts when no predicates are applied.
/// Keep it available in both full-panel and rail presentations; the store's
/// reset revision invalidates draft editors without unnecessary filter work.
struct FilterResetButton: View {
    let store: ActivityStore
    let scope: FilterScope
    var iconOnly = false
    var body: some View {
        Button { scope.reset(store) } label: {
            if iconOnly {
                Image(systemName: "arrow.counterclockwise")
                    .frame(width: AppTheme.minimumTarget, height: AppTheme.minimumTarget)
                    .contentShape(Rectangle())
            } else { Text("Reset").frame(minHeight: AppTheme.minimumTarget) }
        }
        .accessibilityLabel(scope == .stats ? "Reset Stats activity filters" : "Reset all filters")
        .accessibilityIdentifier("filter-reset")
    }
}

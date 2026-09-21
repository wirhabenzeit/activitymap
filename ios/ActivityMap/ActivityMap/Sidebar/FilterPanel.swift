import SwiftUI

struct FilterPanel: View {
    @Bindable var store: ActivityStore

    var body: some View {
        Form {
            activitySection
            dateSection
            metricsSection
            commuteSection

            Section {
                Button("Reset All Filters", role: .destructive) {
                    store.resetFilters()
                }
                .disabled(store.activeFilterCount == 0)
            }
        }
    }

    private var activitySection: some View {
        Section("Activity Types") {
            ForEach(ActivityCategory.allCases) { category in
                Button {
                    store.toggleCategory(category)
                } label: {
                    HStack {
                        Label {
                            Text(category.name)
                                .foregroundStyle(.primary)
                        } icon: {
                            Image(systemName: category.symbolName)
                                .foregroundStyle(category.color)
                        }

                        Spacer()

                        if store.activeCategories.contains(category) {
                            Image(systemName: "checkmark")
                                .fontWeight(.semibold)
                                .foregroundStyle(.tint)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var dateSection: some View {
        Section("Date") {
            Picker("Range", selection: dateSelection) {
                Text("All Time").tag(DatePreset.allTime)
                Text("This Year").tag(DatePreset.thisYear)
                Text("Last 12 Months").tag(DatePreset.lastTwelveMonths)
            }
        }
    }

    private var metricsSection: some View {
        Section("Minimums") {
            MinimumFilterRow(
                title: "Distance",
                systemImage: "ruler",
                unit: "km",
                scale: 1_000,
                filter: $store.distanceFilter
            )
            MinimumFilterRow(
                title: "Elevation",
                systemImage: "mountain.2",
                unit: "m",
                scale: 1,
                filter: $store.elevationFilter
            )
            MinimumFilterRow(
                title: "Duration",
                systemImage: "stopwatch",
                unit: "h",
                scale: 3_600,
                filter: $store.durationFilter
            )
        }
    }

    private var commuteSection: some View {
        Section {
            Toggle("Commutes Only", isOn: commuteBinding)
        } header: {
            Text("Activity Details")
        }
    }

    private var commuteBinding: Binding<Bool> {
        Binding(
            get: { store.commuteOnly == true },
            set: { store.commuteOnly = $0 ? true : nil }
        )
    }

    private var dateSelection: Binding<DatePreset> {
        Binding(
            get: { DatePreset(range: store.dateRange) },
            set: { store.dateRange = $0.range }
        )
    }
}

private enum DatePreset: Hashable {
    case allTime
    case thisYear
    case lastTwelveMonths

    init(range: ClosedRange<Date>?) {
        guard let range else {
            self = .allTime
            return
        }

        let calendar = Calendar.current
        if let startOfYear = calendar.dateInterval(of: .year, for: Date())?.start,
           calendar.isDate(range.lowerBound, inSameDayAs: startOfYear) {
            self = .thisYear
        } else {
            self = .lastTwelveMonths
        }
    }

    var range: ClosedRange<Date>? {
        let now = Date()
        switch self {
        case .allTime:
            return nil
        case .thisYear:
            let start = Calendar.current.dateInterval(of: .year, for: now)?.start ?? now
            return start...now
        case .lastTwelveMonths:
            let start = Calendar.current.date(byAdding: .year, value: -1, to: now) ?? now
            return start...now
        }
    }
}

private struct MinimumFilterRow: View {
    let title: LocalizedStringKey
    let systemImage: String
    let unit: LocalizedStringKey
    let scale: Double
    @Binding var filter: NumericFilter?

    private var value: Binding<Double?> {
        Binding(
            get: { filter.map { $0.value / scale } },
            set: { newValue in
                filter = newValue.map { NumericFilter(operatorType: .gte, value: $0 * scale) }
            }
        )
    }

    var body: some View {
        LabeledContent {
            HStack(spacing: 6) {
                TextField("Any", value: value, format: .number)
                    .multilineTextAlignment(.trailing)
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
                Text(unit)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: 120)
        } label: {
            Label(title, systemImage: systemImage)
        }
    }
}

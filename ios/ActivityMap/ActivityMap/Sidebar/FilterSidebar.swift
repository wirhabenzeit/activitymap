import SwiftUI

struct FilterSidebar: View {
    @Bindable var store: ActivityStore

    private var expanded: Bool { store.sidebarExpanded }

    var body: some View {
        VStack(spacing: 4) {
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(ActivityCategory.allCases) { category in
                        categoryRow(category)
                    }

                    Divider().padding(.vertical, 4)

                    dateRangeRow

                    NumericFilterRow(
                        icon: "ruler",
                        unit: "km",
                        expanded: expanded,
                        filter: $store.distanceFilter
                    )
                    NumericFilterRow(
                        icon: "mountain.2",
                        unit: "m",
                        expanded: expanded,
                        filter: $store.elevationFilter
                    )
                    NumericFilterRow(
                        icon: "stopwatch",
                        unit: "h",
                        expanded: expanded,
                        filter: $store.durationFilter
                    )

                    commuteRow
                }
                .padding(.horizontal, expanded ? 12 : 0)
                .padding(.top, 8)
            }

            Spacer(minLength: 0)

            Image(systemName: "person.crop.circle.fill")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
                .padding(.bottom, 12)
        }
        .frame(width: expanded ? AppTheme.sidebarExpandedWidth : AppTheme.sidebarCollapsedWidth)
        .background(AppTheme.sidebarBackground)
    }

    private func categoryRow(_ category: ActivityCategory) -> some View {
        let isActive = store.activeCategories.contains(category)

        return Button {
            store.toggleCategory(category)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: category.symbolName)
                    .foregroundStyle(isActive ? category.color : .secondary)
                    .frame(width: 32, height: 32)
                if expanded {
                    Text(category.name)
                        .foregroundStyle(isActive ? .primary : .secondary)
                    Spacer()
                }
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Show only \(category.name)") {
                store.isolateCategory(category)
            }
            Button("Show all categories") {
                store.showAllCategories()
            }
            Divider()
            ForEach(category.sportTypes) { sportType in
                let selected = store.activeSportTypes.contains(sportType)
                Button {
                    store.toggleSportType(sportType)
                } label: {
                    Label(sportType.rawValue, systemImage: selected ? "checkmark" : "")
                }
            }
        }
    }

    private var dateRangeRow: some View {
        Group {
            if expanded {
                Button {
                    // Presents a range picker inline; simplified to a toggle for the draft.
                    store.dateRange = store.dateRange == nil ? Self.lastYearRange : nil
                } label: {
                    HStack {
                        Image(systemName: "calendar")
                            .frame(width: 32, height: 32)
                        Text(dateRangeLabel)
                            .foregroundStyle(store.dateRange == nil ? .secondary : .primary)
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    store.dateRange = store.dateRange == nil ? Self.lastYearRange : nil
                } label: {
                    Image(systemName: "calendar")
                        .foregroundStyle(store.dateRange == nil ? .secondary : AppTheme.headerBackground)
                        .frame(width: 32, height: 32)
                }
            }
        }
    }

    private var dateRangeLabel: String {
        guard let range = store.dateRange else { return "Pick a date range" }
        return "\(Formatters.monthYear(range.lowerBound)) - \(Formatters.monthYear(range.upperBound))"
    }

    private static var lastYearRange: ClosedRange<Date> {
        let end = Date()
        let start = Calendar.current.date(byAdding: .year, value: -1, to: end) ?? end
        return start...end
    }

    private var commuteRow: some View {
        Group {
            if expanded {
                HStack {
                    Image(systemName: "briefcase")
                        .frame(width: 32, height: 32)
                    Text("Commutes")
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { store.commuteOnly ?? false },
                        set: { store.commuteOnly = $0 }
                    ))
                    .labelsHidden()
                }
            } else {
                Button {
                    store.commuteOnly = (store.commuteOnly ?? false) ? nil : true
                } label: {
                    Image(systemName: "briefcase")
                        .foregroundStyle((store.commuteOnly ?? false) ? AppTheme.headerBackground : .secondary)
                        .frame(width: 32, height: 32)
                }
            }
        }
    }
}

import SwiftUI

struct StatsCalendarDetail: View {
    let rolling: StatsCalendarSnapshot
    let years: [Int: StatsCalendarSnapshot]
    let today: Int
    let option: StatsToggleOption
    let expanded: Bool
    var openActivity: (Int) -> Void
    var expand: () -> Void = {}
    @State private var year: Int?
    @State var selectedDay: Int?
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var colorScheme
    private var snapshot: StatsCalendarSnapshot { expanded ? year.flatMap { years[$0] } ?? rolling : rolling }
    private var first: Int { snapshot.months.first?.first ?? today }
    private var last: Int { snapshot.months.last?.last ?? today }
    private var metric: StatsMetric? { StatsMetric(rawValue: option.rawValue) }
    private var maximum: Double { snapshot.days.values.map { $0.totals[metric ?? .time] }.max() ?? 0 }
    private var currentYear: Int { StatsDates.parts(today).year! }
    private var categories: [ActivityCategory] { ActivityCategory.allCases.filter { sport in snapshot.days.values.contains { $0.activities.contains { $0.sport == sport } } } }
    private var emptyColor: Color { Color.secondary.opacity(0.12) }
    private var heatColor: Color { colorScheme == .dark ? Color(red: 1, green: 0.416, blue: 0.302) : Color(red: 0.878, green: 0.271, blue: 0.18) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            StatsExpansionReveal(expanded: expanded) { navigation }
            Text("\(Text(StatsDisplay.number(Double(snapshot.days.count))).font(.title2.weight(.semibold))) \(Text("active days").font(.caption).foregroundColor(.secondary))").monospacedDigit()
            Text(expanded ? "\(StatsDisplay.date(first)) – \(StatsDisplay.date(last))" : "\(StatsDisplay.number(Double(snapshot.days.count) / Double(last - first + 1) * 100))% of days in the last 12 months")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            calendar
            legend
            if let day = selectedDay, day >= first, day <= last { dayDetails(day) }
        }
        .onChange(of: years.keys.sorted()) { _, available in
            if let year, !available.contains(year) { self.year = nil }
            selectedDay = nil
        }
        .onChange(of: first) { _, _ in clearOutOfRangeSelection() }
        .onChange(of: last) { _, _ in clearOutOfRangeSelection() }
    }
    private var navigation: some View {
        HStack {
            Button { selectedDay = nil; year = (year ?? currentYear) - 1 } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .disabled((year ?? currentYear) <= (years.keys.min() ?? currentYear)).accessibilityLabel("Previous calendar year")
            Picker("Calendar period", selection: Binding(get: { year }, set: { selectedDay = nil; year = $0 })) {
                Text("Last 12 months").tag(Int?.none)
                ForEach(years.keys.sorted(by: >), id: \.self) { Text(String($0)).tag(Optional($0)) }
            }.pickerStyle(.menu).frame(minHeight: 44).frame(maxWidth: .infinity)
            Button { selectedDay = nil; year = min(currentYear, (year ?? currentYear) + 1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .disabled(year == nil || year! >= currentYear).accessibilityLabel("Next calendar year")
        }
    }
    private func select(_ day: Int) {
        selectedDay = day
        if !expanded { year = nil; expand() }
    }
    private func clearOutOfRangeSelection() {
        if let day = selectedDay, day < first || day > last { selectedDay = nil }
    }
    private var calendar: some View {
        VStack(spacing: 2) {
            ForEach(snapshot.months, id: \.start) { month in
                HStack(spacing: 4) {
                    Text(monthLabel(month.start)).font(.caption2).foregroundStyle(.secondary).frame(width: typeSize.isAccessibilitySize ? 78 : 44, alignment: .leading)
                    GeometryReader { geo in
                        HStack(spacing: 2) {
                            ForEach(0..<31, id: \.self) { index in
                                let day = month.start + index
                                let valid = index < month.length && day >= month.first && day <= month.last
                                RoundedRectangle(cornerRadius: 2).fill(valid ? color(day) : .clear)
                                    .overlay {
                                        if valid && option == .sport && snapshot.days[day]?.mixed == true {
                                            Canvas { context, size in
                                                var path = Path()
                                                for x in stride(from: -size.height, through: size.width, by: 6) {
                                                    path.move(to: CGPoint(x: x, y: size.height)); path.addLine(to: CGPoint(x: x + size.height, y: 0))
                                                }
                                                context.stroke(path, with: .color(.white.opacity(0.85)), lineWidth: 2)
                                            }.clipShape(RoundedRectangle(cornerRadius: 2))
                                        }
                                    }
                                    .overlay {
                                        if valid && day == selectedDay {
                                            RoundedRectangle(cornerRadius: 3).stroke(colorScheme == .dark ? Color.black : .white, lineWidth: 4)
                                            RoundedRectangle(cornerRadius: 3).stroke(Color.primary, lineWidth: 2).padding(-2)
                                        }
                                    }
                                    .zIndex(day == selectedDay ? 1 : 0)
                            }
                        }.contentShape(Rectangle())
                        .onTapGesture { location in
                            let index = min(30, max(0, Int(location.x / (geo.size.width / 31))))
                            let day = month.start + index
                            if day >= month.first && day <= month.last { select(day) }
                        }
                    }.statsExpansionHeight(expanded: expanded, compact: 12, detail: 22)
                }
            }
        }
        .accessibilityRepresentation {
            VStack {
                ForEach(Array(first...last), id: \.self) { day in
                    Button(dayDescription(day)) { select(day) }
                        .accessibilityAddTraits(day == selectedDay ? .isSelected : [])
                }
            }.accessibilityLabel("Activity calendar")
        }
    }
    @ViewBuilder private var legend: some View {
        if option == .sport {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 260 : 106), alignment: .leading)], alignment: .leading, spacing: 5) {
                ForEach(categories) { category in
                    HStack(spacing: 4) { Rectangle().fill(category.color).frame(width: 8, height: 8); Text(category.name).font(.caption2) }
                        .accessibilityElement(children: .combine)
                }
            }
            if snapshot.days.values.contains(where: \.mixed) { Text("Striped: multiple sports").font(.caption2).foregroundStyle(.secondary) }
        } else if let metric {
            HStack(spacing: 8) {
                Text("0")
                LinearGradient(colors: [emptyColor, heatColor], startPoint: .leading, endPoint: .trailing).frame(width: 64, height: 8)
                Text(StatsDisplay.measurement(maximum, metric: metric))
            }.font(.caption2).foregroundStyle(.secondary).accessibilityElement(children: .combine)
        }
    }
    private func monthLabel(_ day: Int) -> String {
        let name = StatsDates.date(day).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated))
        return "\(name) '\(String(StatsDates.parts(day).year!).suffix(2))"
    }
    private func color(_ day: Int) -> Color {
        guard let data = snapshot.days[day] else { return emptyColor }
        guard let metric else { return data.dominantSport.color }
        return maximum > 0 ? heatColor.opacity(0.12 + 0.88 * data.totals[metric] / maximum) : emptyColor
    }
    private func dayDescription(_ day: Int) -> String {
        guard let data = snapshot.days[day] else { return "\(StatsDisplay.date(day)): No matching activities" }
        return "\(StatsDisplay.date(day)): \(data.mixed ? "Multiple sports" : data.dominantSport.name), \(StatsDisplay.measurement(data.totals[metric ?? .time], metric: metric ?? .time))"
    }
    private func dayDetails(_ day: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            HStack(alignment: .firstTextBaseline) {
                Text(StatsDisplay.date(day)).font(.subheadline.weight(.semibold))
                Spacer()
                Button("Close") { selectedDay = nil }.font(.caption).frame(minHeight: 44).accessibilityLabel("Close day details")
            }
            Text("Activities matching your current filters.").font(.caption).foregroundStyle(.secondary)
            if let data = snapshot.days[day] {
                ForEach(Array(data.activities.enumerated()), id: \.offset) { _, activity in
                    VStack(alignment: .leading, spacing: 4) {
                        if let id = activity.id {
                            Button { openActivity(id) } label: {
                                Text(activity.name.isEmpty ? "Untitled activity" : activity.name).underline().frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            }.buttonStyle(.plain).accessibilityIdentifier("stats-calendar-activity-\(id)")
                        } else { Text(activity.name) }
                        Text("\(activity.sport.name) · \(StatsDisplay.measurement(activity.value(.distance), metric: .distance)) · \(StatsDisplay.measurement(activity.value(.elevation), metric: .elevation)) · \(StatsDisplay.measurement(activity.value(.time), metric: .time))").font(.caption).foregroundStyle(.secondary)
                    }.font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
            } else { Text("No matching activities on this day.").font(.caption) }
        }
    }
}

import SwiftUI

struct StatsCalendarDetail: View {
    let rolling: StatsCalendarSnapshot
    let years: [Int: StatsCalendarSnapshot]
    let today: Int
    let option: StatsToggleOption
    let expanded: Bool
    var openActivity: (Int) -> Void
    var expand: () -> Void = {}
    var summaryControls: AnyView? = nil
    var background: Color = AppTheme.surface
    @State var selectedDay: Int?
    @State private var localWeek: Int?
    @State private var width: CGFloat = 0
    @ScaledMetric(relativeTo: .caption2) private var compactCell: CGFloat = 18
    @ScaledMetric(relativeTo: .caption2) private var detailCell: CGFloat = 20
    @Environment(\.statsInspectedActivityID) private var inspectedActivityID
    @Environment(\.statsTileInspection) private var inspection
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.statsDetailHeightLimit) private var shortViewportLimit

    private var focusedDay: Int? {
        get { if let inspection { return inspection.calendarDay }; return selectedDay }
        nonmutating set { if let inspection { inspection.calendarDay = newValue } else { selectedDay = newValue } }
    }
    private var visibleWeek: Binding<Int?> {
        Binding(get: {
            if let inspection { return inspection.calendarWeek ?? focusedDay.map(StatsDates.monday) }
            return localWeek ?? focusedDay.map(StatsDates.monday)
        }, set: { week in
            if let inspection { inspection.calendarWeek = week } else { localWeek = week }
        })
    }
    private var metric: StatsMetric? { StatsMetric(rawValue: option.rawValue) }
    private var weekdayWidth: CGFloat { typeSize.isAccessibilitySize ? max(58, compactCell * 1.8) : 28 }
    private var emptyColor: Color { Color.secondary.opacity(0.12) }
    private var heatColor: Color { colorScheme == .dark ? Color(red: 1, green: 0.416, blue: 0.302) : Color(red: 0.878, green: 0.271, blue: 0.18) }

    var body: some View {
        // Merge the prepared yearly metadata once per render; no additional query.
        let history = expanded ? years.values.reduce(into: rolling.days) { days, snapshot in
            days.merge(snapshot.days) { _, latest in latest }
        } : rolling.days
        let layout = expanded
            ? StatsCalendarLayout.history(today: today, earliest: history.keys.min(), cellSize: max(20, detailCell.rounded()))
            : StatsCalendarLayout.summary(today: today, width: max(1, width == 0 ? 320 : width),
                height: shortViewportLimit ?? 300, scaledCell: typeSize.isAccessibilitySize ? compactCell : nil,
                weekdayWidth: weekdayWidth)
        let days = history.filter { $0.key >= layout.first && $0.key <= layout.last }
        let maximum = days.values.map { $0.totals[metric ?? .time] }.max() ?? 0
        VStack(alignment: .leading, spacing: 10) {
            if expanded {
                Text("\(Text(StatsDisplay.number(Double(days.count))).font(.title2.weight(.semibold))) \(Text("active days").font(.caption).foregroundColor(.secondary))").monospacedDigit()
                Text("\(StatsDisplay.date(layout.first)) – \(StatsDisplay.date(layout.last))")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { activeDays(days.count); Spacer(minLength: 8); summaryControls }
                    VStack(alignment: .leading, spacing: 4) { activeDays(days.count); summaryControls }
                }
                .accessibilityIdentifier("stats-calendar-summary-header")
                Text("\(StatsDisplay.number(Double(days.count) / Double(layout.last - layout.first + 1) * 100))% of days in the last \(layout.weeks.count) weeks")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            calendar(layout: layout, days: days, maximum: maximum)
            legend(days: days, maximum: maximum)
            if expanded, let day = focusedDay, day >= layout.first, day <= layout.last {
                dayDetails(day, data: days[day])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onChange(of: layout.first) { _, first in
            if expanded, let day = focusedDay, day < first || day > today { focusedDay = nil }
            if expanded, let week = visibleWeek.wrappedValue, week < layout.firstWeek || week > StatsDates.monday(today) {
                visibleWeek.wrappedValue = StatsDates.monday(today)
            }
        }
    }

    private func activeDays(_ count: Int) -> some View {
        Text("\(Text(StatsDisplay.number(Double(count))).font(.title3.weight(.semibold))) \(Text("active days").font(.caption).foregroundColor(.secondary))")
            .monospacedDigit().fixedSize(horizontal: true, vertical: true)
    }
    private func select(_ day: Int) {
        focusedDay = day
        if !expanded {
            visibleWeek.wrappedValue = StatsDates.monday(day)
            expand()
        }
    }

    private func calendar(layout: StatsCalendarLayout, days: [Int: StatsCalendarDay], maximum: Double) -> some View {
        let side = CGFloat(layout.cellSize)
        let header = typeSize.isAccessibilitySize ? max(32, side * 2) : CGFloat(32)
        let rowsHeight = side * 7 + 12
        return HStack(alignment: .top, spacing: 4) {
            VStack(spacing: 2) {
                ForEach(0..<7, id: \.self) { row in
                    Text(StatsDisplay.weekday(StatsDates.monday(today) + row))
                        .font(.caption2).foregroundStyle(.secondary)
                        .frame(width: weekdayWidth, height: side, alignment: .leading)
                }
            }
            .padding(.top, header + 4)
            .accessibilityHidden(true)
            if expanded {
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 2) {
                        ForEach(layout.weeks, id: \.self) { week in
                            weekColumn(week, layout: layout, days: days, maximum: maximum, header: header)
                                .id(week)
                        }
                    }
                    .scrollTargetLayout()
                    .padding(.horizontal, 4).padding(.vertical, 4)
                }
                .scrollPosition(id: visibleWeek, anchor: .leading)
                .defaultScrollAnchor(.trailing)
                .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                .frame(height: header + rowsHeight + 20)
                .accessibilityLabel("Activity calendar history")
                .accessibilityIdentifier("stats-calendar-history")
            } else {
                HStack(alignment: .top, spacing: 2) {
                    ForEach(layout.weeks, id: \.self) { week in
                        weekColumn(week, layout: layout, days: days, maximum: maximum, header: header)
                    }
                }
                .padding(4)
                .accessibilityIdentifier("stats-calendar-summary-grid")
            }
        }
    }

    private func weekColumn(_ week: Int, layout: StatsCalendarLayout, days: [Int: StatsCalendarDay], maximum: Double, header: CGFloat) -> some View {
        let side = CGFloat(layout.cellSize)
        let monthRow = (0..<7).first { row in
            layout.day(week: week, row: row).map { StatsDates.parts($0).day == 1 } ?? false
        }
        let firstDay = max(week, layout.first)
        let labelDay = monthRow.map { week + $0 } ?? firstDay
        let firstParts = StatsDates.parts(firstDay)
        let nextMonth = StatsDates.start(year: firstParts.year!, month: firstParts.month! + 1)
        let partialLabelFits = StatsDates.monday(nextMonth) - week >= 21
        let showMonth = monthRow != nil || (week == layout.firstWeek && partialLabelFits)
        let hasLabelRoom = expanded || week <= StatsDates.monday(layout.last) - 14
        let selectedRow = focusedDay.flatMap { day in (week..<week + 7).contains(day) && day >= layout.first && day <= layout.last ? day - week : nil }
        return VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                Color.clear.frame(width: side, height: header)
                if showMonth && hasLabelRoom {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(StatsDates.date(labelDay).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated)))
                        if expanded || StatsDates.parts(labelDay).month == 1 { Text(String(StatsDates.parts(labelDay).year!)) }
                    }
                    .font(.caption2).foregroundStyle(.secondary).fixedSize()
                    .accessibilityHidden(true)
                }
            }
            ZStack(alignment: .topLeading) {
                VStack(spacing: 2) {
                    ForEach(0..<7, id: \.self) { row in
                        if let day = layout.day(week: week, row: row) {
                            Button { select(day) } label: {
                                RoundedRectangle(cornerRadius: 2).fill(color(days[day], maximum: maximum))
                                    .overlay {
                                        if option == .sport, let data = days[day], data.mixed {
                                            stripes(data).clipShape(RoundedRectangle(cornerRadius: 2))
                                        }
                                    }
                                    .frame(width: side, height: side)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(dayDescription(day, data: days[day]))
                            .accessibilityAddTraits(day == focusedDay ? .isSelected : [])
                            .accessibilityIdentifier("stats-calendar-day-\(day)")
                        } else { Color.clear.frame(width: side, height: side).accessibilityHidden(true) }
                    }
                }
                if let monthRow {
                    StatsCalendarMonthBoundary(row: monthRow, cellSize: side)
                        .stroke(background, style: StrokeStyle(lineWidth: 6, lineCap: .square, lineJoin: .miter))
                        .frame(width: side, height: side * 7 + 12)
                        .allowsHitTesting(false).accessibilityHidden(true)
                }
                if let selectedRow {
                    RoundedRectangle(cornerRadius: 3).stroke(background, lineWidth: 4)
                        .overlay { RoundedRectangle(cornerRadius: 3).stroke(Color.primary, lineWidth: 2).padding(-2) }
                        .frame(width: side, height: side)
                        .offset(y: CGFloat(selectedRow) * (side + 2))
                        .allowsHitTesting(false).accessibilityHidden(true)
                }
            }
        }
        .frame(width: side, alignment: .leading)
        .zIndex(selectedRow != nil ? 1 : 0)
    }

    private func stripes(_ data: StatsCalendarDay) -> some View {
        Canvas { context, size in
            var path = Path()
            for x in stride(from: -size.height, through: size.width, by: 6) {
                path.move(to: CGPoint(x: x, y: size.height)); path.addLine(to: CGPoint(x: x + size.height, y: 0))
            }
            context.stroke(path, with: .color(data.secondSport?.color ?? .white.opacity(0.85)), lineWidth: 2.5)
        }
    }
    @ViewBuilder private func legend(days: [Int: StatsCalendarDay], maximum: Double) -> some View {
        if option == .sport {
            let categories = ActivityCategory.allCases.filter { sport in days.values.contains { $0.activities.contains { $0.sport == sport } } }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 260 : 106), alignment: .leading)], alignment: .leading, spacing: 5) {
                ForEach(categories) { category in
                    HStack(spacing: 4) { Rectangle().fill(category.color).frame(width: 8, height: 8); Text(category.name).font(.caption2) }
                        .accessibilityElement(children: .combine)
                }
            }
            if days.values.contains(where: \.mixed) { Text("Striped: multiple sports").font(.caption2).foregroundStyle(.secondary) }
        } else if let metric {
            HStack(spacing: 8) {
                Text("0")
                LinearGradient(colors: [emptyColor, heatColor], startPoint: .leading, endPoint: .trailing).frame(width: 64, height: 8)
                Text(StatsDisplay.measurement(maximum, metric: metric))
            }.font(.caption2).foregroundStyle(.secondary).accessibilityElement(children: .combine)
        }
    }
    private func color(_ data: StatsCalendarDay?, maximum: Double) -> Color {
        guard let data else { return emptyColor }
        guard let metric else { return data.dominantSport.color }
        return maximum > 0 ? heatColor.opacity(0.12 + 0.88 * data.totals[metric] / maximum) : emptyColor
    }
    private func dayDescription(_ day: Int, data: StatsCalendarDay?) -> String {
        let date = "\(StatsDisplay.weekday(day)), \(StatsDisplay.date(day))"
        guard let data else { return "\(date): No matching activities" }
        return "\(date): \(data.mixed ? "Multiple sports" : data.dominantSport.name), \(StatsDisplay.measurement(data.totals[metric ?? .time], metric: metric ?? .time))"
    }
    private func dayDetails(_ day: Int, data: StatsCalendarDay?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            HStack(alignment: .firstTextBaseline) {
                Text(StatsDisplay.date(day)).font(.subheadline.weight(.semibold))
                Spacer()
                Button("Close") { focusedDay = nil }.font(.caption).frame(minHeight: 44).accessibilityLabel("Close day details")
            }
            Text("Activities matching your current filters.").font(.caption).foregroundStyle(.secondary)
            if let data {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(data.activities.enumerated()), id: \.offset) { index, activity in
                        if index > 0 { Divider() }
                        StatsActivityRow(sport: activity.sport, name: activity.name,
                                         summary: "\(activity.sport.name) · \(StatsDisplay.measurement(activity.value(.distance), metric: .distance)) · \(StatsDisplay.measurement(activity.value(.elevation), metric: .elevation)) · \(StatsDisplay.measurement(activity.value(.time), metric: .time))",
                                         open: activity.id.map { id in { openActivity(id) } })
                            .background(activity.id != nil && activity.id == inspectedActivityID ? Color.accentColor.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 8))
                            .accessibilityIdentifier(activity.id.map { "stats-calendar-activity-\($0)" } ?? "")
                    }
                }
            } else { Text("No matching activities on this day.").font(.caption) }
        }
    }
}

/// Background-colour cutout follows the exact day where a month starts.
nonisolated private struct StatsCalendarMonthBoundary: Shape {
    let row: Int
    let cellSize: CGFloat
    func path(in rect: CGRect) -> Path {
        var path = Path()
        if row > 0 {
            let y = CGFloat(row) * (cellSize + 2) - 1
            path.move(to: CGPoint(x: rect.width + 1, y: 0))
            path.addLine(to: CGPoint(x: rect.width + 1, y: y))
            path.addLine(to: CGPoint(x: -1, y: y))
            path.addLine(to: CGPoint(x: -1, y: rect.height))
        } else {
            path.move(to: CGPoint(x: -1, y: 0)); path.addLine(to: CGPoint(x: -1, y: rect.height))
        }
        return path
    }
}

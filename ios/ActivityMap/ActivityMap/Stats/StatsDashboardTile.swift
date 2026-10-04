import SwiftUI

struct StatsDashboardTile: View {
    let tile: StatsTileDefinition
    @Binding var option: StatsToggleOption?
    let displayed: StatsDashboardFace?
    let today: Int
    let expanded: Bool
    let filtered: Bool
    let toggleExpansion: () -> Void
    var openActivity: (Int) -> Void = { _ in }

    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var colorScheme
    @State var volumeRange = StatsHistoryRange.weeks
    private var pilot: Bool { [StatsTileID.thisWeek, .weeklyVolume, .monthVsLastMonth, .yearToDate, .distanceVsElevation, .sportMix, .yearPace, .typicalWeek, .records, .activityCalendar].contains(tile.id) }
    private var displayedOption: StatsToggleOption? { displayed?.option ?? option }
    private var metric: StatsMetric { displayedOption.flatMap { StatsMetric(rawValue: $0.rawValue) } ?? .distance }
    private var year: Int { StatsDates.parts(today).year! }
    private var period: String {
        switch tile.id {
        case .thisWeek: "This week"
        case .weeklyVolume: expanded ? "Volume by sport" : "12-week trend"
        case .monthVsLastMonth: "\(comparisonLabels.current) vs \(comparisonLabels.previous)"
        case .yearToDate: "\(year.formatted(.number.grouping(.never))) vs \((year - 1).formatted(.number.grouping(.never)))"
        case .yearPace: "\(year.formatted(.number.grouping(.never))) projection"
        case .records: expanded ? "History & details" : String(year)
        case .activityCalendar: expanded ? "History & details" : "Last 12 months"
        case .sportMix: displayedOption == .allTime ? "All time by moving time" : "\(year.formatted(.number.grouping(.never))) by moving time"
        case .typicalWeek: "Average over 11 full weeks"
        default: "Last 12 months"
        }
    }

    private var comparisonLabels: (current: String, previous: String) {
        if tile.id == .yearToDate { return (String(year), String(year - 1)) }
        let month = StatsDates.parts(today).month!
        func name(_ month: Int) -> String {
            StatsDates.date(StatsDates.start(year: year, month: month))
                .formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated))
        }
        return (name(month), name(month - 1))
    }
    private var comparisonContext: String {
        if tile.id == .yearToDate {
            let date = StatsDates.date(today).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated).day())
            return "vs \(year - 1) by \(date)"
        }
        let date = StatsDates.parts(today)
        let previousLast = StatsDates.start(year: year, month: date.month!) - 1
        let elapsed = min(date.day!, StatsDates.parts(previousLast).day!)
        return "vs \(comparisonLabels.previous) 1–\(elapsed)"
    }

    var body: some View {
        StatsTileSurface(title: tile.title, period: period,
                         expand: StatsDashboard.expandable(tile.id) ? toggleExpansion : nil,
                         expanded: expanded, compactHeader: pilot) {
            controls
        } content: {
            if let displayed {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
                    face(displayed.result)
                }
                .overlay(alignment: .topTrailing) {
                    if displayed.option != option {
                        ProgressView().controlSize(.small)
                            .accessibilityLabel("Updating \(tile.title)")
                    }
                }
            }
            else { ProgressView("Calculating…").frame(minHeight: 120) }
        }
        .accessibilityIdentifier("stats-tile-\(tile.id.rawValue)")
        .zIndex(expanded ? 1 : 0)
    }

    @ViewBuilder private var controls: some View {
        if let toggle = tile.toggle {
            let metrics = toggle.options.compactMap { StatsMetric(rawValue: $0.rawValue) }
            if metrics.count == toggle.options.count {
                StatsMetricPicker(metrics: metrics, selection: Binding(
                    get: { option.flatMap { StatsMetric(rawValue: $0.rawValue) } ?? .distance },
                    set: { option = StatsToggleOption(rawValue: $0.rawValue) }
                ))
            } else {
                StatsRangePicker(title: "\(tile.title): \(toggle.label)", ranges: toggle.options,
                    selection: Binding(
                        get: { option ?? toggle.options[0] },
                        set: { option = $0 }
                    ), label: { value in
                        if let metric = StatsMetric(rawValue: value.rawValue) {
                            metric == .count ? "#" : metric.definition.unit
                        } else { StatsDisplay.option(value) }
                    }, accessibilityLabel: StatsDisplay.option)
                .frame(width: tile.id == .sportMix && !typeSize.isAccessibilitySize ? 176 : nil)
            }
        }
    }

    @ViewBuilder private func face(_ result: StatsDashboardResult) -> some View {
        switch result {
        case .week(let week):
            headline(week.current, metric: metric, suffix: " so far")
            comparison(.init(current: week.current, previous: week.typical), context: "vs typical by \(StatsDisplay.weekday(today))")
            StatsPeriodBars(points: week.days.enumerated().map {
                .init(x: StatsDates.monday(today) + $0.offset, value: $0.element, series: "This week", partial: StatsDates.monday(today) + $0.offset == today)
            }, expanded: false, label: { StatsDisplay.weekday($0.x) },
               detailLabel: { "\(StatsDisplay.weekday($0.x)), \(StatsDisplay.date($0.x))" },
               valueLabel: { StatsDisplay.measurement($0, metric: metric) },
               emphasis: .primary, base: Color.secondary.opacity(0.45))
        case .volume(let values, _, _, let averages, let buckets):
            StatsVolumeDetail(history: buckets, averages: averages, metric: metric, range: $volumeRange,
                              expanded: expanded) {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
                    headline(values.current, metric: metric, suffix: " · last 28 days")
                    comparison(values, context: "vs previous 28 days")
                }
            }
        case .comparison(let values, let current, let previous, let band):
            headline(values.current, metric: metric, suffix: " so far")
            comparison(values, context: comparisonContext)
            StatsSeriesChart(points: current.map { .init(x: $0.x, value: $0.y, series: comparisonLabels.current, partial: false) }
                + previous.map { .init(x: $0.x, value: $0.y, series: comparisonLabels.previous, partial: false) },
                metric: metric, expanded: expanded, axis: tile.id == .yearToDate ? .year : .day, style: .lines, compact: true, band: band)
        case .pace(let pace):
            headline(pace.projected, metric: metric, suffix: " projected")
            note("At this year's daily average")
            StatsProjectionSummary(pace: pace, metric: metric, year: year)
        case .records(let current, let allTime, let best30):
            StatsRecordsDetail(current: current, allTime: allTime, best30: best30, year: year, expanded: expanded, openActivity: openActivity)
        case .calendar(let rolling, let years):
            StatsCalendarDetail(rolling: rolling, years: years, today: today, option: displayedOption ?? .sport, expanded: expanded, openActivity: openActivity, expand: toggleExpansion)
        case .mix(let shares, let hours, let breakdown):
            if let top = shares.first {
                Text("\(Text("\(StatsDisplay.number(top.share * 100))%").font(AppTheme.Typography.metric)) \(Text(top.sport.name).font(.caption).foregroundColor(.secondary))").monospacedDigit().fixedSize(horizontal: false, vertical: true)
                note(shares.count == 1 ? "One sport represented; no mix to compare" : "of \(StatsDisplay.measurement(hours, metric: .time)) moving time")
                StatsSportMixVisual(shares: shares, breakdown: breakdown, expanded: expanded)
            } else { note("No moving time yet") }
        case .hilliness(let climb, let activities):
            headline(climb.current / 100, unit: "m / km", decimals: 1)
            comparison(.init(current: climb.current, previous: climb.previous), context: "vs the 12 months before", unitless: true)
            StatsPeriodBars(points: climb.months.enumerated().map { .init(x: $0.element.monthStart, value: $0.element.rate / 100, series: "m / km", partial: $0.offset == climb.months.count - 1) }, expanded: expanded,
                            label: { StatsDates.date($0.x).formatted(Date.FormatStyle(calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated)) },
                            detailLabel: { StatsDisplay.month($0.x) },
                            valueLabel: { "\(StatsDisplay.number($0, decimals: 1)) m / km" })
            StatsExpansionReveal(expanded: expanded) { hillinessActivities(activities) }
        case .typical(let week):
            headline(week.totals.time, unit: "h / week", decimals: 1)
            note("\(StatsDisplay.number(week.activeDays, decimals: 1)) active days / week")
            Divider()
            StatsSummaryValues(items: [
                .init(label: "Distance", value: StatsDisplay.measurement(week.totals.distance, metric: .distance)),
                .init(label: "Elevation", value: StatsDisplay.measurement(week.totals.elevation, metric: .elevation)),
                .init(label: "Activities", value: StatsDisplay.number(week.totals.count, decimals: 1)),
            ])
        case .unsupported: EmptyView()
        }
    }

    private func hillinessActivities(_ activities: [StatsHillPoint]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Hilliest activities (5 km or more)").font(.caption).foregroundStyle(.secondary).padding(.bottom, 8)
            if activities.isEmpty { note("No qualifying activities in the last 12 months.") }
            ForEach(Array(activities.enumerated()), id: \.offset) { _, point in
                if let id = point.activity.id {
                    Button { openActivity(id) } label: { hillinessRow(point, linked: true) }.buttonStyle(.plain)
                        .accessibilityIdentifier("stats-hilliness-activity-\(id)")
                } else { hillinessRow(point, linked: false) }
                Divider()
            }
        }
    }
    private func hillinessRow(_ point: StatsHillPoint, linked: Bool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            BrowseSportSymbol(category: point.activity.sport)
            VStack(alignment: .leading, spacing: 4) {
                Text(point.activity.name).font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                Text("\(StatsDisplay.date(point.activity.day)) · \(StatsDisplay.measurement(point.distance, metric: .distance)) · \(StatsDisplay.measurement(point.elevation, metric: .elevation)) climbed")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Text("\(StatsDisplay.number(point.metersPerKm, decimals: 1)) m / km").font(.caption).monospacedDigit()
            }.frame(maxWidth: .infinity, alignment: .leading)
            if linked { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary) }
        }.padding(.vertical, 12).frame(minHeight: 44).contentShape(Rectangle())
    }

    private func headline(_ value: Double, metric: StatsMetric, suffix: String = "") -> some View {
        headline(value, unit: (metric == .count ? "activities" : metric.definition.unit) + suffix,
                 decimals: metric == .time && abs(value) < 10 ? 1 : 0)
    }
    private func headline(_ value: Double, unit: String, decimals: Int = 0) -> some View {
        Group {
            if pilot {
                Text("\(Text(StatsDisplay.number(value, decimals: decimals)).font(tile.isPrimary ? AppTheme.Typography.statsHeadline : AppTheme.Typography.metric)) \(Text(unit).font(.caption).foregroundColor(.secondary))")
                    .monospacedDigit().fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Text(StatsDisplay.number(value, decimals: decimals))
                        .font(tile.isPrimary ? AppTheme.Typography.statsHeadline : AppTheme.Typography.metric)
                        .monospacedDigit()
                    Text(unit).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
    @ViewBuilder private func comparison(_ values: StatsPeriodComparison, context: String, unitless: Bool = false) -> some View {
        if let change = values.percentageChange {
            let delta = values.current - values.previous
            let percent = abs(change) < 0.5 && change != 0 ? "<1" : StatsDisplay.number(abs(change))
            let prefix = change >= 0 ? "+" : "−"
            let absolute = unitless ? "" : "\(delta >= 0 ? "+" : "−")\(StatsDisplay.measurement(abs(delta), metric: metric)) · "
            if pilot {
                // Increases are green; a decrease is not a failure, so it keeps the primary text colour.
                Text("\(Text("\(absolute)\(prefix)\(percent)%").foregroundColor(change > 0 && !unitless ? (colorScheme == .dark ? Color.green : Color(red: 0.08, green: 0.43, blue: 0.2)) : Color.primary)) \(Text(context).foregroundColor(.secondary))")
                    .font(.caption).fixedSize(horizontal: false, vertical: true)
            } else {
                StatsComparison(value: "\(absolute)\(prefix)\(percent)%", context: context,
                                direction: change == 0 ? .unchanged : change > 0 ? .higher : .lower)
            }
        } else { note(context) }
    }
    private func note(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }
    private func valueRow(_ label: String, _ value: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack { Text(label).foregroundStyle(.secondary); Spacer(); Text(value).monospacedDigit() }
            VStack(alignment: .leading, spacing: 4) { Text(label).foregroundStyle(.secondary); Text(value).monospacedDigit() }
        }
        .font(.subheadline).accessibilityElement(children: .combine)
    }
}

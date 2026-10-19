import SwiftUI

extension StatsDashboardTile {
    init(tile: StatsTileDefinition, store: ActivityStore, dashboard: StatsDashboardState,
         expanded: Bool, detailScreen: Bool = false,
         toggleExpansion: @escaping () -> Void, openActivity: @escaping (Int) -> Void) {
        let source = StatsDashboardSource(store)
        self.init(tile: tile, option: Binding(get: { dashboard.option(tile.id) },
                  set: { if let value = $0 { dashboard.select(value, for: tile) } }),
                  displayed: dashboard.face(tile.id, source: source), today: source.today,
                  expanded: expanded, filtered: store.activeStatsFilterCount > 0,
                  toggleExpansion: toggleExpansion, openActivity: openActivity,
                  detailScreen: detailScreen,
                  inspection: dashboard.inspection(tile.id))
    }
}

struct StatsDashboardTile: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    @Environment(\.locale) private var locale
    let tile: StatsTileDefinition
    @Binding var option: StatsToggleOption?
    let displayed: StatsDashboardFace?
    let today: Int
    let expanded: Bool
    let filtered: Bool
    let toggleExpansion: () -> Void
    var openActivity: (Int) -> Void = { _ in }
    var detailScreen = false
    var inspection: StatsTileInspection? = nil

    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.statsAvailableWidth) private var availableWidth
    @Environment(\.statsInspectedActivityID) private var inspectedActivityID
    @State private var contentWidth: CGFloat = 0
    @State var volumeRange = StatsHistoryRange.weeks
    private var selectedVolumeRange: Binding<StatsHistoryRange> {
        if let inspection {
            return Binding(get: { inspection.volumeRange }, set: { inspection.volumeRange = $0 })
        }
        return $volumeRange
    }
    private var pilot: Bool { [StatsTileID.thisWeek, .weeklyVolume, .monthVsLastMonth, .yearToDate, .distanceVsElevation, .sportMix, .yearPace, .typicalWeek, .records, .activityCalendar].contains(tile.id) }
    private var displayedOption: StatsToggleOption? { displayed?.option ?? option }
    private var metric: StatsMetric { displayedOption.flatMap { StatsMetric(rawValue: $0.rawValue) } ?? .distance }
    private var year: Int { StatsDates.parts(today).year! }
    private var headlineControls: Bool {
        !expanded && [.weeklyVolume, .monthVsLastMonth, .yearToDate, .yearPace].contains(tile.id)
    }
    private var period: String {
        switch tile.id {
        // The title already says "This week"; name its dates instead.
        case .thisWeek: "\(StatsDisplay.shortDate(StatsDates.monday(today), locale: locale)) – \(StatsDisplay.shortDate(StatsDates.monday(today) + 6, locale: locale))"
        case .weeklyVolume: expanded ? "Volume by sport" : "Last 28 days · 12-week trend"
        case .monthVsLastMonth: expanded ? "\(comparisonLabels.current) vs \(comparisonLabels.previous)" : "\(comparisonLabels.current) so far · vs \(comparisonLabels.previous)"
        case .yearToDate: expanded ? "\(year.formatted(.number.grouping(.never).locale(locale))) vs \((year - 1).formatted(.number.grouping(.never).locale(locale)))" : "\(year.formatted(.number.grouping(.never).locale(locale))) so far · vs \((year - 1).formatted(.number.grouping(.never).locale(locale)))"
        case .yearPace: "\(year.formatted(.number.grouping(.never).locale(locale))) projection"
        case .records: expanded ? "Personal bests" : "This year"
        case .activityCalendar: ""
        case .sportMix: !expanded ? "Moving time" : displayedOption == .allTime ? "All time by moving time" : "\(year.formatted(.number.grouping(.never).locale(locale))) by moving time"
        case .typicalWeek: "Per week · last 11 full weeks"
        default: "Last 12 months"
        }
    }

    private var comparisonPeriods: StatsComparisonPeriods {
        if let displayed, case .comparison(let values, _, _, _, _, _) = displayed.result, let periods = values.periods { return periods }
        return .make(today: today, monthly: tile.id != .yearToDate)
    }
    private var comparisonLabels: (current: String, previous: String) {
        let periods = comparisonPeriods
        if tile.id == .yearToDate {
            return (String(StatsDates.parts(periods.current.first).year!), String(StatsDates.parts(periods.previous.first).year!))
        }
        func name(_ day: Int) -> String {
            StatsDates.date(day).formatted(Date.FormatStyle(locale: locale, calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated))
        }
        return (name(periods.current.first), name(periods.previous.first))
    }
    private var comparisonContext: String {
        let previous = comparisonPeriods.previous
        if tile.id == .yearToDate { return "vs \(comparisonLabels.previous) by \(StatsDisplay.shortDate(previous.last, locale: locale))" }
        return "vs \(comparisonLabels.previous) 1–\(StatsDates.parts(previous.last).day!)"
    }

    var body: some View {
        StatsTileSurface(title: tile.title, titleResource: tile.id.titleResource(locale: locale), period: period,
                         expand: StatsDashboard.expandable(tile.id) && !(tile.id == .sportMix && availableWidth >= 760 && !expanded) ? toggleExpansion : nil,
                         expanded: expanded, compactHeader: pilot, detailScreen: detailScreen,
                         controlsInContent: tile.id == .activityCalendar && !expanded) {
            if !headlineControls || displayed == nil { controls }
        } content: {
            if let displayed {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
                    face(displayed.result)
                }
                .overlay(alignment: .topTrailing) {
                    if displayed.option != option {
                        ProgressView().controlSize(.small)
                            .accessibilityLabel("Updating \(tile.title)")
                            // A compact picker now occupies the headline row.
                            // Keep refresh feedback above it, beside the period.
                            .alignmentGuide(.top) { dimensions in
                                headlineControls ? dimensions[.bottom] + AppTheme.Spacing.medium : dimensions[.top]
                            }
                            .allowsHitTesting(false)
                    }
                }
            }
            else { ProgressView("Calculating…").frame(minHeight: 120) }
        }
        .environment(\.statsTileInspection, inspection)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
        .accessibilityIdentifier("stats-tile-\(tile.id.rawValue)")
        .zIndex(expanded ? 1 : 0)
    }

    @ViewBuilder private var controls: some View {
        if let toggle = tile.toggle {
            let metrics = toggle.options.compactMap { StatsMetric(rawValue: $0.rawValue) }
            if metrics.count == toggle.options.count {
                StatsMetricPicker(title: "\(tile.title): \(toggle.label)", metrics: metrics, selection: Binding(
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
                            metric == .count ? "#" : metric.displayUnit(units: units)
                        } else { StatsDisplay.option(value) }
                    }, accessibilityLabel: StatsDisplay.option)
            }
        }
    }

    @ViewBuilder private func face(_ result: StatsDashboardResult) -> some View {
        switch result {
        case .week(let week):
            headline(week.current, metric: metric, suffix: " so far")
            comparison(.init(current: week.current, previous: week.typical),
                       context: today == StatsDates.monday(today) ? "vs a typical Monday" : "vs typical Mon–\(StatsDisplay.weekday(today, locale: locale))")
            StatsPeriodBars(points: week.days.enumerated().map {
                .init(x: StatsDates.monday(today) + $0.offset, value: $0.element, series: "This week", partial: StatsDates.monday(today) + $0.offset == today)
            }, expanded: false, label: { StatsDisplay.weekday($0.x, locale: locale) },
               detailLabel: { "\(StatsDisplay.weekday($0.x, locale: locale)), \(StatsDisplay.date($0.x, locale: locale, dateFormat: preferences?.dateFormat ?? .system))" },
               valueLabel: { StatsDisplay.measurement($0, metric: metric, units: units, locale: locale) },
               axisValue: { metric.displayValue($0, units: units) },
               // Today is still the emphasised bar of the week.
               base: Color.secondary.opacity(0.45), partial: .primary)
        case .volume(let values, _, _, let averages, let buckets):
            StatsVolumeDetail(history: buckets, averages: averages, metric: metric, range: selectedVolumeRange,
                              expanded: expanded) {
                VStack(alignment: .leading, spacing: AppTheme.Spacing.medium) {
                    headline(values.current, metric: metric, suffix: " · last 28 days")
                    comparison(values, context: "vs previous 28 days")
                }
            }
        case .comparison(let values, let current, let previous, let band, let rhythm, let history):
            headline(values.current, metric: metric, suffix: " so far")
            comparison(values, context: comparisonContext)
            // Always the same chart; rhythm and history reveal on the card's
            // own progress instead of appearing whole when `expanded` flips.
            StatsPeriodDetail(rhythm: rhythm, history: history, metric: metric, today: today,
                              expanded: expanded, openActivity: openActivity) {
                comparisonChart(current: current, previous: previous, band: band)
            }
        case .pace(let pace):
            headline(pace.projected, metric: metric, suffix: " projected")
            note("At this year's daily average")
            StatsProjectionSummary(pace: pace, metric: metric, year: year)
        case .records(let current, let allTime, let best30):
            StatsRecordsDetail(current: current, allTime: allTime, best30: best30, year: year, expanded: expanded, filtered: filtered, openActivity: openActivity)
        case .calendar(let rolling, let years):
            StatsCalendarDetail(rolling: rolling, years: years, today: today, option: displayedOption ?? .sport,
                expanded: expanded, openActivity: openActivity, expand: toggleExpansion,
                summaryControls: expanded ? nil : AnyView(controls),
                background: detailScreen ? AppTheme.contentBackground : AppTheme.surface)
        case .mix(let shares, let hours, let breakdown):
            if let top = shares.first {
                Text("\(Text("\(StatsDisplay.number(top.share * 100, locale: locale))%").font(AppTheme.Typography.metric)) \(Text(top.sport.name).font(.caption).foregroundColor(.secondary))").monospacedDigit().fixedSize(horizontal: false, vertical: true)
                note(shares.count == 1 ? "One sport represented; no mix to compare" : "of \(StatsDisplay.measurement(hours, metric: .time, units: units, locale: locale)) moving time")
                if availableWidth >= 760 {
                    StatsSportMixVisual(shares: shares, breakdown: breakdown, expanded: true)
                        .environment(\.statsExpansionProgress, 1)
                } else {
                    StatsSportMixVisual(shares: shares, breakdown: breakdown, expanded: expanded)
                }
            } else { note("No moving time yet") }
        case .hilliness(let climb, let activities):
            headline(units.hilliness(climb.current / 100), unit: units.hillinessUnit, decimals: 1)
            comparison(.init(current: climb.current, previous: climb.previous), context: "vs the 12 months before", unitless: true)
            if expanded && contentWidth >= 1000 && !typeSize.isAccessibilitySize {
                HStack(alignment: .top, spacing: 24) {
                    hillinessChart(climb)
                        .frame(maxWidth: .infinity)
                    hillinessActivities(activities).frame(maxWidth: .infinity)
                }
            } else {
                hillinessChart(climb)
                StatsExpansionReveal(expanded: expanded) { hillinessActivities(activities) }
            }
        case .typical(let week):
            headline(week.totals.time, unit: "h / week", decimals: 1)
            note("\(StatsDisplay.number(week.activeDays, decimals: 1, locale: locale)) active days / week")
            Divider()
            StatsSummaryValues(items: [
                .init(label: "Distance", value: StatsDisplay.measurement(week.totals.distance, metric: .distance, units: units, locale: locale)),
                .init(label: "Elevation", value: StatsDisplay.measurement(week.totals.elevation, metric: .elevation, units: units, locale: locale)),
                .init(label: "Activities", value: StatsDisplay.number(week.totals.count, decimals: 1, locale: locale)),
            ])
        case .unsupported: EmptyView()
        }
    }

    private func comparisonChart(current: [StatsPoint], previous: [StatsPoint], band: StatsComparisonBand?) -> some View {
        StatsSeriesChart(points: current.map { .init(x: $0.x, value: $0.y, series: comparisonLabels.current, partial: false, role: .current) }
                + previous.map { .init(x: $0.x, value: $0.y, series: comparisonLabels.previous, partial: false, role: .comparison) },
                metric: metric, expanded: expanded, axis: tile.id == .yearToDate ? .year : .day, style: .lines, compact: true, band: band)
    }

    private func hillinessChart(_ climb: StatsClimbing) -> some View {
        StatsPeriodBars(points: climb.months.enumerated().map { .init(x: $0.element.monthStart, value: $0.element.rate / 100, series: units.hillinessUnit, partial: $0.offset == climb.months.count - 1, role: .hilliness) }, expanded: expanded,
                            label: { StatsDates.date($0.x).formatted(Date.FormatStyle(locale: locale, calendar: StatsDates.calendar, timeZone: .gmt).month(.abbreviated)) },
                            detailLabel: { StatsDisplay.month($0.x, locale: locale) },
                            valueLabel: { "\(StatsDisplay.number(units.hilliness($0), decimals: 1, locale: locale)) \(units.hillinessUnit)" },
                            axisValue: { units.hilliness($0) })
    }

    private func hillinessActivities(_ activities: [StatsHillPoint]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Hilliest activities (\(Formatters.distance(5000, locale: locale, units: units)) or more)").font(.caption).foregroundStyle(.secondary).padding(.bottom, 8)
            if activities.isEmpty { note("No qualifying activities in the last 12 months.") }
            ForEach(Array(activities.enumerated()), id: \.offset) { _, point in
                StatsActivityRow(sport: point.activity.sport, name: point.activity.name,
                                 summary: "\(StatsDisplay.date(point.activity.day, locale: locale, dateFormat: preferences?.dateFormat ?? .system)) · \(StatsDisplay.measurement(point.distance, metric: .distance, units: units, locale: locale)) · \(StatsDisplay.measurement(point.elevation, metric: .elevation, units: units, locale: locale)) climbed",
                                 detail: "\(StatsDisplay.number(units.hilliness(point.metersPerKm), decimals: 1, locale: locale)) \(units.hillinessUnit)",
                                 open: point.activity.id.map { id in { openActivity(id) } })
                    .background(point.activity.id != nil && point.activity.id == inspectedActivityID ? Color.accentColor.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 8))
                    .accessibilityIdentifier(point.activity.id.map { "stats-hilliness-activity-\($0)" } ?? "")
                Divider()
            }
        }
    }

    private func headline(_ value: Double, metric: StatsMetric, suffix: String = "") -> some View {
        headline(metric.displayValue(value, units: units), unit: (metric == .count ? "activities" : metric.displayUnit(units: units)) + (headlineControls ? "" : suffix),
                 decimals: metric == .time && abs(value) < 10 ? 1 : 0)
    }
    private func headline(_ value: Double, unit: String, decimals: Int = 0) -> some View {
        Group {
            if headlineControls {
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 4) {
                        headlineValue(value, unit: unit, decimals: decimals)
                        controls
                    }
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) {
                            headlineValue(value, unit: unit, decimals: decimals).fixedSize()
                            Spacer(minLength: 0)
                            controls.fixedSize()
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            headlineValue(value, unit: unit, decimals: decimals)
                            controls
                        }
                    }
                }
            } else {
                headlineValue(value, unit: unit, decimals: decimals)
            }
        }
    }
    private func headlineValue(_ value: Double, unit: String, decimals: Int = 0) -> some View {
        Group {
            if pilot {
                Text("\(Text(StatsDisplay.number(value, decimals: decimals, locale: locale)).font(tile.isPrimary ? AppTheme.Typography.statsHeadline : AppTheme.Typography.metric)) \(Text(unit).font(.caption).foregroundColor(.secondary))")
                    .monospacedDigit().fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Text(StatsDisplay.number(value, decimals: decimals, locale: locale))
                        .font(tile.isPrimary ? AppTheme.Typography.statsHeadline : AppTheme.Typography.metric)
                        .monospacedDigit()
                    Text(unit).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
    @ViewBuilder private func comparison(_ values: StatsPeriodComparison, context: String, unitless: Bool = false) -> some View {
        let presentation = StatsComparisonPresentation(current: values.current, previous: values.previous)
        if let percent = presentation.percentage() {
            let delta = values.current - values.previous
            let absolute = unitless ? "" : "\(delta == 0 ? "" : delta > 0 ? "+" : "−")\(StatsDisplay.measurement(abs(delta), metric: metric, units: units, locale: locale)) · "
            StatsComparison(value: "\(absolute)\(percent)", context: context,
                            direction: presentation.direction == .unchanged ? .unchanged : presentation.direction == .higher ? .higher : .lower,
                            emphasisesIncrease: !unitless)
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

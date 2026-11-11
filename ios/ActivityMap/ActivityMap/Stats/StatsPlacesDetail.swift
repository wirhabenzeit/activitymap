import SwiftUI

/// Most visited places: this year's top five on the card; the focus page adds
/// All time and the bounded ranking. Rows open the shared place detail.
struct StatsPlacesDetail: View {
    let current: StatsPlaceRanking
    let allTime: StatsPlaceRanking
    let kind: ActivityMapAPI.PlaceKind
    let year: Int
    let expanded: Bool
    let historyComplete: Bool
    let openPlace: (String) -> Void
    @Environment(\.statsTileInspection) private var inspection
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.locale) private var locale
    @State private var localRange = StatsToggleOption.currentYear
    @ScaledMetric(relativeTo: .subheadline) private var glyphSize = 16.0

    private var units: UnitSystem { preferences?.units ?? .metric }
    private var range: Binding<StatsToggleOption> {
        if let inspection {
            return Binding(get: { inspection.placesRange }, set: { inspection.placesRange = $0 })
        }
        return $localRange
    }
    private var allTimeShown: Bool { expanded && range.wrappedValue == .allTime }
    private var ranking: StatsPlaceRanking { allTimeShown ? allTime : current }
    private var shown: [StatsPlaceRanking.Row] {
        Array(ranking.rows.prefix(expanded ? StatsPlaceRanking.limit : StatsPlaceRanking.compactLimit))
    }
    private var plural: String { kind == .peak ? "peaks" : kind == .pass ? "passes" : "huts" }

    /// Hut matches describe the route passing nearby, never entry or a stay.
    static func explanation(_ kind: ActivityMapAPI.PlaceKind) -> String {
        kind == .hut
            ? "Counts activities whose route passed near each hut, once per activity. A match does not mean you stopped or stayed there."
            : "Counts activities whose route passed each \(kind.rawValue), once per activity; passing it several times on one route still counts once."
    }

    /// A ranking with rows needs no caveat. An empty one only claims "no
    /// places" once every activity in the window has a completed check.
    static func coverageNote(_ ranking: StatsPlaceRanking, plural: String, allTime: Bool, historyComplete: Bool) -> String? {
        let period = allTime ? "" : " this year"
        if ranking.activities == 0 { return historyComplete ? "No activities\(period)." : "Activity history is still loading." }
        if ranking.total > 0 { return nil }
        return ranking.exhaustive(historyComplete: historyComplete) ? "No \(plural) on your routes\(period)." : "No \(plural) found yet."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.Spacing.small) {
            if expanded {
                StatsRangePicker(title: "Most visited places period", ranges: [.currentYear, .allTime],
                                 selection: range, label: StatsDisplay.option)
                Text(Self.explanation(kind)).font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let note = Self.coverageNote(ranking, plural: plural, allTime: allTimeShown, historyComplete: historyComplete) {
                Text(note).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("stats-places-coverage")
            }
            VStack(spacing: 0) {
                ForEach(shown) { row in
                    rowButton(row)
                    if expanded && row.id != shown.last?.id { Divider() }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Most visited \(plural) · \(allTimeShown ? "All time" : String(year))")
            .accessibilityHint(expanded ? "" : Self.explanation(kind))
            if ranking.total > shown.count {
                Text(expanded ? "Showing the top \(shown.count) of \(ranking.total) \(plural)." : "Top \(shown.count) of \(ranking.total) \(plural)")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("stats-places-ranking")
    }

    private func elevation(_ place: LibraryPlace) -> String? {
        place.place.elevationM.map { "\(Int(($0 / units.elevationScale).rounded()).formatted(.number.locale(locale))) \(units.elevationUnit)" }
    }

    private func rowButton(_ row: StatsPlaceRanking.Row) -> some View {
        let place = row.place
        let count = "\(place.activityCount) \(place.activityCount == 1 ? "activity" : "activities")"
        let elevation = elevation(place)
        let latest = StatsDisplay.date(StatsDates.day(place.latestVisit), locale: locale,
                                       dateFormat: preferences?.dateFormat ?? .system)
        return Button { openPlace(place.id) } label: {
            HStack(alignment: typeSize.isAccessibilitySize ? .top : .center, spacing: 8) {
                Text(String(row.rank)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    .frame(minWidth: 18, alignment: .trailing)
                PlaceGlyph(kind: kind).frame(width: glyphSize, height: glyphSize)
                VStack(alignment: .leading, spacing: 2) {
                    Text(place.place.name).font(.subheadline)
                        .lineLimit(expanded ? nil : 2).fixedSize(horizontal: false, vertical: true)
                    // Large text and the focus page move details below the name.
                    if expanded || typeSize.isAccessibilitySize {
                        Text(([typeSize.isAccessibilitySize ? count : nil, elevation, expanded ? "Latest \(latest)" : nil] as [String?])
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if !typeSize.isAccessibilitySize {
                    if !expanded, let elevation {
                        Text(elevation).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                    Text("\(Text(String(place.activityCount)).font(.subheadline.weight(.semibold))) \(Text(expanded ? (place.activityCount == 1 ? "activity" : "activities") : "").font(.caption).foregroundColor(.secondary))")
                        .monospacedDigit()
                }
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.vertical, expanded ? 6 : 0)
            .frame(minHeight: AppTheme.minimumTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(row.rank). \(place.place.name)\(elevation.map { ", \($0)" } ?? ""), \(count)")
        .accessibilityHint("View place details")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("stats-place-\(place.id)")
    }
}

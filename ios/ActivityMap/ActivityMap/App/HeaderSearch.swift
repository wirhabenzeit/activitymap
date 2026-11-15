import SwiftUI

// Header search: the browsing header turns into a find field. On Map and
// Stats a results panel drops below it; on List the rows narrow instead.
// Picking a result selects routes, like tapping them on the map; only the
// panel's last row (or the keyboard's Search key) changes the text filter.

/// The header copies render from different places (shell bar, List root), so
/// each slot observes this state directly rather than a captured value.
///
/// Search is transient: acting on a result, applying a filter or leaving the
/// tab ends it. Looking at results within the List (a pushed detail and Back,
/// selecting rows) keeps it, without bringing the keyboard back.
@Observable final class HeaderSearch {
    private(set) var isActive = false
    var query = ""
    /// Bumped by the keyboard's Search key.
    var submitCount = 0
    /// Only starting a search focuses the field; returning from a List detail
    /// does not. Every header copy may claim it while search opens.
    private(set) var focusesOnAppear = false
    var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    func begin() {
        focusesOnAppear = true
        withAnimation(.smooth(duration: 0.35)) { isActive = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.focusesOnAppear = false }
    }
    func end() {
        // Clear after the fade, so the typed text doesn't flash to the placeholder.
        withAnimation(.smooth(duration: 0.3)) { isActive = false } completion: { self.query = "" }
    }
}

extension EnvironmentValues {
    /// Lets List narrow its rows while header search is open.
    @Entry var headerSearch: HeaderSearch? = nil
}

enum HeaderSearchTransition {
    /// Outgoing header controls clear quickly; incoming ones wait for them, so
    /// the two never overlap mid-swap.
    static let swapOut = AnyTransition.asymmetric(
        insertion: .opacity.animation(.easeOut(duration: 0.18).delay(0.1)),
        removal: .opacity.animation(.easeIn(duration: 0.08)))
    static func swapIn(anchor: UnitPoint) -> AnyTransition {
        .asymmetric(insertion: .opacity.animation(.easeOut(duration: 0.18).delay(0.06))
                        .combined(with: .scale(scale: 0.88, anchor: anchor)),
                    removal: .opacity.animation(.easeIn(duration: 0.08)))
    }
}

/// One header slot: its resting controls, or its part of the search field.
struct HeaderSearchSlot<Idle: View, Active: View>: View {
    let search: HeaderSearch
    @ViewBuilder let idle: () -> Idle
    @ViewBuilder let active: () -> Active
    var body: some View {
        ZStack { if search.isActive { active() } else { idle() } }
    }
}

struct HeaderSearchField: View {
    @Bindable var search: HeaderSearch
    @FocusState private var focused: Bool
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.8))
            TextField("", text: $search.query, prompt: Text("Find activities or places").foregroundStyle(.white.opacity(0.6)))
                .focused($focused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { search.submitCount += 1 }
                .foregroundStyle(.white)
                .tint(.white)
            if !search.query.isEmpty {
                Button { search.query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.white.opacity(0.7)) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search text")
            }
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: 560, minHeight: 36)
        .background(.white.opacity(0.18), in: Capsule())
        // Grows out of the search button beside Filters.
        .transition(HeaderSearchTransition.swapIn(anchor: .leading))
        .task { if search.focusesOnAppear { focused = true } }
        .accessibilityIdentifier("header-search-field")
    }
}

struct HeaderSearchClose: View {
    let search: HeaderSearch
    var body: some View {
        Button { search.end() } label: {
            Image(systemName: "xmark")
                .font(.subheadline.weight(.bold))
                .frame(width: 36, height: 36)
                .background(.white.opacity(0.18), in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .transition(HeaderSearchTransition.swapIn(anchor: .center))
        .accessibilityLabel("Close search")
        .accessibilityIdentifier("header-search-close")
    }
}

/// Matches an activity's name or the name of a place it visited: the same
/// rule as the text filter (`ActivityStore.TextQuery`).
enum ActivityTextSearch {
    @MainActor static func activities(in activities: [Activity], query: String) -> [Activity] {
        let text = ActivityStore.TextQuery(query)
        guard !text.isEmpty else { return activities }
        return activities.filter { text.matches($0) }
    }

    /// The visited place that matched, when the name itself didn't.
    @MainActor static func viaPlace(_ activity: Activity, query: String) -> String? {
        let text = ActivityStore.TextQuery(query)
        guard !text.isEmpty, !text.matchesName(activity) else { return nil }
        return PlaceLibrary.effectivePlaces(activity).first { PlaceLibrary.normalizedSearch($0.name).contains(text.place) }?.name
    }
}

/// The panel under the header on Map and Stats.
struct HeaderSearchResults: View {
    @Bindable var store: ActivityStore
    let query: String
    let onDone: () -> Void
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    @Environment(\.locale) private var locale
    private var units: UnitSystem { preferences?.units ?? .metric }
    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        if !trimmed.isEmpty {
            let activities = ActivityTextSearch.activities(in: store.activities, query: trimmed)
                .sorted { $0.startDate > $1.startDate }
            let placeResult = store.placeLibrary.search(trimmed, limit: 3)
            let content = VStack(alignment: .leading, spacing: 0) {
                if !activities.isEmpty {
                    header("Activities", count: activities.count)
                    ForEach(Array(activities.prefix(4))) { activityRow($0) }
                }
                if !placeResult.places.isEmpty {
                    header("Places", count: placeResult.total)
                    ForEach(placeResult.places) { placeRow($0) }
                }
                if activities.isEmpty && placeResult.places.isEmpty {
                    Text("No activities or places match “\(trimmed)”")
                        .font(.subheadline).foregroundStyle(AppTheme.secondaryText)
                        .frame(maxWidth: .infinity, minHeight: 56)
                }
                filterRow(hasMatches: !activities.isEmpty)
            }
            .padding(.vertical, 4)
            ViewThatFits(in: .vertical) {
                content
                ScrollView { content }.scrollBounceBehavior(.basedOnSize)
            }
            .frame(maxWidth: 520)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.primary.opacity(0.08)))
            .shadow(color: .black.opacity(0.18), radius: 16, y: 6)
            .padding(.horizontal, 10)
            .padding(.bottom, 10)
        }
    }

    private func header(_ title: String, count: Int) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.footnote.weight(.semibold)).foregroundStyle(AppTheme.secondaryText)
            Spacer()
            Text("\(count)").font(.footnote).monospacedDigit().foregroundStyle(AppTheme.secondaryText)
        }
        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 2)
        .accessibilityAddTraits(.isHeader)
    }

    /// The match in bold, so a short query reads at a glance in long names.
    /// Activity names match keeping accents, place names ignoring them.
    private func highlighted(_ name: String, ignoringAccents: Bool = false) -> Text {
        guard let range = name.range(of: trimmed, options: ignoringAccents ? [.caseInsensitive, .diacriticInsensitive] : [.caseInsensitive])
        else { return Text(verbatim: name) }
        let before = Text(verbatim: String(name[..<range.lowerBound]))
        let match = Text(verbatim: String(name[range])).fontWeight(.bold).foregroundStyle(AppTheme.accent)
        let after = Text(verbatim: String(name[range.upperBound...]))
        return Text("\(before)\(match)\(after)")
    }

    private func activityRow(_ activity: Activity) -> some View {
        Button { store.selectFromSearch([activity.id]); onDone() } label: {
            HStack(spacing: 10) {
                BrowseSportSymbol(category: activity.category)
                VStack(alignment: .leading, spacing: 2) {
                    highlighted(activity.name).font(.subheadline.weight(.medium)).lineLimit(1)
                    Text(activitySubtitle(activity))
                        .font(.caption).foregroundStyle(AppTheme.secondaryText).lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Formatters.distance(activity.distance, locale: locale, units: units))
                        .font(.caption.weight(.medium)).monospacedDigit()
                    if let gain = activity.totalElevationGain, gain >= 1 {
                        Text("↑ \(Formatters.elevation(gain, locale: locale, units: units))")
                            .font(.caption2).monospacedDigit().foregroundStyle(AppTheme.secondaryText)
                    }
                }
                .fixedSize()
            }
            .padding(.horizontal, 12).padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(store.visibleActivityIDs.contains(activity.id) ? 1 : 0.55)
        .accessibilityIdentifier("header-search-activity-\(activity.id)")
    }

    private func placeRow(_ item: LibraryPlace) -> some View {
        Button { store.selectFromSearch(item.activityIDs, place: item); onDone() } label: {
            HStack(spacing: 10) {
                PlaceGlyph(kind: item.place.kind).fill(Color.primary)
                    .frame(width: 20, height: 20)
                    .frame(width: 34, height: 34)
                    .background(Color.primary.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    highlighted(item.place.name, ignoringAccents: true).font(.subheadline.weight(.medium)).lineLimit(1)
                    Text(([item.kindLabel] + (item.place.elevationM.map { [Formatters.elevation($0, locale: locale, units: units)] } ?? [])).joined(separator: " · "))
                        .font(.caption).foregroundStyle(AppTheme.secondaryText).lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(item.activityCount) \(item.activityCount == 1 ? "visit" : "visits")")
                        .font(.caption.weight(.medium)).monospacedDigit()
                    Text(verbatim: "\(item.activityCount == 1 ? "" : "last ")\(Self.gmtYear(item.latestVisit))")
                        .font(.caption2).monospacedDigit().foregroundStyle(AppTheme.secondaryText)
                }
                .fixedSize()
            }
            .padding(.horizontal, 12).padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button { store.choosePlace(item); onDone() } label: { Label("Filter to this place", systemImage: "line.3.horizontal.decrease") }
        }
        .accessibilityIdentifier("header-search-place-\(item.id)")
    }

    /// Visit dates are local wall-clock times stored as GMT.
    private static func gmtYear(_ date: Date) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar.component(.year, from: date)
    }

    private func activitySubtitle(_ activity: Activity) -> String {
        var parts = [activity.sportType.editingTitle,
                     Formatters.shortDate(activity.startDateLocal, timeZone: .gmt, locale: locale, dateFormat: preferences?.dateFormat ?? .system)]
        if let place = ActivityTextSearch.viaPlace(activity, query: trimmed) { parts.append("via \(place)") }
        if !store.visibleActivityIDs.contains(activity.id) { parts.append("hidden by filters") }
        return parts.joined(separator: " · ")
    }

    /// The lasting actions: the typed text becomes the text filter (names and
    /// visited places), counted with the other filters so the number holds once
    /// applied; an existing text filter can be cleared from here too.
    @ViewBuilder private func filterRow(hasMatches: Bool) -> some View {
        let current = store.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let replaces = hasMatches && ActivityStore.normalizedSearch(current) != ActivityStore.normalizedSearch(trimmed)
        if replaces || !current.isEmpty {
            HStack(spacing: 8) {
                if replaces {
                    let count = store.countWithTextFilter(trimmed, includeDate: store.selectedTab != .stats)
                    Button { store.applyTextFilter(trimmed); onDone() } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "line.3.horizontal.decrease").frame(width: 34)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Filter to “\(trimmed)”").lineLimit(1)
                                Text("\(count) \(count == 1 ? "activity" : "activities")\(current.isEmpty ? "" : " · replaces “\(current)”")")
                                    .font(.caption).foregroundStyle(AppTheme.secondaryText).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(AppTheme.accent)
                    .accessibilityIdentifier("header-search-apply-filter")
                } else {
                    Image(systemName: "line.3.horizontal.decrease").frame(width: 34).foregroundStyle(AppTheme.secondaryText)
                    Text("Filtered to “\(current)”").foregroundStyle(AppTheme.secondaryText).lineLimit(1)
                    Spacer(minLength: 0)
                }
                if !current.isEmpty {
                    Button { store.clearTextFilter(); onDone() } label: {
                        HStack(spacing: 4) {
                            Text(replaces ? "Clear" : "Clear filter")
                            Image(systemName: "xmark").font(.caption.weight(.semibold))
                        }
                        .padding(.horizontal, 12).frame(minHeight: 32)
                        .background(AppTheme.accent.opacity(0.12), in: Capsule())
                        .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(AppTheme.accent)
                    .accessibilityLabel("Clear text filter “\(current)”")
                    .accessibilityIdentifier("header-search-clear-filter")
                }
            }
            .font(.subheadline)
            .padding(.horizontal, 12)
            .padding(.top, 4)
            .overlay(alignment: .top) { Rectangle().fill(Color.primary.opacity(0.08)).frame(height: 1).padding(.leading, 56) }
        }
    }
}

extension ActivityStore {
    /// Search selects, like tapping routes on the map: the results sheet
    /// lists them and the map fits them. Filters are left alone; only
    /// routes the filters show can be selected. A place also gets its pin.
    func selectFromSearch(_ ids: some Sequence<Int>, place: LibraryPlace? = nil) {
        mapContext.highlightedPlaceID = place?.id
        pickActivities(ids)
        selectedTab = .map
        if let place, visibleSelectedActivityIDs.isEmpty {
            // Hidden by filters: fly to the place itself. Wait for search to
            // close; a fly started while the keyboard and header animate out
            // is held until the next map gesture.
            let target = MapContext.Action.place(latitude: place.place.latitude, longitude: place.place.longitude, sheetFraction: 0)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [self] in
                if selectedTab == .map { mapContext.request(target) }
            }
        } else if visibleSelectedActivityIDs.count == 1, let id = visibleSelectedActivityIDs.first {
            activate(id)
            mapContext.request(.activity(id))
        } else {
            mapContext.request(.fitSelection)
        }
    }
}

extension ActivityStore {
    /// Leaves the camera where it is: fitting every activity zooms out to the world.
    func clearTextFilter() { searchText = "" }

    /// The Search key and the panel's last row. Map fits the result; Stats
    /// stays put and recalculates.
    func applyTextFilter(_ text: String) {
        searchText = text
        // Fit once search has closed: a camera move started while the keyboard
        // and header are still animating out is dropped.
        guard selectedTab == .map else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [self] in
            if selectedTab == .map { mapContext.request(.fitFiltered) }
        }
    }
}

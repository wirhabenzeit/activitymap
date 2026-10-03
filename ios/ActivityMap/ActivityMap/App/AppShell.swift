import SwiftUI

struct AppShell: View {
    @State private var store = ActivityStore()
    @State private var auth = AuthController()
    @State private var sync: SyncController?
    @Environment(\.localStore) private var localStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var sheets: BrowseSheetPresentation
    @AppStorage("browse.filterSidebarVisible") private var sidebarVisible = true
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    // Retained for review captures: the gallery stages map results inside the
    // production shell.
    private let mapPicker: RoutePicker?
    // #263 installs the real dashboard here. Until then no Stats control is
    // exposed. Its content stays mounted with Map/List through tab switches.
    private let statsContent: BrowseStatsDestination?

    init(activities: [Activity] = []) {
        self.init(store: ActivityStore(activities: activities))
    }

    init(store: ActivityStore, mapPicker: RoutePicker? = nil, sheets: BrowseSheetPresentation = BrowseSheetPresentation(),
         statsContent: BrowseStatsDestination? = nil) {
        _sheets = State(initialValue: sheets)
        _store = State(initialValue: store)
        self.mapPicker = mapPicker
        self.statsContent = statsContent
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let sidebarAvailable = sizeClass == .regular && geometry.size.width >= 760 && !typeSize.isAccessibilitySize
                HStack(spacing: 0) {
                    if sidebarAvailable && sidebarVisible {
                        VStack(spacing: 0) {
                            Text("Filters").font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .padding(.horizontal, 16)
                            FilterPanel(store: store, scope: filterScope)
                        }
                        .frame(width: 320)
                        .background(Color(uiColor: .secondarySystemBackground))
                        .accessibilityIdentifier("filter-sidebar")
                        Divider()
                    }
                    content.environment(\.filterSidebarVisible, sidebarAvailable && sidebarVisible)
                        .environment(\.mapResultsSheetSuspended, sheets.showsFilters || sheets.accountDestination != nil || sheets.shellSheetPresented)
                        .environment(\.mapResultsPresentationChanged, { sheets.mapResultsPresented = $0 })
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .navigationTitle(store.selectedTab == .map ? "ActivityMap" : store.selectedTab == .list ? "Activities" : "Stats")
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(AppTheme.navigationBlue, for: .navigationBar)
                .toolbarBackgroundVisibility(.visible, for: .navigationBar)
                .toolbarColorScheme(.dark, for: .navigationBar)
                .task {
                    guard let localStore else { return } // Xcode previews stay offline.
                    if sync == nil {
                        sync = SyncController(activities: store, invalidate: { auth.invalidateSession(token: $0) })
                    }
                    sync?.setSession(auth.syncSession, storage: localStore)
                    await refresh()
                }
                .onChange(of: auth.syncSession) { _, session in
                    if let localStore { sync?.setSession(session, storage: localStore) }
                }
                .task(id: scenePhase) {
                    guard scenePhase == .active else { sync?.pause(); return }
                    store.stats.refreshToday()
                    if sync != nil { await refresh() }
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(60)) } catch { return }
                        store.stats.refreshToday()
                        await refresh()
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Section(auth.currentUser?.name ?? "Account") {
                                Button {
                                    sheets.accountDestination = .profile
                                } label: {
                                    Label("Profile", systemImage: "person")
                                }
                            }

                            Button {
                                sheets.accountDestination = .settings
                            } label: {
                                Label("Settings", systemImage: "gearshape")
                            }

                            Button {
                                sheets.accountDestination = .about
                            } label: {
                                Label("About ActivityMap", systemImage: "info.circle")
                            }
                        } label: {
                            AsyncImage(url: auth.currentUser?.image.flatMap(URL.init(string:))) { phase in
                                if let image = phase.image {
                                    image.resizable().scaledToFill()
                                        .frame(width: 32, height: 32)
                                        .clipShape(Circle())
                                        .overlay { Circle().strokeBorder(.white.opacity(0.65), lineWidth: 1) }
                                } else {
                                    Image(systemName: "person.crop.circle")
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(.white)
                                }
                            }
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                            .accessibilityHidden(true)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Account and Settings")
                    }
                    .sharedBackgroundVisibility(.hidden)

                    ToolbarItem(placement: .principal) {
                        modePicker
                    }
                    .sharedBackgroundVisibility(.hidden)

                    ToolbarItem(placement: .topBarLeading) {
                        let filtersOpen = sidebarAvailable ? sidebarVisible : sheets.showsFilters
                        Button {
                            if sidebarAvailable { sidebarVisible.toggle() }
                            else { sheets.showsFilters.toggle() }
                        } label: {
                            Image(systemName: activeFilterCount == 0
                                ? "line.3.horizontal.decrease"
                                : "line.3.horizontal.decrease.circle.fill")
                                .rotationEffect(.degrees(sidebarAvailable ? 90 : 0))
                                .frame(width: 44, height: 44)
                                .background(filtersOpen ? Color.white.opacity(0.2) : .clear,
                                            in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .accessibilityLabel(filterButtonLabel)
                        .accessibilityValue(filtersOpen ? "Expanded" : "Collapsed")
                        .accessibilityAddTraits(filtersOpen ? .isSelected : [])
                    }
                    .sharedBackgroundVisibility(.hidden)
                }
                .sheet(item: Binding(
                    get: { sheets.mapResultsPresented ? nil : (sheets.showsFilters && !sidebarAvailable ? ShellSheet.filters : sheets.accountDestination.map(ShellSheet.account)) },
                    set: { value in
                        guard !sheets.mapResultsPresented, value == nil else { return }
                        sheets.showsFilters = false
                        sheets.accountDestination = nil
                    }
                ), onDismiss: { sheets.shellSheetPresented = false }) { destination in
                    Group {
                        switch destination {
                        case .filters:
                            NavigationStack {
                                FilterPanel(store: store, scope: filterScope)
                                    .navigationTitle("Filters")
                                    .navigationBarTitleDisplayMode(.inline)
                                    .toolbar {
                                        ToolbarItem(placement: .confirmationAction) {
                                            Button("Done") { sheets.showsFilters = false }
                                                .accessibilityIdentifier("filters-done")
                                        }
                                    }
                            }
                            .presentationDetents(verticalSizeClass == .compact || typeSize.isAccessibilitySize ? [.large] : [.medium, .large])
                            .presentationDragIndicator(.visible)
                        case .account(let account):
                            AccountSheet(destination: account, auth: auth, sync: sync, refresh: refresh)
                        }
                    }
                    .onAppear { sheets.shellSheetPresented = true }
                }
            }
        }
    }

    private var content: some View {
        BrowseContent(store: store, refresh: refresh, sync: sync, isSigningIn: auth.status == .signingIn,
                      openAccount: { sheets.accountDestination = .profile }, mapPicker: mapPicker)
            .environment(\.browseStatsDestination, statsContent)
            .tint(AppTheme.accent)
    }

    private func refresh() async {
        guard let localStore else { return }
        if let sync, let retry = sync.retryNotBefore, retry > Date() {
            // The controller still applies expiry/disconnection cleanup during
            // a server wait, without issuing another session/sync request.
            await sync.refresh()
            return
        }
        await auth.restoreSession()
        sync?.setSession(auth.syncSession, storage: localStore)
        await sync?.refresh()
    }

    private var filterButtonLabel: String {
        activeFilterCount == 0
            ? "Filters"
            : "Filters, \(activeFilterCount) active"
    }

    private var filterScope: FilterScope { store.selectedTab == .stats ? .stats : .browsing }
    private var activeFilterCount: Int { filterScope == .stats ? store.activeStatsFilterCount : store.activeFilterCount }

    private var modePicker: some View {
        HStack(spacing: 2) {
            ForEach(AppTab.available(stats: statsContent != nil), id: \.self) { tab in
                Button {
                    store.selectedTab = tab
                } label: {
                    Text(tab.title)
                        .font(.subheadline)
                        .fontWeight(store.selectedTab == tab ? .semibold : .regular)
                        .foregroundStyle(Color.white)
                        .frame(minWidth: 54)
                        .padding(.horizontal, 8)
                        .frame(minHeight: 44)
                        .background(
                            store.selectedTab == tab ? Color.white.opacity(0.22) : .clear,
                            in: Capsule()
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(store.selectedTab == tab ? .isSelected : [])
                .accessibilityIdentifier("browse-destination-\(tab.title.lowercased())")
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.08), in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("View")
    }
}

enum AccountDestination: String, Identifiable {
    case profile
    case settings
    case about

    var id: String { rawValue }
}

#Preview {
    AppShell(activities: SampleData.activities)
}

private enum ShellSheet: Identifiable {
    case filters
    case account(AccountDestination)
    var id: String {
        switch self {
        case .filters: "filters"
        case .account(let destination): "account-\(destination.rawValue)"
        }
    }
}

/// Separate requests from completed presentations so sheets never compete.
@MainActor @Observable
final class BrowseSheetPresentation {
    var showsFilters = false
    var accountDestination: AccountDestination?
    var mapResultsPresented = false
    var shellSheetPresented = false
}

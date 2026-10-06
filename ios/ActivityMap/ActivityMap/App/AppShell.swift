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
    // Real dashboard content stays mounted with Map/List through switches.
    private let statsContent: BrowseStatsDestination?

    init(activities: [Activity] = []) {
        self.init(store: ActivityStore(activities: activities))
    }

    init(store: ActivityStore, mapPicker: RoutePicker? = nil, sheets: BrowseSheetPresentation = BrowseSheetPresentation(),
         statsContent: BrowseStatsDestination? = .dashboard) {
        _sheets = State(initialValue: sheets)
        _store = State(initialValue: store)
        self.mapPicker = mapPicker
        self.statsContent = statsContent
    }

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                let sidebarAvailable = sizeClass == .regular && geometry.size.width >= 760 && !typeSize.isAccessibilitySize
                VStack(spacing: 0) {
                    shellHeader(sidebarAvailable: sidebarAvailable).zIndex(1)
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
                            // Filters and Settings stack over the map's results sheet
                            // instead of waiting for it to dismiss first.
                            .environment(\.mapResultsSheetSuspended, sheets.shellSheetPresented)
                            .environment(\.mapResultsPresentationChanged, { sheets.mapResultsPresented = $0 })
                            .environment(\.stackedShellSheet, StackedShellSheet(
                                request: Binding(get: { shellRequest(sidebarAvailable: sidebarAvailable) },
                                                 set: { if $0 == nil { clearShellRequest() } }),
                                content: { AnyView(shellSheet($0)) }))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
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
                // While the map's results sheet is up, it presents these itself.
                .sheet(item: Binding(
                    get: { sheets.mapResultsPresented ? nil : shellRequest(sidebarAvailable: sidebarAvailable) },
                    set: { value in
                        guard !sheets.mapResultsPresented, value == nil else { return }
                        clearShellRequest()
                    }
                ), onDismiss: { sheets.shellSheetPresented = false }) { destination in
                    shellSheet(destination)
                        .onAppear { sheets.shellSheetPresented = true }
                }
            }
        }
        .overlay {
            if let connectPrompt { StravaConnectOverlay(prompt: connectPrompt).transition(.opacity) }
        }
        .animation(.easeInOut(duration: 0.2), value: connectPrompt)
        .environment(\.stravaConnect, stravaConnect)
    }

    private func shellRequest(sidebarAvailable: Bool) -> ShellSheet? {
        sheets.showsFilters && !sidebarAvailable ? .filters : sheets.accountDestination.map(ShellSheet.account)
    }

    private func clearShellRequest() {
        sheets.showsFilters = false
        sheets.accountDestination = nil
    }

    @ViewBuilder private func shellSheet(_ destination: ShellSheet) -> some View {
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

    /// Signed out, expired or disconnected: one prompt over the whole shell.
    private var connectPrompt: StravaConnectPrompt? {
        StravaConnectPrompt(status: sync?.status, authStatus: auth.status)
    }

    /// The single connection flow every entry point uses (#304). Starting it
    /// in place keeps the person on the tab and context they started from.
    private var stravaConnect: StravaConnect {
        StravaConnect(start: { Task { await auth.signIn() } },
                      isConnecting: auth.status == .signingIn,
                      failed: auth.signInFailed,
                      restoreSession: { await auth.restoreSession() },
                      isVerifyingSession: auth.isRestoringSession,
                      restoreRetryAt: auth.restoreRetryAt)
    }

    /// iPhone landscape: a slimmer bar that also carries the List's status row (#315).
    private var compactBar: Bool { verticalSizeClass == .compact }
    private var syncing: Bool { sync?.status.showsLoadingIndicator == true }

    // Global destinations stay outside the List's native navigation stack.
    private func shellHeader(sidebarAvailable: Bool) -> some View {
        HStack(spacing: 8) {
            let filtersOpen = sidebarAvailable ? sidebarVisible : sheets.showsFilters
            // Equal flexible sides keep the destination picker centred.
            HStack(spacing: 8) {
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
                if compactBar && store.selectedTab == .list {
                    SelectionBar(store: store, includesTotal: true, onNavigationBar: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            ViewThatFits(in: .horizontal) {
                modePicker.fixedSize(horizontal: true, vertical: false)
                Menu {
                    ForEach(AppTab.available(stats: statsContent != nil), id: \.self) { tab in
                        Button(tab.title) { store.selectedTab = tab }
                    }
                } label: {
                    Label(store.selectedTab.title, systemImage: "chevron.down")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white).frame(minHeight: 44)
                }
                .accessibilityLabel("View: \(store.selectedTab.title)")
                .accessibilityIdentifier("browse-destination-menu")
            }
            // Measured before the sides, so the full picker wins when it fits.
            .layoutPriority(1)
            HStack(spacing: 8) {
                if compactBar && store.selectedTab == .list {
                    ListControls(presentation: store.listPresentation, iconOnly: true, onNavigationBar: true)
                }
                Button {
                    sheets.accountDestination = .settings
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
                    // Quiet activity-loading indicator (#309); sync detail lives in Settings.
                    .overlay { AvatarSyncIndicator(busy: syncing) }
                    .contentShape(Rectangle())
                    .accessibilityHidden(true)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Settings")
                .accessibilityValue(syncing ? "Syncing activities" : "")
                .accessibilityIdentifier("open-settings")
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .frame(height: compactBar ? 44 : 54)
        // Controls stay inside the safe area; only the colour reaches the edges.
        .background(AppTheme.navigationBlue.ignoresSafeArea(edges: [.top, .horizontal]))
        .accessibilityIdentifier("browse-header")
    }

    private var content: some View {
        BrowseContent(store: store, refresh: refresh, sync: sync, isSigningIn: auth.status == .signingIn,
                      mapPicker: mapPicker)
            .environment(\.browseStatsDestination, statsContent)
            .environment(\.statsRecovery, StatsRecovery(refresh: refresh))
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
                        .frame(minHeight: compactBar ? 36 : 44)
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
        .padding(compactBar ? 2 : 3)
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

enum ShellSheet: Identifiable {
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

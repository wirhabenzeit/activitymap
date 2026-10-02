import SwiftUI

struct AppShell: View {
    @State private var store = ActivityStore()
    @State private var auth = AuthController()
    @State private var sync: SyncController?
    @Environment(\.localStore) private var localStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var showsFilters = false
    @AppStorage("browse.filterSidebarVisible") private var sidebarVisible = true
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var accountDestination: AccountDestination?

    // Retained for review captures: the gallery stages map results inside the
    // production shell.
    private let mapPicker: RoutePicker?

    init(activities: [Activity] = []) {
        self.init(store: ActivityStore(activities: activities))
    }

    init(store: ActivityStore, mapPicker: RoutePicker? = nil) {
        _store = State(initialValue: store)
        self.mapPicker = mapPicker
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let sidebarAvailable = sizeClass == .regular && geometry.size.width >= 760 && !typeSize.isAccessibilitySize
                HStack(spacing: 0) {
                    if sidebarAvailable && sidebarVisible {
                        VStack(spacing: 0) {
                            HStack {
                                Text("Filters").font(.headline)
                                Spacer()
                                Button { sidebarVisible = false } label: {
                                    Image(systemName: "sidebar.left").frame(width: 44, height: 44)
                                }.accessibilityLabel("Hide filter sidebar")
                            }.padding(.horizontal, 16)
                            FilterPanel(store: store)
                        }
                        .frame(width: 320)
                        .background(Color(uiColor: .secondarySystemBackground))
                        .accessibilityIdentifier("filter-sidebar")
                        Divider()
                    }
                    content.environment(\.filterSidebarVisible, sidebarAvailable && sidebarVisible)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .navigationTitle(store.selectedTab == .list ? "Activities" : "ActivityMap")
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
                    if sync != nil { await refresh() }
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(60)) } catch { return }
                        await refresh()
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Section(auth.currentUser?.name ?? "Account") {
                                Button {
                                    accountDestination = .profile
                                } label: {
                                    Label("Profile", systemImage: "person")
                                }
                            }

                            Button {
                                accountDestination = .settings
                            } label: {
                                Label("Settings", systemImage: "gearshape")
                            }

                            Button {
                                accountDestination = .about
                            } label: {
                                Label("About ActivityMap", systemImage: "info.circle")
                            }
                        } label: {
                            Image(systemName: "person.crop.circle")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Color.white)
                                .frame(width: 44, height: 44)

                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Account and Settings")
                    }
                    .sharedBackgroundVisibility(.hidden)

                    ToolbarItem(placement: .principal) {
                        modePicker
                    }
                    .sharedBackgroundVisibility(.hidden)

                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            if sidebarAvailable { sidebarVisible.toggle() }
                            else { showsFilters.toggle() }
                        } label: {
                            Image(systemName: store.activeFilterCount == 0
                                ? "line.3.horizontal.decrease"
                                : "line.3.horizontal.decrease.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .accessibilityLabel(filterButtonLabel)
                    }
                    .sharedBackgroundVisibility(.hidden)
                }
                .inspector(isPresented: Binding(get: { showsFilters && !sidebarAvailable }, set: { showsFilters = $0 })) {
                    NavigationStack {
                        FilterPanel(store: store)
                            .navigationTitle("Filters")
                            .navigationBarTitleDisplayMode(.inline)
                    }
                    .inspectorColumnWidth(min: 300, ideal: 340, max: 400)
                    .presentationDetents([.medium, .large])
                }
                .sheet(item: $accountDestination) { destination in
                    AccountSheet(destination: destination, auth: auth, sync: sync, refresh: refresh)
                }
            }
        }
    }

    private var content: some View {
        BrowseContent(store: store, refresh: refresh, sync: sync, isSigningIn: auth.status == .signingIn,
                      openAccount: { accountDestination = .profile }, mapPicker: mapPicker)
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
        store.activeFilterCount == 0
            ? "Filters"
            : "Filters, \(store.activeFilterCount) active"
    }

    private var modePicker: some View {
        HStack(spacing: 2) {
            ForEach(AppTab.allCases, id: \.self) { tab in
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

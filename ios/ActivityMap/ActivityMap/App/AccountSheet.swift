import SwiftUI

struct AccountSheet: View {
    let destination: AccountDestination
    let auth: AuthController
    var sync: SyncController? = nil
    var refresh: (() async -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var ingestionStatus = IngestionStatusController()
    @Bindable private var preferences = DisplayPreferences.shared
    /// Profile opened while signed out is only a login presentation: once the
    /// connection is verified it closes and returns to the browsing context.
    /// Profile opened for account management stays open (#304).
    @State private var openedForLogin: Bool?

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 5)) { _ in
                switch destination {
                case .profile:
                    accountPage
                case .settings:
                    Form { settingsContent }
                case .about:
                    aboutPage
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(preferences.appearance.colorScheme)
        .presentationDetents([.large])
        .onAppear {
            if openedForLogin == nil { openedForLogin = destination == .profile && auth.currentUser == nil }
        }
        .onChange(of: auth.status) { _, status in
            if case .signedIn = status, openedForLogin == true { dismiss() }
        }
        .task(id: StatusObservation(session: syncSession, active: scenePhase == .active)) {
            if destination != .about, scenePhase == .active, let session = syncSession {
                await ingestionStatus.observe(session)
            }
        }
    }

    private var syncSession: SyncSession? { sync?.session ?? auth.syncSession }
    private struct StatusObservation: Equatable { let session: SyncSession?; let active: Bool }
    private var importNeedsReconnect: Bool {
        guard let session = syncSession, ingestionStatus.scope == session.scope,
              let status = ingestionStatus.snapshot else { return false }
        return status.history.scheduling == .blocked || status.details.scheduling == .blocked
            || status.photos.scheduling == .blocked || status.streams.scheduling == .blocked
    }

    // Section content must be hosted in a Form at each navigation destination.
    // A bare Group loses the list layout when pushed from Settings.
    var accountPage: some View {
        Form { profileContent }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
    }

    var aboutPage: some View {
        Form { aboutContent }
            .navigationTitle("About ActivityMap")
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var profileContent: some View {
        switch auth.status {
        case .signedOut:
            signedOutContent
        case .restoring:
            progressContent("Checking your session…")
        case .signingIn:
            progressContent("Signing in…")
        case .signedIn(let user):
            signedInContent(user)
        case .sessionRestoreFailed(let message):
            sessionRestoreFailedContent(message)
        case .signOutFailed(let message):
            signOutFailedContent(message)
        case .failed:
            // The adjacent failure text comes from `StravaConnectControls`;
            // the raw error stays out of the product UI.
            signedOutContent
        }
    }

    private var signedOutContent: some View {
        Section {
            VStack(spacing: 16) {
                VStack(spacing: 8) {
                    Text("Connect Strava to see your activities")
                        .font(.headline)
                    Text(StravaConnectCopy.purpose)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                StravaConnectControls()
            }
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
        }
    }

    private func progressContent(_ title: String) -> some View {
        Section {
            HStack(spacing: 8) {
                ProgressView()
                Text(title)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
        }
    }

    func signedInContent(_ user: ActivityMapAPI.CurrentUser) -> some View {
        let limited = user.stravaConnected && StravaPermissionsCopy.isLimited(user.stravaPermissions)
        let needsReconnect = !user.stravaConnected || limited || importNeedsReconnect
        return Group {
            Section("Account") {
                VStack(alignment: .leading, spacing: 3) {
                    Text(user.name ?? "Your account")
                        .font(.headline)
                    if let email = displayEmail(user.email) {
                        Text(email)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(!user.stravaConnected ? "Strava not connected"
                    : limited ? "Strava connected with limited access" : "Strava connected")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if needsReconnect {
                    Text(limited
                         ? (StravaPermissionsCopy.notes(user.stravaPermissions) + [StravaPermissionsCopy.reconnect]).joined(separator: " ")
                         : "Connect with Strava again to restore access to your activities.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    StravaConnectControls(showsPermissions: false)
                        .frame(maxWidth: .infinity)
                }
            }

            Section {
                Button("Sign out of ActivityMap", role: .destructive) {
                    Task { await auth.signOut() }
                }
                .accessibilityIdentifier("account-sign-out")
            } footer: {
                Text("Strava stays connected.")
            }

        }
    }

    /// A stored session exists but could not be confirmed this time (no
    /// connectivity, a timeout, a server error) — retries `restoreSession()`
    /// rather than starting a fresh sign-in, since the existing token has not
    /// been rejected, only left unverified.
    private func sessionRestoreFailedContent(_ message: String) -> some View {
        Group {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Couldn't Verify Your Session")
                        .font(.headline)
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Button("Retry") {
                        Task { await auth.restoreSession() }
                    }
                    .disabled(auth.restoreRetryAt.map { $0 > context.date } ?? false)
                }
            }
        }
    }

    /// The server-side session may still be active — retries `signOut()`
    /// rather than treating the person as already signed out.
    private func signOutFailedContent(_ message: String) -> some View {
        Group {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Sign-Out Failed")
                        .font(.headline)
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button("Try Again") {
                    Task { await auth.signOut() }
                }
            }
        }
    }

    private var settingsContent: some View {
        Group {
            syncContent
            if let session = syncSession {
                IngestionStatusSection(session: session, controller: ingestionStatus)
            }

            profileContent

            Section {
                Picker("Units", selection: $preferences.units) {
                    ForEach(UnitSystem.allCases) { unit in
                        Text(unit.title).tag(unit)
                    }
                }

                Picker("Date format", selection: $preferences.dateFormat) {
                    ForEach(PreferredDateFormat.allCases) { format in Text(format.title).tag(format) }
                }

                Picker("Appearance", selection: $preferences.appearance) {
                    ForEach(Appearance.allCases) { appearance in
                        Text(appearance.title).tag(appearance)
                    }
                }
            } header: { Text("Display") } footer: {
                Text("Distance, elevation and speed use \(preferences.units == .metric ? "kilometres, metres and km/h" : "miles, feet and mph"). Preferences are saved on this device.")
            }
            Section("About") {
                NavigationLink("About ActivityMap") { aboutPage }
                    .accessibilityIdentifier("settings-about")
            }
        }
    }

    @ViewBuilder
    private var syncContent: some View {
        if let sync {
            Section("Sync & data") {
                LabeledContent("Last device sync", value: sync.lastSyncAt?.formatted(date: .abbreviated, time: .shortened) ?? "Not yet synced")
                if let refresh, sync.session != nil {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Label("Sync now", systemImage: "arrow.clockwise")
                    }
                        .disabled(!sync.canRefresh)
                }
                if let syncMessage {
                    Text(syncMessage).font(.footnote).foregroundStyle(.secondary)
                }
                if let date = sync.retryNotBefore, date > Date() {
                    Text("Try again after \(date.formatted(date: .abbreviated, time: .shortened)).")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var syncMessage: String? {
        switch sync?.status {
        case .signedOut: "Sign in to sync your activities."
        case .syncing: "Syncing…"
        case .offline: "Offline. Sync will resume when you’re back online."
        case .failed: "Couldn’t sync. Please try again."
        case .paused: "Sync paused. Tap Sync now to resume."
        case .expired: "Sign in again from Account to sync your activities."
        case .disconnected: "Reconnect Strava from Account to sync your activities."
        case .rateLimited, .retryAfter: "Couldn’t sync. Please try again later."
        case .ready, nil: nil
        }
    }

    private var aboutContent: some View {
        Group {
            Section {
                LabeledContent("Version", value: "1.0")
            }

            Section {
                Text("Explore your activities on a map, in a list, and through meaningful summaries.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var title: String {
        switch destination {
        case .profile: "Account"
        case .settings: "Settings"
        case .about: "About"
        }
    }
}

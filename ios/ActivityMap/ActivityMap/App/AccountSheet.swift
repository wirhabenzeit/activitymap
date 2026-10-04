import SwiftUI

struct AccountSheet: View {
    let destination: AccountDestination
    let auth: AuthController
    var sync: SyncController? = nil
    var refresh: (() async -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @Bindable private var preferences = DisplayPreferences.shared
    /// Profile opened while signed out is only a login presentation: once the
    /// connection is verified it closes and returns to the browsing context.
    /// Profile opened for account management stays open (#304).
    @State private var openedForLogin: Bool?

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 5)) { _ in
                Form {
                    switch destination {
                    case .profile:
                        profileContent
                    case .settings:
                        settingsContent
                    case .about:
                        aboutContent
                    }
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
        .presentationDetents([.medium, .large])
        .onAppear {
            if openedForLogin == nil { openedForLogin = destination == .profile && auth.currentUser == nil }
        }
        .onChange(of: auth.status) { _, status in
            if case .signedIn = status, openedForLogin == true { dismiss() }
        }
    }

    @ViewBuilder
    private var profileContent: some View {
        switch auth.status {
        case .signedOut:
            signedOutContent
        case .signingIn:
            signingInContent
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

    private var signingInContent: some View {
        Section {
            HStack(spacing: 8) {
                ProgressView()
                Text("Signing in…")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
        }
    }

    private func signedInContent(_ user: ActivityMapAPI.CurrentUser) -> some View {
        Group {
            Section {
                VStack(spacing: 12) {
                    Image(systemName: "person.crop.circle.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(.secondary)

                    VStack(spacing: 3) {
                        Text(user.name ?? "ActivityMap Account")
                            .font(.headline)
                        if let email = displayEmail(user.email) {
                            Text(email)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }

            Section("Connected Services") {
                LabeledContent("Strava", value: user.stravaConnected ? "Connected" : "Not Connected")
                if let athleteID = user.athleteID {
                    LabeledContent("Athlete ID", value: athleteID)
                }
            }

            if !user.stravaConnected || user.authentication.sessionExpiresAt <= Date() {
                Section {
                    StravaConnectControls()
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                } header: {
                    Text(user.stravaConnected ? "Sign-in expired" : "Strava is disconnected")
                }
            }

            Section {
                Button("Sign Out", role: .destructive) {
                    Task { await auth.signOut() }
                }
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
                Button("Retry") {
                    Task { await auth.restoreSession() }
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
            Section("Account / connection") {
                NavigationLink("Account and Strava connection") { profileContent }
                Button("Reconnect Strava") { Task { await auth.signIn() } }
            }
            if let session = sync?.session { IngestionStatusSection(session: session) }
            syncContent

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
                NavigationLink("About ActivityMap") { aboutContent }
            }
        }
    }

    @ViewBuilder
    private var syncContent: some View {
        if let sync {
            Section {
                Text(sync.status == .ready ? "Device download complete" : sync.status.title)
                if let lastSync = sync.checkpoint?.lastSyncAt {
                    LabeledContent("Last device download") { Text(lastSync, style: .relative) }
                }
                if case .failed(let message) = sync.status {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                }
                if let date = sync.retryNotBefore {
                    LabeledContent("Retry after") { Text(date, style: .time) }
                }
                NavigationLink("Download details") {
                    BrowsingSyncDetails(presentation: BrowsingPresentation(store: sync.activities, sync: sync),
                                        failureMessage: syncFailureMessage, recover: recoverSync)
                        .navigationTitle("Device download")
                        .navigationBarTitleDisplayMode(.inline)
                }
                if sync.status == .syncing {
                    Button("Pause device download") { sync.pause() }
                }
                if let refresh, sync.session != nil {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Label("Sync this device", systemImage: "arrow.clockwise")
                    }
                        .disabled(!sync.canRefresh)
                }
            } header: { Text("This device") } footer: { Text("ActivityMap → this device. Server import continues independently.") }
        }
    }

    private var syncFailureMessage: String? {
        if case .failed(let message) = sync?.status { return message }
        return nil
    }

    private func recoverSync(_ action: BrowsingPresentation.Recovery) {
        switch action {
        case .retry:
            guard sync?.canRefresh == true, let refresh else { return }
            Task { await refresh() }
        case .cancelSync: sync?.pause()
        case .account: Task { await auth.signIn() }
        case .clearFilters, .showList: break
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
        case .profile: "Profile"
        case .settings: "Settings"
        case .about: "About"
        }
    }
}

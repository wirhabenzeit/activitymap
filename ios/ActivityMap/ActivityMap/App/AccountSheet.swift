import SwiftUI

struct AccountSheet: View {
    let destination: AccountDestination
    let auth: AuthController
    var sync: SyncController? = nil
    var refresh: (() async -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var distanceUnit = DistanceUnit.kilometers
    @State private var appearance = Appearance.system

    var body: some View {
        NavigationStack {
            Form {
                switch destination {
                case .profile:
                    profileContent
                    syncContent
                case .settings:
                    settingsContent
                case .about:
                    aboutContent
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
        .presentationDetents([.medium, .large])
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
        case .failed(let message):
            signInFailedContent(message)
        }
    }

    private var signedOutContent: some View {
        Group {
            Section {
                VStack(spacing: 12) {
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 64))
                        .foregroundStyle(.secondary)
                    Text("Not Signed In")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }

            Section {
                Button {
                    Task { await auth.signIn() }
                } label: {
                    Label("Sign in with Strava", systemImage: "figure.outdoor.cycle")
                }
            }
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
                        if let email = user.email {
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
                LabeledContent("Session", value: user.authentication.method.rawValue.capitalized)
            }

            Section {
                Button("Sign Out", role: .destructive) {
                    Task { await auth.signOut() }
                }
            }
        }
    }

    private func signInFailedContent(_ message: String) -> some View {
        Group {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Sign-In Failed")
                        .font(.headline)
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button("Try Again") {
                    Task { await auth.signIn() }
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
            syncContent

            Section("Display") {
                Picker("Distance", selection: $distanceUnit) {
                    ForEach(DistanceUnit.allCases) { unit in
                        Text(unit.title).tag(unit)
                    }
                }

                Picker("Appearance", selection: $appearance) {
                    ForEach(Appearance.allCases) { appearance in
                        Text(appearance.title).tag(appearance)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var syncContent: some View {
        if let sync {
            Section("Activity Data") {
                Text(sync.status.title)
                if let lastSync = sync.checkpoint?.lastSyncAt {
                    LabeledContent("Last synced") { Text(lastSync, style: .relative) }
                }
                if let reconciled = sync.checkpoint?.freshness?.lastSummaryReconciledAt {
                    LabeledContent("Strava last checked") { Text(reconciled, style: .relative) }
                }
                if case .failed(let message) = sync.status {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                }
                if case .rateLimited(let date) = sync.status {
                    LabeledContent("Retry after") { Text(date, style: .time) }
                }
                if let refresh, sync.session != nil {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Label("Refresh Activities", systemImage: "arrow.clockwise")
                    }
                        .disabled(sync.status == .syncing)
                }
            }
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

private enum DistanceUnit: String, CaseIterable, Identifiable {
    case kilometers
    case miles

    var id: String { rawValue }

    var title: String {
        switch self {
        case .kilometers: "Kilometers"
        case .miles: "Miles"
        }
    }
}

private enum Appearance: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}

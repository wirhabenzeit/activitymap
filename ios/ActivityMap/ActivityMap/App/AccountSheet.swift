import SwiftUI
import UIKit

struct AccountSheet: View {
    let destination: AccountDestination
    let auth: AuthController
    var sync: SyncController? = nil
    var refresh: (() async -> Void)? = nil

    @Environment(\.locale) private var locale
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var ingestionStatus = IngestionStatusController()
    @State private var stravaImport = StravaImportController()
    @Environment(DisplayPreferences.self) private var injectedPreferences: DisplayPreferences?
    @State private var previewPreferences = DisplayPreferences(defaults: nil)
    private var preferences: DisplayPreferences { injectedPreferences ?? previewPreferences }
    /// Profile opened while signed out is only a login presentation: once the
    /// connection is verified it closes and returns to the browsing context.
    /// Profile opened for account management stays open (#304).
    @State private var openedForLogin: Bool?
    @State private var confirmDeletion = false
    @State private var deletionError: PresentationText?
    @State private var accountDeleted = false
    @State private var clearingDeletedData = false

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
                    Button(String(localized: AppMessages.actionDone(locale: locale))) { dismiss() }
                        .disabled(auth.deletingAccount || clearingDeletedData)
                }
            }
        }
        .preferredColorScheme(preferences.appearance.colorScheme)
        .presentationDetents([.large])
        .interactiveDismissDisabled(auth.deletingAccount || clearingDeletedData)
        .alert(String(localized: AppMessages.accountNativeDeleteYourAccountAndAllActivityMapData(locale: locale)), isPresented: $confirmDeletion) {
            Button(String(localized: AppMessages.activityEditCancel(locale: locale)), role: .cancel) {}
            Button(String(localized: AppMessages.accountConfirmDelete(locale: locale)), role: .destructive) {
                Task { await deleteAccountAndData() }
            }
        } message: {
            Text(String(localized: AppMessages.accountNativeThisCanTBeUndoneYourOriginalStrava(locale: locale)))
        }
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
        .task(id: StatusObservation(session: syncSession, active: scenePhase == .active)) {
            if destination == .settings, scenePhase == .active, let session = syncSession {
                await stravaImport.observe(session)
            }
        }
        .onChange(of: stravaImport.snapshot) { _, snapshot in
            guard snapshot?.runID != nil, let session = syncSession,
                  stravaImport.scope == session.scope else { return }
            Task { await refresh?() }
        }
    }

    private var syncSession: SyncSession? { sync?.session ?? auth.syncSession }
    private struct StatusObservation: Equatable { let session: SyncSession?; let active: Bool }
    private var importNeedsReconnect: Bool {
        guard let session = syncSession else { return false }
        if stravaImport.scope == session.scope, stravaImport.snapshot?.status == .blocked { return true }
        guard ingestionStatus.scope == session.scope, let status = ingestionStatus.snapshot else { return false }
        return status.history.scheduling == .blocked || status.details.scheduling == .blocked
            || status.photos.scheduling == .blocked || status.streams.scheduling == .blocked
    }

    // Section content must be hosted in a Form at each navigation destination.
    // A bare Group loses the list layout when pushed from Settings.
    var accountPage: some View {
        Form { accountContent }
            .navigationTitle(String(localized: AppMessages.navigationAccount(locale: locale)))
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var accountContent: some View {
        if accountDeleted {
            Section {
                Text(String(localized: AppMessages.accountDeleted(locale: locale)))
                if let deletionError { Text(verbatim: deletionError.string(locale: locale)).foregroundStyle(.red) }
                Button(clearingDeletedData ? String(localized: AppMessages.accountClearing(locale: locale)) : String(localized: AppMessages.accountFinishClearing(locale: locale))) {
                    Task { await deleteAccountAndData() }
                }.disabled(clearingDeletedData)
            }
        } else {
            profileContent
            if let deletionError {
                Section { Text(verbatim: deletionError.string(locale: locale)).foregroundStyle(.red) }
            }
        }
    }

    var aboutPage: some View {
        Form { aboutContent }
            .navigationTitle(String(localized: AppMessages.accountNativeAboutActivityMap(locale: locale)))
            .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var profileContent: some View {
        switch auth.status {
        case .signedOut:
            signedOutContent
        case .restoring:
            progressContent(String(localized: AppMessages.accountNativeCheckingYourSession(locale: locale)))
        case .signingIn:
            progressContent(String(localized: AppMessages.accountNativeSigningIn(locale: locale)))
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
                    Text(String(localized: AppMessages.statusBrowsingConnectStravaToSeeYourActivities(locale: locale)))
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
            Section(String(localized: AppMessages.navigationAccount(locale: locale))) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: user.name ?? String(localized: AppMessages.accountYourAccount(locale: locale)))
                        .font(.headline)
                    if let email = displayEmail(user.email) {
                        Text(email)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(!user.stravaConnected ? String(localized: AppMessages.accountStravaDisconnected(locale: locale))
                    : limited ? String(localized: AppMessages.accountStravaLimited(locale: locale)) : String(localized: AppMessages.accountStravaConnected(locale: locale)))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if needsReconnect {
                    Text(limited
                         ? (StravaPermissionsCopy.notes(user.stravaPermissions) + [StravaPermissionsCopy.reconnect]).joined(separator: " ")
                         : String(localized: AppMessages.accountReconnect(locale: locale)))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    StravaConnectControls(showsPermissions: false)
                        .frame(maxWidth: .infinity)
                }
            }

            Section {
                Button(String(localized: AppMessages.accountSignOut(locale: locale)), role: .destructive) {
                    Task { await auth.signOut() }
                }
                .accessibilityIdentifier("account-sign-out")
                .disabled(auth.deletingAccount)
            } footer: {
                Text(String(localized: AppMessages.accountStravaStaysConnected(locale: locale)))
            }

            Section {
                Button(auth.deletingAccount ? String(localized: AppMessages.accountDeleting(locale: locale)) : String(localized: AppMessages.accountDelete(locale: locale)), role: .destructive) {
                    confirmDeletion = true
                }
                .disabled(auth.deletingAccount)
                .accessibilityIdentifier("account-delete")
            } footer: {
                Text(String(localized: AppMessages.accountNativePermanentlyDeleteYourActivityMapAccountImportedActivitiesPhotos(locale: locale)))
            }

        }
    }

    private func deleteAccountAndData() async {
        deletionError = nil
        if !accountDeleted {
            do {
                try await auth.deleteAccount()
                accountDeleted = true
            } catch {
                deletionError = .localized(AppMessages.accountNativeCouldnTConfirmAccountDeletionCheckYourConnection(locale: locale))
                return
            }
        }
        clearingDeletedData = true
        defer { clearingDeletedData = false }
        do {
            try await sync?.clearAfterAccountDeletion()
            dismiss()
        } catch {
            deletionError = .localized(AppMessages.accountNativeYourAccountWasDeletedButLocalDataCould(locale: locale))
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
                    Text(String(localized: AppMessages.connectVerifyTitle(locale: locale)))
                        .font(.headline)
                    Text(verbatim: message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Button(String(localized: AppMessages.actionRetry(locale: locale))) {
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
                    Text(String(localized: AppMessages.accountNativeSignOutFailed(locale: locale)))
                        .font(.headline)
                    Text(verbatim: message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button(String(localized: AppMessages.accountNativeTryAgain(locale: locale))) {
                    Task { await auth.signOut() }
                }
            }
        }
    }

    private var settingsContent: some View {
        @Bindable var preferences = preferences
        return Group {
            syncContent
            if let session = syncSession {
                IngestionStatusSection(session: session, controller: ingestionStatus, stravaImport: stravaImport)
            }

            accountContent

            Section {
                Picker(String(localized: AppMessages.displayUnits(locale: locale)), selection: $preferences.units) {
                    ForEach(UnitSystem.allCases) { unit in
                        Text(verbatim: unit.title(locale: locale)).tag(unit)
                    }
                }

                Picker(String(localized: AppMessages.displayDateFormat(locale: locale)), selection: $preferences.dateFormat) {
                    ForEach(PreferredDateFormat.allCases) { format in Text(verbatim: format.title(locale: locale)).tag(format) }
                }

                Picker(String(localized: AppMessages.displayAppearance(locale: locale)), selection: $preferences.appearance) {
                    ForEach(Appearance.allCases) { appearance in
                        Text(verbatim: appearance.title(locale: locale)).tag(appearance)
                    }
                }
            } header: { Text(String(localized: AppMessages.settingsDisplay(locale: locale))) } footer: {
                Text(preferences.units == .metric ? AppMessages.displayMetricExplanation(locale: locale) : AppMessages.displayImperialExplanation(locale: locale))
            }
            Section(String(localized: AppMessages.settingsAbout(locale: locale))) {
                NavigationLink(String(localized: AppMessages.accountNativeAboutActivityMap(locale: locale))) { aboutPage }
                    .accessibilityIdentifier("settings-about")
            }
        }
    }

    @ViewBuilder
    private var syncContent: some View {
        if let sync {
            Section(String(localized: AppMessages.settingsSyncData(locale: locale))) {
                LabeledContent(String(localized: AppMessages.accountNativeLastDeviceSync(locale: locale)), value: sync.lastSyncAt?.formatted(date: .abbreviated, time: .shortened) ?? String(localized: AppMessages.settingsNotSynced(locale: locale)))
                if let refresh, sync.session != nil {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Label(String(localized: AppMessages.settingsSyncNow(locale: locale)), systemImage: "arrow.clockwise")
                    }
                        .disabled(!sync.canRefresh)
                }
                if let syncMessage {
                    Text(syncMessage).font(.footnote).foregroundStyle(.secondary)
                }
                if let date = sync.retryNotBefore, date > Date() {
                    Text(AppMessages.mutationRetryAfter(date.formatted(date: .abbreviated, time: .shortened), locale: locale))
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var syncMessage: String? {
        switch sync?.status {
        case .signedOut: String(localized: AppMessages.settingsSignInToSync(locale: locale))
        case .syncing: "Syncing…"
        case .offline: String(localized: AppMessages.settingsOfflineSync(locale: locale))
        case .failed: String(localized: AppMessages.settingsSyncError(locale: locale))
        case .paused: String(localized: AppMessages.accountNativeSyncPausedTapSyncNowToResume(locale: locale))
        case .expired: String(localized: AppMessages.accountNativeSignInAgainFromAccountToSyncYour(locale: locale))
        case .disconnected: String(localized: AppMessages.accountNativeReconnectStravaFromAccountToSyncYourActivities(locale: locale))
        case .rateLimited, .retryAfter: String(localized: AppMessages.accountNativeCouldnTSyncPleaseTryAgainLater(locale: locale))
        case .ready, nil: nil
        }
    }

    private var aboutContent: some View {
        Group {
            Section {
                LabeledContent(String(localized: AppMessages.accountNativeVersion(locale: locale)), value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                LabeledContent(String(localized: AppMessages.accountNativeBuild(locale: locale)), value: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—")
            }

            Section {
                Text(String(localized: AppMessages.accountNativeExploreYourActivitiesOnAMapInA(locale: locale)))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var title: String {
        switch destination {
        case .profile: String(localized: AppMessages.navigationAccount(locale: locale))
        case .settings: String(localized: AppMessages.navigationSettings(locale: locale))
        case .about: String(localized: AppMessages.settingsAbout(locale: locale))
        }
    }
}

import SwiftUI

/// One Strava connection flow for every entry point: Map, List, Stats, the
/// account menu and the Profile sheet (issue #304). `AppShell` provides it
/// from `AuthController`; views start the hosted authorization directly, with
/// no ActivityMap screen in between.
struct StravaConnect {
    var start: @MainActor () -> Void = {}
    var isConnecting = false
    /// The last attempt failed for a reason other than the person cancelling.
    var failed = false
    var restoreSession: @MainActor () async -> Void = {}
    var isVerifyingSession = false
    /// The server asked not to check the session again before this time.
    var restoreRetryAt: Date?
}

private struct StravaConnectKey: EnvironmentKey {
    static let defaultValue = StravaConnect()
}

extension EnvironmentValues {
    var stravaConnect: StravaConnect {
        get { self[StravaConnectKey.self] }
        set { self[StravaConnectKey.self] = newValue }
    }
}

/// Why ActivityMap connects to Strava and what the requested `read`,
/// `activity:read`, `activity:read_all` and `activity:write` scopes are for. Mirrors the web
/// copy in `src/components/auth/strava-connect.tsx`.
enum StravaConnectCopy {
    static let purpose = "ActivityMap shows your Strava activities on a map, in a list and as stats."
    static let permissions = "ActivityMap reads your activities, including private ones, and updates those you edit here."
    static let failure = "Couldn’t connect to Strava. Please try again."
}

/// What a limited Strava grant leaves out (issue #303). Mirrors
/// `stravaPermissionNotes` in `src/lib/strava-permissions.ts`.
enum StravaPermissionsCopy {
    static let reconnect = "Connect with Strava again to grant the missing permissions."

    static func isLimited(_ permissions: ActivityMapAPI.StravaPermissions?) -> Bool {
        guard let permissions else { return false }
        return permissions.activities != .all || !permissions.edit
    }

    static func notes(_ permissions: ActivityMapAPI.StravaPermissions?) -> [String] {
        guard let permissions else { return [] }
        var notes: [String] = []
        switch permissions.activities {
        case .none:
            notes.append("No activities are shared.")
        case .public:
            notes.append("Private activities aren’t shared.")
        case .all:
            break
        }
        if !permissions.edit {
            notes.append("Editing isn’t allowed.")
        }
        return notes
    }
}

/// Strava's official "Connect with Strava" artwork at its native 193 × 48
/// proportions, including Strava's own padding. Progress is shown beside the
/// artwork, never drawn over it.
struct StravaConnectButton: View {
    @Environment(\.stravaConnect) private var connect

    var body: some View {
        HStack(spacing: 12) {
            Button { connect.start() } label: {
                Image("StravaConnect")
                    .resizable()
                    .aspectRatio(193.0 / 48.0, contentMode: .fit)
                    .frame(width: 193, height: 48)
            }
            .buttonStyle(.plain)
            .disabled(connect.isConnecting)
            .opacity(connect.isConnecting ? 0.6 : 1)
            .accessibilityLabel("Connect with Strava")
            .accessibilityHint("Opens Strava to approve access to your activities.")
            .accessibilityIdentifier("strava-connect")
            if connect.isConnecting {
                ProgressView().accessibilityLabel("Waiting for Strava")
            }
        }
    }
}

/// The button with its adjacent failure and permission explanation.
struct StravaConnectControls: View {
    var alignment: HorizontalAlignment = .center
    /// The permission explanation matters before connecting, not afterwards.
    var showsPermissions = true
    @Environment(\.stravaConnect) private var connect

    var body: some View {
        VStack(alignment: alignment, spacing: 12) {
            StravaConnectButton()
            if connect.failed && !connect.isConnecting {
                Text(StravaConnectCopy.failure)
                    .font(.subheadline)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("strava-connect-failure")
            }
            if showsPermissions {
                Text(StravaConnectCopy.permissions)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .multilineTextAlignment(alignment == .center ? .center : .leading)
    }
}

/// Synthetic `<athlete>@strava.local` fallback addresses are an implementation
/// detail, not account identity.
func displayEmail(_ email: String?) -> String? {
    guard let email, !email.lowercased().hasSuffix("@strava.local") else { return nil }
    return email
}

/// What the shell-level connection prompt says for a sync status that needs
/// Strava, or `nil` when browsing can continue.
struct StravaConnectPrompt: Equatable {
    enum Recovery: Equatable { case connect, verifySession }
    let title: String
    let message: String
    let recovery: Recovery

    init?(status: SyncController.Status?, authStatus: AuthController.Status? = nil) {
        // A saved token whose verification failed is not a failed OAuth grant.
        // Keep cached browsing available; recover here only when the shell is blocked.
        if case .sessionRestoreFailed(let reason) = authStatus,
           status == .signedOut || status == .expired || status == .disconnected {
            title = "Couldn’t verify your session"
            message = "Your sign-in was saved. " + reason
            recovery = .verifySession
            return
        }
        recovery = .connect
        switch status {
        case .signedOut:
            title = "Connect Strava to see your activities"
            message = StravaConnectCopy.purpose
        case .expired:
            title = "Your sign-in has expired"
            message = "Connect with Strava again to restore access to your activities."
        case .disconnected:
            title = "Strava is disconnected"
            message = "Connect with Strava again to load your activities."
        default:
            return nil
        }
    }
}

/// The single connection prompt (#304): a centred card floating over the
/// whole shell, header included, on a frosted backdrop. Map, List and Stats
/// stay visible but out of reach behind it, so there is exactly one button.
struct StravaConnectOverlay: View {
    let prompt: StravaConnectPrompt
    @Environment(\.stravaConnect) private var connect

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            ViewThatFits(in: .vertical) {
                card
                ScrollView { card.padding(.vertical, 24) }
                    .scrollBounceBehavior(.basedOnSize)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier("strava-connect-overlay")
    }

    private var card: some View {
        VStack(spacing: 20) {
            VStack(spacing: 8) {
                Text(prompt.title)
                    .font(.title3.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                Text(prompt.message)
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            if prompt.recovery == .verifySession {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Button {
                        Task { await connect.restoreSession() }
                    } label: {
                        HStack {
                            if connect.isVerifyingSession { ProgressView() }
                            Text(connect.isVerifyingSession ? "Checking session…" : "Retry session verification")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(connect.isVerifyingSession || (connect.restoreRetryAt.map { $0 > context.date } ?? false))
                    .accessibilityIdentifier("strava-verify-session")
                }
            } else {
                StravaConnectControls()
            }
        }
        .padding(24)
        .frame(maxWidth: 420)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 30, y: 12)
        .padding(.horizontal, 20)
    }
}

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
/// `activity:read_all` and `activity:write` scopes are for. Mirrors the web
/// copy in `src/components/auth/strava-connect.tsx`.
enum StravaConnectCopy {
    static let purpose = "ActivityMap shows your Strava activities on a map, in a list and as stats."
    static let permissions = "Strava will ask you to let ActivityMap read your activities, including private ones, and update an activity’s name, description and sport when you edit it here."
    static let failure = "Couldn’t connect to Strava. Please try again."
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
            Text(StravaConnectCopy.permissions)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
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

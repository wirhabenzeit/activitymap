import Foundation
import Observation
import SwiftUI

@MainActor @Observable
final class ActivitySharingService {
    var session: () -> SyncSession? = { nil }
    var source: (SyncSession) -> any ShareLinksSource = { ShareLinksAPI(baseURL: $0.deployment, token: $0.token) }

    var unavailableReason: String? {
        guard let session = session(), session.user.authentication.sessionExpiresAt > .now else {
            return "Sign in to share activities."
        }
        guard session.verified, session.user.stravaConnected else {
            return "Reconnect and sync before sharing activities."
        }
        return nil
    }

    func perform<T>(_ operation: (any ShareLinksSource, URL) async throws -> T) async throws -> T {
        guard unavailableReason == nil, let captured = session() else {
            throw SharingError.unavailable(unavailableReason ?? "Sign in to share activities.")
        }
        let result = try await operation(source(captured), captured.deployment)
        try Task.checkCancellation()
        guard let current = session(), current.scope == captured.scope, current.token == captured.token,
              unavailableReason == nil else { throw CancellationError() }
        return result
    }
}

nonisolated enum SharingError: LocalizedError {
    case unavailable(String)
    var errorDescription: String? {
        switch self { case .unavailable(let message): message }
    }
}

private struct ActivitySharingKey: EnvironmentKey {
    static let defaultValue: ActivitySharingService? = nil
}
extension EnvironmentValues {
    var activitySharing: ActivitySharingService? {
        get { self[ActivitySharingKey.self] }
        set { self[ActivitySharingKey.self] = newValue }
    }
}

@MainActor @Observable
final class ActivityShareModel {
    enum Step { case configure, created }
    // Capture the exact set when opening; later filter/selection changes cannot widen it.
    let activities: [Activity]
    var expiresInHours = 7 * 24
    var showRouteEnds = false
    var step = Step.configure
    private(set) var isBusy = false
    private(set) var errorMessage: String?
    private(set) var retryAt: Date?
    private(set) var created: ActivityMapAPI.CreatedShareLink?
    private(set) var url: URL?

    init(activities: [Activity]) { self.activities = activities }

    var scopeError: String? {
        guard !activities.isEmpty else { return "Select at least one activity to share." }
        guard activities.count <= 200 else { return "A link can share up to 200 activities. Choose a smaller selection." }
        return nil
    }

    func create(using service: ActivitySharingService) async {
        guard step == .configure, !isBusy, scopeError == nil,
              retryAt.map({ $0 <= .now }) ?? true else { return }
        isBusy = true; errorMessage = nil; retryAt = nil
        defer { isBusy = false }
        let request = ActivityMapAPI.CreateShareLinkRequest(activityIds: activities.map { String($0.id) },
            expiresInMs: expiresInHours * 3_600_000, fields: .init(showRouteEnds: showRouteEnds))
        do {
            let (link, deployment) = try await service.perform { source, deployment in
                (try await source.create(request), deployment)
            }
            // Tokens stay in memory only; the saved link list never contains them.
            guard link.token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }),
                  !link.token.isEmpty else { throw SharingError.unavailable("The server returned an invalid share link.") }
            created = link
            url = deployment.appending(path: "share").appending(path: link.token)
            step = .created
        } catch is CancellationError { }
        catch let error as APIClient.RequestError {
            switch error {
            case .rateLimited(let delay, _):
                retryAt = .now.addingTimeInterval(delay)
                errorMessage = "Too many requests. Try again after the time below."
            case .server(_, let message, _, _, _, let delay):
                retryAt = delay.map { .now.addingTimeInterval($0) }; errorMessage = message
            case .transport, .decoding:
                errorMessage = "Creation could not be confirmed. Check Your links before creating another link."
            default: errorMessage = error.description
            }
        } catch { errorMessage = error.localizedDescription }
    }
}

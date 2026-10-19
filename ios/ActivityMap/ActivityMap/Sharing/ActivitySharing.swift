import Foundation
import Observation
import SwiftUI

@MainActor @Observable
final class ActivitySharingService {
    var session: () -> SyncSession? = { nil }
    var source: (SyncSession) -> any ShareLinksSource = { ShareLinksAPI(baseURL: $0.deployment, token: $0.token) }

    var unavailableReason: String? {
        guard let session = session(), session.user.authentication.sessionExpiresAt > .now else {
            return String(localized: AppMessages.errorSharingSignInToShareActivities())
        }
        guard session.verified, session.user.stravaConnected else {
            return String(localized: AppMessages.errorSharingReconnectAndSyncBeforeSharingActivities())
        }
        return nil
    }

    func perform<T>(_ operation: (any ShareLinksSource, URL) async throws -> T) async throws -> T {
        guard unavailableReason == nil, let captured = session() else {
            throw SharingError.unavailable(unavailableReason ?? String(localized: AppMessages.errorSharingSignInToShareActivities()))
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
    private(set) var errorText: PresentationText?
    var errorMessage: String? { errorMessage(locale: .current) }
    func errorMessage(locale: Locale) -> String? { errorText?.string(locale: locale) }
    private(set) var retryAt: Date?
    private(set) var created: ActivityMapAPI.CreatedShareLink?
    private(set) var url: URL?

    init(activities: [Activity]) { self.activities = activities }

    var scopeError: String? {
        guard !activities.isEmpty else { return String(localized: AppMessages.errorSharingSelectAtLeastOneActivityToShare()) }
        guard activities.count <= 200 else { return String(localized: AppMessages.errorSharingALinkCanShareUpToActivitiesChoose()) }
        return nil
    }

    func create(using service: ActivitySharingService) async {
        guard step == .configure, !isBusy, scopeError == nil,
              retryAt.map({ $0 <= .now }) ?? true else { return }
        isBusy = true; errorText = nil; retryAt = nil
        defer { isBusy = false }
        let request = ActivityMapAPI.CreateShareLinkRequest(activityIds: activities.map { String($0.id) },
            expiresInMs: expiresInHours * 3_600_000, fields: .init(showRouteEnds: showRouteEnds))
        do {
            let (link, deployment) = try await service.perform { source, deployment in
                (try await source.create(request), deployment)
            }
            // Tokens stay in memory only; the saved link list never contains them.
            guard link.token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }),
                  !link.token.isEmpty else { throw SharingError.unavailable(String(localized: AppMessages.errorSharingTheServerReturnedAnInvalidShareLink())) }
            created = link
            url = deployment.appending(path: "share").appending(path: link.token)
            step = .created
        } catch is CancellationError { }
        catch let error as APIClient.RequestError {
            let facts = error.facts
            switch error {
            case .rateLimited:
                retryAt = facts.retryAfter.map { .now.addingTimeInterval($0) }
                errorText = .localized(AppMessages.errorSharingTooManyRequestsTryAgainAfterTheTime())
            case .server(_, let message, _, _, _, _):
                retryAt = facts.retryAfter.map { .now.addingTimeInterval($0) }
                errorText = .verbatim(message)
            case .transport, .decoding:
                errorText = .localized(AppMessages.errorSharingCreationCouldNotBeConfirmedCheckYourLinks())
            default: errorText = .verbatim(error.description)
            }
        } catch { errorText = .verbatim(error.localizedDescription) }
    }
}

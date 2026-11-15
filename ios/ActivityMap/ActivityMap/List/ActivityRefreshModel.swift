import Foundation
import Observation

/// Retained per activity by the command service, so reopening details cannot
/// bypass a server retry deadline or start a second refresh.
@MainActor @Observable
final class ActivityRefreshModel {
    private(set) var isRefreshing = false
    private(set) var didRefresh = false
    private(set) var message: PresentationText?
    private(set) var retryAt: Date?

    func canRefresh(now: Date = .now) -> Bool {
        !isRefreshing && (retryAt.map { $0 <= now } ?? true)
    }

    func refresh(activityID: Int, using service: ActivityEditingService, now: Date? = nil) async {
        guard canRefresh(now: now ?? .now), !service.mutationInProgress else { return }
        didRefresh = false
        if let reason = service.refreshUnavailableReason() { message = .verbatim(reason); return }
        isRefreshing = true
        message = nil
        defer { isRefreshing = false }
        do {
            let result = try await service.refresh(activityID: activityID)
            retryAt = result.photosError?.retryAfterSeconds.map { (now ?? .now).addingTimeInterval(Double($0)) }
            didRefresh = result.photosStatus == .complete
            if !didRefresh { message = .localized(AppMessages.mutationPartialDescription()) }
        } catch ActivityEditingError.unavailable(let reason) {
            message = .verbatim(reason)
        } catch ActivityEditingError.reconciliation {
            message = .localized(AppMessages.mutationCacheFailureDescription())
        } catch let error as APIClient.RequestError {
            retryAt = error.facts.retryAfter.map { (now ?? .now).addingTimeInterval($0) }
            message = .verbatim(error.description)
        } catch {
            message = .localized(AppMessages.mutationRefreshErrorDescription())
        }
    }
}

import Foundation
import Observation

/// One shared mutation coordinator, with an independent draft for each editor.
@MainActor @Observable
final class ActivityEditingService {
    weak var coordinator: SyncController?

    var unavailableReason: String? {
        guard let coordinator, let session = coordinator.session else { return "Sign in to edit this activity." }
        guard coordinator.status != .expired else { return "Sign in again to edit this activity." }
        guard session.user.authentication.sessionExpiresAt > Date() else { return "Sign in again to edit this activity." }
        guard session.user.stravaConnected else { return "Connect Strava again to edit this activity." }
        guard session.user.stravaPermissions?.edit != false else {
            return "Connect with Strava again in Settings and allow ActivityMap to edit activities."
        }
        guard session.verified, coordinator.status != .offline else { return "Reconnect and sync before saving to Strava. Your draft stays here." }
        return nil
    }

    func save(activityID: Int, fields: ActivityMapAPI.UpdateActivityRequest) async throws {
        guard let coordinator else { throw ActivityEditingError.unavailable("Sign in to edit this activity.") }
        try await coordinator.updateActivity(activityID: activityID, fields: fields)
    }
}

nonisolated enum ActivityEditingError: Error {
    case unavailable(String)
    case reconciliation
}

@MainActor @Observable
final class ActivityEditModel {
    let activityID: Int
    private let originalName: String
    private let originalDescription: String
    private let originalSport: SportType
    var name: String
    var description: String
    var sport: SportType
    private(set) var isSaving = false
    private(set) var didSave = false
    private(set) var errorMessage: String?
    private(set) var retryAt: Date?
    private(set) var requiresReconciliation = false

    init(activity: Activity) {
        activityID = activity.id
        originalName = activity.name; name = activity.name
        originalDescription = activity.description ?? ""; description = activity.description ?? ""
        originalSport = activity.sportType; sport = activity.sportType
    }

    var isDirty: Bool { name != originalName || description != originalDescription || sport != originalSport }
    var validationMessage: String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Enter an activity name." }
        if name.utf16.count > 255 { return "Keep the name within 255 characters." }
        if description.utf16.count > 10_000 { return "Keep the description within 10,000 characters." }
        return nil
    }

    /// Omitted fields preserve concurrent upstream changes; empty prose clears it.
    var fields: ActivityMapAPI.UpdateActivityRequest {
        .init(name: name == originalName ? nil : name,
              description: description == originalDescription ? nil : description,
              sportType: sport == originalSport ? nil : ActivityMapAPI.SportType(rawValue: sport.rawValue))
    }

    func canSave(now: Date = .now) -> Bool {
        isDirty && validationMessage == nil && !isSaving && !didSave && !requiresReconciliation
            && (retryAt.map { $0 <= now } ?? true)
    }

    func save(using service: ActivityEditingService, now: Date = .now) async {
        guard canSave(now: now) else { return }
        if let reason = service.unavailableReason { errorMessage = reason; return }
        isSaving = true; errorMessage = nil
        defer { isSaving = false }
        do {
            try await service.save(activityID: activityID, fields: fields)
            didSave = true
        } catch is CancellationError {
            errorMessage = "Saving was interrupted. Check Strava and sync before trying again."
            requiresReconciliation = true
        } catch ActivityEditingError.unavailable(let message) {
            errorMessage = message
        } catch ActivityEditingError.reconciliation {
            errorMessage = "Strava accepted your changes, but this device could not apply them. Close this editor and sync before editing again."
            requiresReconciliation = true
        } catch let error as APIClient.RequestError {
            switch error {
            case .rateLimited(let delay, _):
                retryAt = now.addingTimeInterval(delay)
                errorMessage = "Strava is busy. Your draft is kept; try again after the time below."
            case .serviceUnavailable(let delay, _):
                retryAt = delay.map { now.addingTimeInterval($0) }
                errorMessage = "The server is unavailable. Your draft is kept."
            case .server(let code, let message, _, _, _, let delay):
                retryAt = delay.map { now.addingTimeInterval($0) }
                errorMessage = message
                if ["local_state_conflict", "local_persistence_failed"].contains(code) {
                    requiresReconciliation = true
                    errorMessage = message + " Close this editor and sync before editing again."
                }
            case .transport:
                errorMessage = "The save could not be confirmed. Your draft is kept. Check Strava and sync before trying again."
                requiresReconciliation = true
            default:
                errorMessage = "The save could not be confirmed. Close this editor and sync before editing again."
                requiresReconciliation = true
            }
        } catch {
            errorMessage = "The save could not be confirmed. Close this editor and sync before editing again."
            requiresReconciliation = true
        }
    }
}

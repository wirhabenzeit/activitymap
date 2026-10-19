import Foundation
import Observation

/// One shared mutation coordinator, with an independent draft for each editor.
@MainActor @Observable
final class ActivityEditingService {
    weak var coordinator: SyncController?

    var unavailableReason: String? { unavailableReason(locale: .current) }
    func unavailableReason(locale: Locale) -> String? {
        guard let coordinator, let session = coordinator.session else { return String(localized: AppMessages.errorEditSignInToEditThisActivity(locale: locale)) }
        guard coordinator.status != .expired else { return String(localized: AppMessages.errorEditSignInAgainToEditThisActivity(locale: locale)) }
        guard session.user.authentication.sessionExpiresAt > Date() else { return String(localized: AppMessages.errorEditSignInAgainToEditThisActivity(locale: locale)) }
        guard session.user.stravaConnected else { return String(localized: AppMessages.errorEditConnectStravaAgainToEditThisActivity(locale: locale)) }
        guard session.user.stravaPermissions?.edit != false else {
            return String(localized: AppMessages.errorEditConnectWithStravaAgainInSettingsAndAllow(locale: locale))
        }
        guard session.verified, coordinator.status != .offline else { return String(localized: AppMessages.errorEditReconnectAndSyncBeforeSavingToStravaYour(locale: locale)) }
        return nil
    }

    func save(activityID: Int, fields: ActivityMapAPI.UpdateActivityRequest) async throws {
        guard let coordinator else { throw ActivityEditingError.unavailable(String(localized: AppMessages.errorEditSignInToEditThisActivity())) }
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
    private(set) var errorText: PresentationText?
    var errorMessage: String? { errorMessage(locale: .current) }
    func errorMessage(locale: Locale) -> String? { errorText?.string(locale: locale) }
    private(set) var retryAt: Date?
    private(set) var requiresReconciliation = false

    init(activity: Activity) {
        activityID = activity.id
        originalName = activity.name; name = activity.name
        originalDescription = activity.description ?? ""; description = activity.description ?? ""
        originalSport = activity.sportType; sport = activity.sportType
    }

    var isDirty: Bool { name != originalName || description != originalDescription || sport != originalSport }
    var validationMessage: String? { validationMessage(locale: .current) }
    func validationMessage(locale: Locale) -> String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return String(localized: AppMessages.activityEditValidationName(locale: locale)) }
        if name.utf16.count > 255 { return String(localized: AppMessages.activityEditNameLength(255, locale: locale)) }
        if description.utf16.count > 10_000 { return String(localized: AppMessages.activityEditDescriptionLength(10_000, locale: locale)) }
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
        if let reason = service.unavailableReason { errorText = .verbatim(reason); return }
        isSaving = true; errorText = nil
        defer { isSaving = false }
        do {
            try await service.save(activityID: activityID, fields: fields)
            didSave = true
        } catch is CancellationError {
            errorText = .localized(AppMessages.errorEditSavingWasInterruptedCheckStravaAndSyncBefore())
            requiresReconciliation = true
        } catch ActivityEditingError.unavailable(let message) {
            errorText = .verbatim(message)
        } catch ActivityEditingError.reconciliation {
            errorText = .localized(AppMessages.errorEditStravaAcceptedYourChangesButThisDeviceCould())
            requiresReconciliation = true
        } catch let error as APIClient.RequestError {
            retryAt = error.facts.retryAfter.map { now.addingTimeInterval($0) }
            switch error {
            case .rateLimited:
                errorText = .localized(AppMessages.errorEditStravaIsBusyYourDraftIsKeptTry())
            case .serviceUnavailable:
                errorText = .localized(AppMessages.errorEditTheServerIsUnavailableYourDraftIsKept())
            case .server(let code, let message, _, _, _, _):
                errorText = .verbatim(message)
                if ["local_state_conflict", "local_persistence_failed"].contains(code) {
                    requiresReconciliation = true
                    errorText = .localized(AppMessages.errorEditServerReconciliation(message))
                }
            case .transport:
                errorText = .localized(AppMessages.errorEditTheSaveCouldNotBeConfirmedYourDraft())
                requiresReconciliation = true
            default:
                errorText = .localized(AppMessages.errorEditTheSaveCouldNotBeConfirmedCloseThis())
                requiresReconciliation = true
            }
        } catch {
            errorText = .localized(AppMessages.errorEditTheSaveCouldNotBeConfirmedCloseThis())
            requiresReconciliation = true
        }
    }
}

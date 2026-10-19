import Foundation

/// A presentation of the existing sync/filter/cache state. It never owns data,
/// expires a cache by age, changes selection, or requests activity streams.
struct BrowsingPresentation: Equatable {
    enum Recovery: Equatable {
        case clearFilters, retry, account, showList, cancelSync
        var title: String { title() }
        func title(locale: Locale = .current) -> String {
            switch self {
            case .clearFilters: String(localized: AppMessages.statusBrowsingClearFilters(locale: locale))
            case .retry: String(localized: AppMessages.statusBrowsingRetrySync(locale: locale))
            case .account: String(localized: AppMessages.statusBrowsingConnectWithStrava(locale: locale))
            case .showList: String(localized: AppMessages.statusBrowsingViewActivitiesInList(locale: locale))
            case .cancelSync: String(localized: AppMessages.statusBrowsingPauseSync(locale: locale))
            }
        }
    }
    enum EmptyKind: Hashable {
        case preparing, signingIn, firstSync, emptyLibrary, noMatches, noRoutes
        case signedOut, expired, disconnected, offline, failed, paused, waiting
    }
    struct EmptyState: Equatable {
        let kind: EmptyKind
        let title: String
        let message: String
        let symbol: String
        var recovery: Recovery?
        var progress = false
    }

    let empty: EmptyState?
    let statusTitle: String
    let statusMessage: String
    let recovery: Recovery?
    let lastSync: Date?
    let reconciliation: Date?
    let retryAfter: Date?
    let photoMetadataCount: Int
    let isSyncing: Bool

    init(store: ActivityStore, sync: SyncController?, isSigningIn: Bool = false, locale: Locale = .current) {
        let filtered = store.browsingActivities
        self.init(tab: store.selectedTab, activityCount: store.activities.count,
                  filteredCount: filtered.count,
                  routeCount: store.selectedTab == .map && !store.routableActivityIDs.isDisjoint(with: store.visibleActivityIDs) ? 1 : 0,
                  status: sync?.status, hasCompletedCache: sync?.hasCompletedCache ?? !store.activities.isEmpty,
                  canRetry: sync?.canRefresh ?? false, isSigningIn: isSigningIn,
                  lastSync: sync?.lastSyncAt, reconciliation: sync?.lastReconciliationAt,
                  retryAfter: sync?.retryNotBefore, photoMetadataCount: sync?.photos.count ?? 0, locale: locale)
    }

    init(tab: AppTab, activityCount: Int, filteredCount: Int, routeCount: Int,
         status: SyncController.Status?, hasCompletedCache: Bool, canRetry: Bool,
         isSigningIn: Bool = false, lastSync: Date? = nil, reconciliation: Date? = nil,
         retryAfter: Date? = nil, photoMetadataCount: Int = 0, locale: Locale = .current) {
        self.lastSync = lastSync
        self.reconciliation = reconciliation
        self.retryAfter = retryAfter
        self.photoMetadataCount = photoMetadataCount
        isSyncing = status == .syncing || isSigningIn
        let cached = hasCompletedCache
        let retry: Recovery? = canRetry ? .retry : nil
        var blocking: EmptyState?
        let title: String
        let message: String
        let recovery: Recovery?
        if isSigningIn {
            title = String(localized: AppMessages.statusBrowsingConnectingToStrava(locale: locale))
            message = String(localized: AppMessages.statusBrowsingApproveOrCancelInTheStravaSheetToContinue(locale: locale))
            recovery = nil
            blocking = EmptyState(kind: .signingIn, title: title, message: message, symbol: "person.crop.circle", progress: true)
        } else {
            switch status {
            case nil:
                title = String(localized: AppMessages.statusBrowsingPreparingActivityData(locale: locale))
                message = String(localized: AppMessages.statusBrowsingReadingYourSavedSessionAndActivities(locale: locale))
                recovery = nil
                if activityCount == 0 { blocking = EmptyState(kind: .preparing, title: title, message: message, symbol: "tray", progress: true) }
            case .signedOut:
                title = String(localized: AppMessages.statusBrowsingConnectStravaToSeeYourActivities(locale: locale))
                message = StravaConnectCopy.purpose
                recovery = .account
                blocking = EmptyState(kind: .signedOut, title: title, message: message, symbol: "person.crop.circle", recovery: recovery)
            case .expired:
                title = String(localized: AppMessages.statusBrowsingYourSignInHasExpired(locale: locale))
                message = String(localized: AppMessages.statusBrowsingConnectWithStravaAgainToRestoreAccessToYour(locale: locale))
                recovery = .account
                blocking = EmptyState(kind: .expired, title: title, message: message, symbol: "lock", recovery: recovery)
            case .disconnected:
                title = String(localized: AppMessages.statusBrowsingStravaIsDisconnected(locale: locale))
                message = String(localized: AppMessages.statusBrowsingConnectWithStravaAgainToLoadYourActivities(locale: locale))
                recovery = .account
                blocking = EmptyState(kind: .disconnected, title: title, message: message, symbol: "link", recovery: recovery)
            case .syncing:
                title = cached ? String(localized: AppMessages.statusBrowsingSyncingSavedActivitiesAvailable(locale: locale)) : String(localized: AppMessages.statusBrowsingLoadingYourActivityLibrary(locale: locale))
                message = cached ? String(localized: AppMessages.statusBrowsingKeepBrowsingWhileChangesAreDownloaded(locale: locale)) : String(localized: AppMessages.statusBrowsingTheFirstSyncDownloadsActivityAndPhotoMetadataYou(locale: locale))
                recovery = .cancelSync
                if !cached { blocking = EmptyState(kind: .firstSync, title: title, message: message, symbol: "arrow.trianglehead.2.clockwise", recovery: recovery, progress: true) }
            case .ready:
                title = String(localized: AppMessages.statusBrowsingActivitySyncComplete(locale: locale))
                message = String(localized: AppMessages.statusBrowsingLastSyncAndStravaReconciliationAreSeparateChecks(locale: locale))
                recovery = nil
            case .offline:
                title = cached ? String(localized: AppMessages.statusBrowsingOfflineBrowsingSavedActivities(locale: locale)) : String(localized: AppMessages.statusBrowsingOfflineNoCompletedActivityCache(locale: locale))
                message = cached ? String(localized: AppMessages.statusBrowsingYourSavedActivityDataRemainsAvailableReconnectToSync(locale: locale)) : String(localized: AppMessages.statusBrowsingConnectToTheInternetAndRetryToFinishLoading(locale: locale))
                recovery = retry
                if !cached { blocking = EmptyState(kind: .offline, title: title, message: message, symbol: "wifi.slash", recovery: recovery) }
            case .failed:
                title = cached ? String(localized: AppMessages.statusBrowsingSyncFailedSavedActivitiesAvailable(locale: locale)) : String(localized: AppMessages.statusBrowsingCouldnTLoadActivities(locale: locale))
                message = cached ? String(localized: AppMessages.statusBrowsingYourSavedLibraryIsStillReadableRetryToLoad(locale: locale)) : String(localized: AppMessages.statusBrowsingSyncDidNotCompleteRetryOrReviewSyncDetails(locale: locale))
                recovery = retry
                if !cached { blocking = EmptyState(kind: .failed, title: title, message: message, symbol: "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90", recovery: recovery) }
            case .paused:
                title = String(localized: AppMessages.statusBrowsingActivitySyncPaused(locale: locale))
                message = cached ? String(localized: AppMessages.statusBrowsingYourSavedLibraryIsStillReadableRetryWhenYou(locale: locale)) : String(localized: AppMessages.statusBrowsingLoadingWasPausedRetryToFinishDownloadingYourLibrary(locale: locale))
                recovery = retry
                if !cached { blocking = EmptyState(kind: .paused, title: title, message: message, symbol: "pause.circle", recovery: recovery) }
            case .rateLimited, .retryAfter:
                title = cached ? String(localized: AppMessages.statusBrowsingSyncWaitingSavedActivitiesAvailable(locale: locale)) : String(localized: AppMessages.statusBrowsingSyncWaitingForTheServer(locale: locale))
                message = String(localized: AppMessages.statusBrowsingRetryIsAvailableAfterTheServerSRequestedWait(locale: locale))
                recovery = retry
                if !cached { blocking = EmptyState(kind: .waiting, title: title, message: message, symbol: "clock", recovery: recovery) }
            }
        }
        statusTitle = title
        statusMessage = message
        self.recovery = recovery
        empty = blocking ?? Self.resultEmpty(tab: tab, activityCount: activityCount,
                                              filteredCount: filteredCount, routeCount: routeCount, retry: retry, locale: locale)
    }

    /// Evaluate only after session/completeness guards. A completed offline or
    /// stale cache still has ordinary empty-library / no-matching-result states.
    static func resultEmpty(tab: AppTab, activityCount: Int, filteredCount: Int,
                            routeCount: Int = 0, retry: Recovery? = nil, locale: Locale = .current) -> EmptyState? {
        if activityCount == 0 {
            return EmptyState(kind: .emptyLibrary, title: String(localized: AppMessages.statusBrowsingNoActivitiesInYourLibrary(locale: locale)),
                              message: String(localized: AppMessages.statusBrowsingTheCompletedSyncContainsNoActivitiesRecordAnActivity(locale: locale)), symbol: "tray", recovery: retry)
        } else if filteredCount == 0 {
            return EmptyState(kind: .noMatches, title: String(localized: AppMessages.statusBrowsingNoActivitiesMatchYourFilters(locale: locale)),
                              message: String(localized: AppMessages.statusBrowsingYourLibraryIsStillSavedClearFiltersOrChange(locale: locale)), symbol: "line.3.horizontal.decrease", recovery: .clearFilters)
        } else if tab == .map && routeCount == 0 {
            return EmptyState(kind: .noRoutes, title: String(localized: AppMessages.statusBrowsingTheseActivitiesHaveNoGPSRoutes(locale: locale)),
                              message: String(localized: AppMessages.statusBrowsingNoRoutesMessage(filteredCount, locale: locale)), symbol: "map", recovery: .showList)
        }
        return nil
    }
}

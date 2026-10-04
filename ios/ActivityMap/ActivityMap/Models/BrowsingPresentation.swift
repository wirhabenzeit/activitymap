import Foundation

/// A presentation of the existing sync/filter/cache state. It never owns data,
/// expires a cache by age, changes selection, or requests activity streams.
struct BrowsingPresentation: Equatable {
    enum Recovery: Equatable {
        case clearFilters, retry, account, showList, cancelSync
        var title: String {
            switch self {
            case .clearFilters: "Clear Filters"
            case .retry: "Retry Sync"
            case .account: "Open Sign-In"
            case .showList: "View Activities in List"
            case .cancelSync: "Pause Sync"
            }
        }
    }
    enum EmptyKind: Equatable {
        case preparing, firstSync, emptyLibrary, noMatches, noRoutes
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

    init(store: ActivityStore, sync: SyncController?, isSigningIn: Bool = false) {
        let filtered = store.filteredActivities
        self.init(tab: store.selectedTab, activityCount: store.activities.count,
                  filteredCount: filtered.count,
                  routeCount: store.selectedTab == .map && !store.routableActivityIDs.isDisjoint(with: store.visibleActivityIDs) ? 1 : 0,
                  status: sync?.status, hasCompletedCache: sync?.hasCompletedCache ?? !store.activities.isEmpty,
                  canRetry: sync?.canRefresh ?? false, isSigningIn: isSigningIn,
                  lastSync: sync?.lastSyncAt, reconciliation: sync?.lastReconciliationAt,
                  retryAfter: sync?.retryNotBefore, photoMetadataCount: sync?.photos.count ?? 0)
    }

    init(tab: AppTab, activityCount: Int, filteredCount: Int, routeCount: Int,
         status: SyncController.Status?, hasCompletedCache: Bool, canRetry: Bool,
         isSigningIn: Bool = false, lastSync: Date? = nil, reconciliation: Date? = nil,
         retryAfter: Date? = nil, photoMetadataCount: Int = 0) {
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
            title = "Signing in…"
            message = "Complete or cancel the Strava sign-in sheet to continue."
            recovery = nil
            blocking = EmptyState(kind: .preparing, title: title, message: message, symbol: "person.crop.circle", progress: true)
        } else {
            switch status {
            case nil:
                title = "Preparing activity data"
                message = "Reading your saved session and activities."
                recovery = nil
                if activityCount == 0 { blocking = EmptyState(kind: .preparing, title: title, message: message, symbol: "tray", progress: true) }
            case .signedOut:
                title = "Sign in to load activities"
                message = "Connect your ActivityMap account with Strava to load your library."
                recovery = .account
                blocking = EmptyState(kind: .signedOut, title: title, message: message, symbol: "person.crop.circle", recovery: recovery)
            case .expired:
                title = "Your sign-in has expired"
                message = "Sign in again to restore access to your activities."
                recovery = .account
                blocking = EmptyState(kind: .expired, title: title, message: message, symbol: "lock", recovery: recovery)
            case .disconnected:
                title = "Strava is disconnected"
                message = "Reconnect Strava from your account to load activities again."
                recovery = .account
                blocking = EmptyState(kind: .disconnected, title: title, message: message, symbol: "link", recovery: recovery)
            case .syncing:
                title = cached ? "Syncing · saved activities available" : "Loading your activity library"
                message = cached ? "Keep browsing while changes are downloaded." : "The first sync downloads activity and photo metadata. You can pause and retry."
                recovery = .cancelSync
                if !cached { blocking = EmptyState(kind: .firstSync, title: title, message: message, symbol: "arrow.trianglehead.2.clockwise", recovery: recovery, progress: true) }
            case .ready:
                title = "Activity sync complete"
                message = "Last sync and Strava reconciliation are separate checks."
                recovery = nil
            case .offline:
                title = cached ? "Offline · browsing saved activities" : "Offline · no completed activity cache"
                message = cached ? "Your saved activity data remains available. Reconnect to sync changes." : "Connect to the internet and retry to finish loading your library."
                recovery = retry
                if !cached { blocking = EmptyState(kind: .offline, title: title, message: message, symbol: "wifi.slash", recovery: recovery) }
            case .failed:
                title = cached ? "Sync failed · saved activities available" : "Couldn’t load activities"
                message = cached ? "Your saved library is still readable. Retry to load changes." : "Sync did not complete. Retry, or review Sync Details for the error."
                recovery = retry
                if !cached { blocking = EmptyState(kind: .failed, title: title, message: message, symbol: "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90", recovery: recovery) }
            case .paused:
                title = "Activity sync paused"
                message = cached ? "Your saved library is still readable. Retry when you’re ready." : "Loading was paused. Retry to finish downloading your library."
                recovery = retry
                if !cached { blocking = EmptyState(kind: .paused, title: title, message: message, symbol: "pause.circle", recovery: recovery) }
            case .rateLimited, .retryAfter:
                title = cached ? "Sync waiting · saved activities available" : "Sync waiting for the server"
                message = "Retry is available after the server’s requested wait. Sync Details shows the exact time."
                recovery = retry
                if !cached { blocking = EmptyState(kind: .waiting, title: title, message: message, symbol: "clock", recovery: recovery) }
            }
        }
        statusTitle = title
        statusMessage = message
        self.recovery = recovery
        if let blocking { empty = blocking }
        else if activityCount == 0 {
            empty = EmptyState(kind: .emptyLibrary, title: "No activities in your library",
                               message: "The completed sync contains no activities. Record an activity in Strava, then sync again.", symbol: "tray", recovery: retry)
        } else if filteredCount == 0 {
            empty = EmptyState(kind: .noMatches, title: "No activities match your filters",
                               message: "Your library is still saved. Clear filters or change a restriction to see activities.", symbol: "line.3.horizontal.decrease", recovery: .clearFilters)
        } else if tab == .map && routeCount == 0 {
            empty = EmptyState(kind: .noRoutes, title: "These activities have no GPS routes",
                               message: "\(filteredCount) filtered activities remain available in the list, including their measurements and known photo metadata.", symbol: "map", recovery: .showList)
        } else { empty = nil }
    }
}

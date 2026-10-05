import Testing
@testable import ActivityMap

@MainActor
struct StravaConnectTests {
    @Test func syntheticFallbackAddressesAreNotShownAsIdentity() {
        #expect(displayEmail("123456@strava.local") == nil)
        #expect(displayEmail("123456@STRAVA.LOCAL") == nil)
        #expect(displayEmail(nil) == nil)
        #expect(displayEmail("ada@example.com") == "ada@example.com")
    }

    @Test func connectRecoveryIsTheStravaActionNotAProfileDetour() {
        #expect(BrowsingPresentation.Recovery.account.title == "Connect with Strava")
        let signedOut = BrowsingPresentation(tab: .list, activityCount: 0, filteredCount: 0, routeCount: 0,
                                             status: .signedOut, hasCompletedCache: false, canRetry: false)
        #expect(signedOut.empty?.recovery == .account)
        #expect(signedOut.empty?.message == StravaConnectCopy.purpose)
    }

    @Test func onlyStatesThatNeedStravaShowTheShellPrompt() {
        #expect(StravaConnectPrompt(status: .signedOut)?.message == StravaConnectCopy.purpose)
        #expect(StravaConnectPrompt(status: .expired) != nil)
        #expect(StravaConnectPrompt(status: .disconnected) != nil)
        for status: SyncController.Status? in [nil, .syncing, .ready, .offline, .paused, .failed("503")] {
            #expect(StravaConnectPrompt(status: status) == nil)
        }
    }

    @Test func aFreshControllerIsNotFailedAndCancellingIsNotAFailure() {
        let auth = AuthController()
        #expect(!auth.signInFailed)
    }
}

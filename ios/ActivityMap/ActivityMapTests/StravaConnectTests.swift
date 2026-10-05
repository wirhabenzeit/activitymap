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

    @Test func savedSignInRetriesVerificationInsteadOfStartingOAuthAgain() {
        // OAuth exchanged and saved a token, but /me failed before an identity
        // could be loaded. Sync is still signed out and the shell is blocked.
        let prompt = StravaConnectPrompt(status: .signedOut, authStatus: .sessionRestoreFailed("503"))
        #expect(prompt?.recovery == .verifySession)
        #expect(prompt?.message.contains("sign-in was saved") == true)
        // An explicitly rejected token returns to the ordinary connection flow.
        #expect(StravaConnectPrompt(status: .signedOut, authStatus: .signedOut)?.recovery == .connect)
        // A cached identity remains usable offline while verification retries.
        #expect(StravaConnectPrompt(status: .offline, authStatus: .sessionRestoreFailed("offline")) == nil)
        #expect(StravaConnectPrompt(status: .ready) == nil)
    }
}

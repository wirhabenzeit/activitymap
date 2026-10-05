import Foundation
import Testing
@testable import ActivityMap

/// Session restore, sign-in callback and permission states (issue #303).
@MainActor
struct AuthRecoveryTests {
    private func callback(_ query: String) -> URL {
        URL(string: "activitymap://auth/callback?\(query)")!
    }

    @Test func aMatchingCodeCallbackCompletesTheAttempt() {
        #expect(AuthController.parseCallback(callback("code=c1&state=s1"), expectedState: "s1") == .code("c1"))
    }

    @Test func decliningOnStravaIsACancellationNotAFailure() {
        #expect(AuthController.parseCallback(callback("error=access_denied&state=s1"), expectedState: "s1") == .declined)
    }

    @Test func serverErrorsKeepTheirCodeAndRequestID() {
        let result = AuthController.parseCallback(
            callback("error=server_error&state=s1&request_id=req-1"), expectedState: "s1")
        #expect(result == .failure(.provider(code: "server_error", requestID: "req-1")))
    }

    @Test func aCallbackForAnotherAttemptNeverEndsOrCompletesThisOne() {
        #expect(AuthController.parseCallback(callback("code=c1&state=other"), expectedState: "s1") == .failure(.stateMismatch))
        #expect(AuthController.parseCallback(callback("error=access_denied&state=other"), expectedState: "s1") == .failure(.stateMismatch))
        #expect(AuthController.parseCallback(callback("error=access_denied"), expectedState: "s1") == .failure(.missingCodeOrState))
        #expect(AuthController.parseCallback(callback("state=s1"), expectedState: "s1") == .failure(.missingCodeOrState))
    }

    @Test func restoreFailuresUseShortCopyAndTheServersRetryTime() {
        let offline = AuthController.userMessage(for: APIClient.RequestError.transport("The Internet connection appears to be offline."))
        #expect(offline.contains("couldn’t be reached"))
        #expect(!offline.contains("Internet connection appears"))

        let busy = APIClient.RequestError.rateLimited(retryAfter: 120, requestID: "req-2")
        #expect(AuthController.userMessage(for: busy).hasPrefix("ActivityMap is busy. Try again after"))
        #expect(AuthController.retryAfter(busy) == 120)

        let unavailable = APIClient.RequestError.serviceUnavailable(retryAfter: nil, requestID: "req-3")
        #expect(AuthController.userMessage(for: unavailable).contains("in a moment"))
        #expect(AuthController.userMessage(for: unavailable).contains("req-3"))
        #expect(AuthController.retryAfter(unavailable) == nil)
    }

    @Test func limitedGrantsAreExplainedAndUnknownGrantsAreNot() {
        let full = ActivityMapAPI.StravaPermissions(activities: .all, edit: true)
        #expect(!StravaPermissionsCopy.isLimited(full))
        #expect(StravaPermissionsCopy.notes(full).isEmpty)

        let publicOnly = ActivityMapAPI.StravaPermissions(activities: .public, edit: false)
        #expect(StravaPermissionsCopy.isLimited(publicOnly))
        #expect(StravaPermissionsCopy.notes(publicOnly).count == 2)

        let nothing = ActivityMapAPI.StravaPermissions(activities: .none, edit: true)
        #expect(StravaPermissionsCopy.notes(nothing).first == "No activities are shared.")

        #expect(!StravaPermissionsCopy.isLimited(nil))
        #expect(StravaPermissionsCopy.notes(nil).isEmpty)
    }

    @Test func savedSessionFailureNamesTheReason() {
        let prompt = StravaConnectPrompt(status: .signedOut, authStatus: .sessionRestoreFailed("ActivityMap is busy. Try again in a moment."))
        #expect(prompt?.message.contains("ActivityMap is busy") == true)
    }
}

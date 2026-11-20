import Foundation
import Testing
@testable import ActivityMap

/// Issue #482: devices return from sign-in through an https universal link
/// only this app can receive; the simulator and Dev build keep a custom scheme.
struct AuthCallbackConfigurationTests {
    @Test func httpsRedirectUsesAnHTTPSCallbackOnItsHostAndPath() throws {
        let url = try APIConfiguration.validateRedirectURI(
            "https://activitymap.cc/auth/callback", expectedScheme: "activitymap", key: "k")
        #expect(APIConfiguration.authCallback(for: url) == .https(host: "activitymap.cc", path: "/auth/callback"))
    }

    @Test(arguments: [
        ("activitymap://auth/callback", "activitymap"),
        ("activitymap-dev://auth/callback", "activitymap-dev"),
    ])
    func customSchemeRedirectKeepsTheCustomSchemeCallback(raw: String, scheme: String) throws {
        let url = try APIConfiguration.validateRedirectURI(raw, expectedScheme: scheme, key: "k")
        #expect(APIConfiguration.authCallback(for: url) == .customScheme(scheme))
    }

    @Test func anHTTPSRedirectNeedsAnExactPath() {
        for raw in ["https://activitymap.cc", "https://activitymap.cc/"] {
            #expect(throws: APIConfiguration.ConfigurationError.self) {
                try APIConfiguration.validateRedirectURI(raw, expectedScheme: "activitymap", key: "k")
            }
        }
    }

    @Test func aTruncatedHTTPSRedirectIsRejected() {
        // What xcconfig produces when "//" is swallowed as a comment.
        #expect(throws: APIConfiguration.ConfigurationError.self) {
            try APIConfiguration.validateRedirectURI("https:", expectedScheme: "activitymap", key: "k")
        }
    }

    @Test func aMismatchedCustomSchemeIsStillRejected() {
        #expect(throws: APIConfiguration.ConfigurationError.self) {
            try APIConfiguration.validateRedirectURI(
                "other://auth/callback", expectedScheme: "activitymap", key: "k")
        }
    }

    @Test func theConfiguredRedirectMatchesTheAppAndBundle() {
        // The simulator test host uses the custom scheme from Base.xcconfig.
        #expect(APIConfiguration.authRedirectURI.absoluteString == "activitymap://auth/callback")
        #expect(APIConfiguration.authCallback == .customScheme("activitymap"))
    }
}

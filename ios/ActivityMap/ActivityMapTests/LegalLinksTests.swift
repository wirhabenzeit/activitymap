import Foundation
import UIKit
import Testing
@testable import ActivityMap

@MainActor
struct LegalLinksTests {
    @Test func legalPagesResolveAgainstTheConfiguredDeployment() {
        let base = APIConfiguration.baseURL
        #expect(LegalLinks.privacy == base.appending(path: "privacy"))
        #expect(LegalLinks.terms == base.appending(path: "terms"))
        #expect(LegalLinks.support == base.appending(path: "support"))
        #expect(LegalLinks.privacy.path == "/privacy")
        #expect(LegalLinks.terms.path == "/terms")
        #expect(LegalLinks.support.path == "/support")
    }

    @Test func poweredByStravaArtworkShipsInTheAssetCatalog() {
        #expect(UIImage(named: "PoweredByStrava") != nil)
    }
}

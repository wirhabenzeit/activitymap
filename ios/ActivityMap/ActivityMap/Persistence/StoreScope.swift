import Foundation

/// Sessions for the same account share a cache; different deployments never do.
nonisolated struct StoreScope: Hashable, Sendable {
    let deployment: URL
    let userID: String

    var key: String {
        var base = deployment.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        return Self.key([base, userID])
    }

    // Length-prefixing avoids collisions even when user/photo IDs contain separators.
    static func key(_ parts: [String]) -> String {
        parts.map { "\($0.utf8.count):\($0)" }.joined()
    }
}

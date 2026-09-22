import CryptoKit
import Foundation

/// Remembers only an identity confirmed by /me. The token stays in Keychain;
/// its hash binds this metadata to that exact session and deployment.
nonisolated enum SessionIdentityStore {
    private struct Record: Codable {
        let deployment: String
        let tokenHash: String
        let user: ActivityMapAPI.CurrentUser
    }
    private static let key = "activitymap.verified-session"

    static func save(_ user: ActivityMapAPI.CurrentUser, token: String, deployment: URL, defaults: UserDefaults = .standard) throws {
        let record = Record(deployment: deployment.absoluteString, tokenHash: hash(token), user: user)
        defaults.set(try JSONEncoder().encode(record), forKey: key)
    }

    static func load(token: String, deployment: URL, defaults: UserDefaults = .standard) -> ActivityMapAPI.CurrentUser? {
        guard let data = defaults.data(forKey: key), let record = try? JSONDecoder().decode(Record.self, from: data),
              record.tokenHash == hash(token), record.deployment == deployment.absoluteString else { return nil }
        return record.user
    }

    static func clear(defaults: UserDefaults = .standard) { defaults.removeObject(forKey: key) }

    private static func hash(_ token: String) -> String {
        SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

import Foundation
import Security

/// Persists the ActivityMap bearer session token in the Keychain.
///
/// This is the only credential the app ever holds. It is never a Strava
/// access or refresh token — see `docs/ios-data-ingestion-plan.md`, "The iOS
/// client does not talk to the database", and the plan doc's exit criterion
/// that "the Keychain contains an ActivityMap credential, not a Strava
/// credential".
nonisolated enum SessionStore {
    enum KeychainError: Error, CustomStringConvertible {
        case writeFailed(OSStatus)

        var description: String {
            switch self {
            case .writeFailed(let status):
                "Keychain write failed with status \(status)"
            }
        }
    }

    private static let service = "page.dominik.activitymap.session"
    private static let account = "session-token"

    static func save(_ token: String) throws {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.writeFailed(status)
        }
    }

    static func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

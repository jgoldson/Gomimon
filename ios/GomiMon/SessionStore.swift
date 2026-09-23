import Foundation
import Security

struct SessionStore {
    var account = "detector-session"
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.goldentechlabs.gomimon.prototype", kSecAttrAccount as String: account] }
    func read() throws -> String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else { throw failure(status) }
        return value
    }
    func save(_ value: String) throws {
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let result = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            guard result == errSecSuccess else { throw failure(result) }
        } else if status != errSecSuccess { throw failure(status) }
        guard try read() == value else { throw failure(errSecDecode) }
    }
    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure(status) }
    }
    private func failure(_ status: OSStatus) -> ServiceFailure {
        ServiceFailure(message: status == errSecMissingEntitlement
            ? "This build is missing its Keychain signing entitlement. Install the corrected build, then sign in again."
            : "Couldn’t access secure sign-in storage (Keychain \(status)). Unlock your device and try again.", status: Int(status))
    }
    #if DEBUG
    static func verifyStorage() {
        let store = Self(account: "keychain-smoke-only")
        var checks: [String: Any] = ["checkedAt": Date().timeIntervalSince1970]
        do {
            try store.save("first")
            checks["writeRead"] = try store.read() == "first"
            try store.save("updated")
            checks["updateRead"] = try store.read() == "updated"
            try store.clear()
            checks["delete"] = try store.read() == nil
        } catch {
            checks["errorCode"] = (error as? ServiceFailure)?.status ?? 0
            checks["error"] = error.localizedDescription
        }
        UserDefaults.standard.set(checks, forKey: "keychainSmokeChecks")
    }
    #endif
}

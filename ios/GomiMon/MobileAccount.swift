import Foundation
import AuthenticationServices
import CryptoKit
import Security
import UIKit
import GoogleSignIn

struct ServiceFailure: LocalizedError {
    let message: String
    let status: Int
    var retryAfterMs: Double = 60000
    var errorDescription: String? { message }
}

@MainActor
final class MobileAccount: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    static let baseURL = URL(string: "https://gomimon-api.goldentechlabs.com")!
    private var appleController: ASAuthorizationController?
    private var appleContinuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?
    private let providerStore = SessionStore(account: "session-provider")
    private let appleUserStore = SessionStore(account: "apple-user")
    private let store = SessionStore()
    var token: String? { try? store.read() }
    func clear() { GIDSignIn.sharedInstance.signOut(); try? store.clear(); try? providerStore.clear(); try? appleUserStore.clear() }
    private func save(_ token: String) throws { try store.save(token) }
    func request(_ path: String, body: [String: Any]? = nil, authenticated: Bool = true) async throws -> [String: Any] {
        var request = URLRequest(url: Self.baseURL.appendingPathComponent(path), timeoutInterval: 25)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authenticated {
            guard let token else { throw ServiceFailure(message: "Sign in to check your chosen categories.", status: 401) }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            let details = result["error"] as? [String: Any]
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let retryString = result["retryAt"] as? String ?? result["resetAt"] as? String
            let retryDate = retryString.flatMap { formatter.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) }
            let delay = retryDate.map { max(60000, $0.timeIntervalSinceNow * 1000) } ?? 60000
            throw ServiceFailure(message: result["message"] as? String ?? details?["message"] as? String ?? (status == 429 ? "Check limit reached. Automatic checks will pause and retry." : "The detector is unavailable (\(status)). Try again shortly."), status: status, retryAfterMs: delay)
        }
        return result
    }
    func signInGoogle(link: Bool = false) async throws {
        let probe = SessionStore(account: "sign-in-storage-probe")
        try probe.save(UUID().uuidString)
        try probe.clear()
        guard let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
              clientID.hasSuffix(".apps.googleusercontent.com"),
              let serverID = Bundle.main.object(forInfoDictionaryKey: "GIDServerClientID") as? String,
              serverID.hasSuffix(".apps.googleusercontent.com") else {
            throw ServiceFailure(message: "Google sign-in is not configured in this build.", status: 0)
        }
        guard var presenter = anchor().rootViewController else {
            throw ServiceFailure(message: "Couldn’t present Google sign-in. Try again.", status: 0)
        }
        while let presented = presenter.presentedViewController { presenter = presented }
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID, serverClientID: serverID)
        let challenge = try await request("v1/auth/google/native/challenge", body: ["link": link], authenticated: link)
        guard let challengeID = challenge["challengeId"] as? String, let nonce = challenge["nonce"] as? String else {
            throw ServiceFailure(message: "Couldn’t start Google sign-in.", status: 0)
        }
        let result: GIDSignInResult = try await withCheckedThrowingContinuation { continuation in
            GIDSignIn.sharedInstance.signIn(withPresenting: presenter, hint: nil, additionalScopes: nil, nonce: nonce) { result, error in
                if let error { continuation.resume(throwing: error) }
                else if let result { continuation.resume(returning: result) }
                else { continuation.resume(throwing: ServiceFailure(message: "Google sign-in did not finish.", status: 0)) }
            }
        }
        guard let identityToken = result.user.idToken?.tokenString, !identityToken.isEmpty else {
            throw ServiceFailure(message: "Google did not return an identity token. Try again.", status: 0)
        }
        let response = try await request("v1/auth/google/native/exchange",
            body: ["challengeId": challengeID, "identityToken": identityToken], authenticated: link)
        guard let token = response["token"] as? String, !token.isEmpty else {
            throw ServiceFailure(message: "Google sign-in did not return a session.", status: 0)
        }
        try save(token)
        try providerStore.save("google")
    }
    func signInApple(link: Bool = false) async throws {
        let probe = SessionStore(account: "sign-in-storage-probe")
        try probe.save(UUID().uuidString); try probe.clear()
        let challenge = try await request("v1/auth/apple/challenge", body: ["link": link], authenticated: link)
        guard let challengeId = challenge["challengeId"] as? String, let nonce = challenge["nonce"] as? String else {
            throw ServiceFailure(message: "Couldn’t start Apple sign-in.", status: 0)
        }
        let state = try randomString()
        let appleRequest = ASAuthorizationAppleIDProvider().createRequest()
        appleRequest.requestedScopes = [.email]
        appleRequest.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        appleRequest.state = state
        let credential: ASAuthorizationAppleIDCredential = try await withCheckedThrowingContinuation { continuation in
            appleContinuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [appleRequest])
            appleController = controller
            controller.delegate = self; controller.presentationContextProvider = self
            controller.performRequests()
        }
        guard credential.state == state, let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            throw ServiceFailure(message: "Apple sign-in could not be verified. Try again.", status: 0)
        }
        let result = try await request("v1/auth/apple/exchange", body: ["challengeId": challengeId, "identityToken": identityToken], authenticated: link)
        guard let token = result["token"] as? String, !token.isEmpty else { throw ServiceFailure(message: "Apple sign-in did not return a session.", status: 0) }
        try save(token)
        try appleUserStore.save(credential.user)
        try providerStore.save("apple")
    }
    func validateAppleCredential() async throws {
        guard (try? providerStore.read()) == "apple", let user = try appleUserStore.read() else { return }
        let state = try await ASAuthorizationAppleIDProvider().credentialState(forUserID: user)
        if state != .authorized { throw ServiceFailure(message: "Apple authorization changed. Please sign in again.", status: 401) }
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let continuation = appleContinuation; appleContinuation = nil; appleController = nil
        if let credential = authorization.credential as? ASAuthorizationAppleIDCredential { continuation?.resume(returning: credential) }
        else { continuation?.resume(throwing: ServiceFailure(message: "Apple did not return a sign-in credential.", status: 0)) }
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let continuation = appleContinuation; appleContinuation = nil; appleController = nil
        continuation?.resume(throwing: error)
    }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor() }
    private func anchor() -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.filter { $0.activationState == .foregroundActive }.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
    private func randomString() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw ServiceFailure(message: "Couldn’t start secure sign-in.", status: 0) }
        return Data(bytes).base64URLEncoded()
    }
}
private extension Data {
    func base64URLEncoded() -> String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}

import SafariServices

// Authentication and state live in Safari's extension storage. There is no
// native message bridge to the separate GomiMon browser prototype.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [], completionHandler: nil)
    }
}

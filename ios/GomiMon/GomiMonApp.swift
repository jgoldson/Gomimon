import SwiftUI
import GoogleSignIn
import WebKit
import ImageIO

@main
struct GomiMonApp: App {
    var body: some Scene { WindowGroup { BrowserView().onOpenURL { GIDSignIn.sharedInstance.handle($0) } } }
}

@MainActor
final class BrowserModel: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
    @Published var address = "Practice feed"
    @Published var message = "Try a meal, then open Reddit."
    @Published var count = 0
    @Published var meals = UserDefaults.standard.integer(forKey: "mobileMeals")
    @Published var preferences = MobilePreferences.load() { didSet { preferences.save(); configure() } }
    @Published var signedIn = false
    @Published var accountName = ""
    @Published var linkedProviders: [String] = []
    @Published var accountBusy = false
    @Published var accountError: String?
    @Published var checkStatus = ""
    private let account = MobileAccount()
    private var accountScope = UUID().uuidString
    private var generation = 0
    private var analysisTask: Task<Void, Never>?
    private var lastCheck = Date.distantPast
    @Published var loading = false
    @Published var canGoBack = false
    @Published var externalURL: URL?
    @Published var error: String?
    #if DEBUG
    let isSmokeTest = ProcessInfo.processInfo.arguments.contains("--smoke")
    #else
    let isSmokeTest = false
    #endif
    let webView: WKWebView
    private let world = WKContentWorld.world(name: "GomiMon")
    private var credited = Set(UserDefaults.standard.stringArray(forKey: "creditedMeals") ?? [])
    private var observations: [NSKeyValueObservation] = []

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--keychain-smoke") { SessionStore.verifyStorage() }
        #endif
        signedIn = account.token != nil
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        configuration.userContentController.add(self, contentWorld: world, name: "gomimon")
        for name in ["platforms", "revision", "policy", "reddit-detector", "x-detector", "mobile"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "js"),
                  let source = try? String(contentsOf: url, encoding: .utf8) else {
                error = "Missing browser resource: \(name)"; continue
            }
            configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: world))
        }
        observations = [
            webView.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.loading = view.isLoading }
            },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.canGoBack = view.canGoBack }
            }
        ]
        if isSmokeTest { openDemo() } else if preferences.stage == 4 || ProcessInfo.processInfo.arguments.contains("--reddit") { openFeed(preferences.platforms.first ?? "reddit") } else { openDemo() }
        if signedIn { Task { await refreshAccount() } }
    }
    func openDemo() {
        guard let url = Bundle.main.url(forResource: "demo", withExtension: "html") else { return }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }
    func openReddit() { webView.load(URLRequest(url: URL(string: "https://www.reddit.com/")!)) }
    func openFeed(_ platform: String) {
        webView.load(URLRequest(url: URL(string: platform == "x" ? "https://x.com/home" : "https://www.reddit.com/")!))
    }
    var remoteReady: Bool { signedIn && preferences.consent && preferences.stage == 4 }
    func configure() {
        generation += 1
        if !preferences.automatic { checkStatus = "Automatic feeding paused." }
        else if preferences.categories.isEmpty { checkStatus = "Choose diet categories in Settings." }
        else if !remoteReady && preferences.categories.contains(where: { $0 != "ads" }) { checkStatus = "Sign in and allow text checks for your full diet." }
        else { checkStatus = "" }
        let options: [String: Any] = ["automatic": preferences.automatic && preferences.stage == 4,
            "categories": preferences.categories, "categoryStrength": preferences.strength,
            "enabledPlatforms": preferences.platforms, "remoteReady": remoteReady, "accountScope": accountScope]
        webView.callAsyncJavaScript("window.GomiMonMobile?.configure(options)", arguments: ["options": options], in: nil, in: world) { _ in }
    }
    func completeSetup() {
        preferences.petName = preferences.petName.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        preferences.stage = 4
        openFeed(preferences.platforms.first ?? "reddit")
    }
    func refreshAccount() async {
        do {
            try await account.validateAppleCredential()
            let result = try await account.request("v1/account")
            accountName = (result["account"] as? [String: Any])?["email"] as? String ?? "Signed in"
            if let profile = result["gomimon"] as? [String: Any], let name = profile["name"] as? String { preferences.petName = name }
            await refreshProviders()
            signedIn = true; configure()
        } catch {
            if (error as? ServiceFailure)?.status == 401 { account.clear(); signedIn = false; configure() }
            accountError = error.localizedDescription
        }
    }
    func signIn(provider: String = "google", link: Bool = false) async {
        guard !accountBusy else { return }
        accountBusy = true; accountError = nil
        defer { accountBusy = false }
        do {
            if link || account.token == nil {
                if provider == "apple" { try await account.signInApple(link: link) }
                else { try await account.signInGoogle(link: link) }
            }
            let result = try await account.request("v1/account")
            if let profile = result["gomimon"] as? [String: Any], let name = profile["name"] as? String {
                preferences.petName = name
            } else {
                _ = try await account.request("v1/gomimon/name", body: ["name": preferences.petName.trimmingCharacters(in: .whitespacesAndNewlines)])
            }
            accountName = (result["account"] as? [String: Any])?["email"] as? String ?? "Signed in"
            await refreshProviders()
            signedIn = true; accountScope = UUID().uuidString
            if preferences.stage < 4 { completeSetup() } else { configure() }
        } catch {
            if (error as? ServiceFailure)?.status == 401 { account.clear(); signedIn = false; configure() }
            accountError = error.localizedDescription
        }
    }
    private func refreshProviders() async {
        if let result = try? await account.request("v1/auth/providers") { linkedProviders = result["providers"] as? [String] ?? [] }
    }
    func signOut() async {
        let oldToken = account.token
        signedIn = false; accountScope = UUID().uuidString; configure()
        analysisTask?.cancel()
        if oldToken != nil { _ = try? await account.request("v1/auth/signout", body: [:]) }
        account.clear(); accountName = ""; linkedProviders = []; checkStatus = "Sign in to check your chosen categories."
    }
    private func analyze(_ data: [String: Any], url: URL) {
        guard let id = data["id"] as? String, id.count < 200 else { return }
        func reject(_ message: String) { reply(id, result: ["error": message]) }
        guard remoteReady, preferences.automatic, !url.isFileURL, let input = data["input"] as? [String: Any],
              let platform = input["platform"] as? String, preferences.platforms.contains(platform),
              (platform == "reddit" ? (url.host == "reddit.com" || url.host?.hasSuffix(".reddit.com") == true) : (["x.com", "www.x.com", "twitter.com", "www.twitter.com"].contains(url.host ?? "") && url.path == "/home")) else { reject("Checks are paused"); return }
        guard analysisTask == nil, Date().timeIntervalSince(lastCheck) >= 2.4 else { reject("Checks are waiting"); return }
        let selected = preferences.categories.filter { !["ads", "ai_content"].contains($0) }
        let requested = (input["categories"] as? [String] ?? []).filter { selected.contains($0) }
        var payload: [String: Any] = ["platform": platform, "contentType": "post", "categories": requested,
            "includeAi": preferences.categories.contains("ai_content") && (input["includeAi"] as? Bool == true),
            "truncated": input["truncated"] as? Bool == true]
        for (field, limit) in [("text", 8000), ("body", 8000), ("quotedText", 8000), ("title", 2000), ("subreddit", 200), ("flair", 200)] {
            payload[field] = String((input[field] as? String ?? "").prefix(limit))
        }
        let expectedGeneration = generation
        lastCheck = Date(); checkStatus = "Checking your selected categories…"
        analysisTask = Task {
            defer { analysisTask = nil }
            do {
                let result = try await account.request("v1/analyze", body: payload)
                guard expectedGeneration == generation, !Task.isCancelled else { reject("Settings changed"); return }
                checkStatus = "Automatic checks are up to date."
                reply(id, result: result)
            } catch {
                checkStatus = error.localizedDescription
                if (error as? ServiceFailure)?.status == 401 { account.clear(); signedIn = false; configure() }
                reply(id, result: ["error": error.localizedDescription, "retryAfterMs": (error as? ServiceFailure)?.retryAfterMs ?? 60000])
            }
        }
    }
    private func reply(_ id: String, result: [String: Any]) {
        webView.callAsyncJavaScript("window.GomiMonMobile?.receive(id, result)", arguments: ["id": id, "result": result], in: nil, in: world) { _ in }
    }
    private func allowed(_ url: URL) -> Bool {
        if url.isFileURL { return url == Bundle.main.url(forResource: "demo", withExtension: "html") }
        let host = url.host?.lowercased() ?? ""
        return url.scheme == "https" && (host == "reddit.com" || host.hasSuffix(".reddit.com") || ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].contains(host))
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if allowed(url) { decisionHandler(.allow) } else {
            if ["https", "http"].contains(url.scheme ?? "") { externalURL = url }
            else { message = "This link opens another app. Continue browsing here or open Reddit in Safari." }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, allowed(url) { webView.load(action.request) }
        return nil
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        generation += 1; analysisTask?.cancel()
        error = nil; count = 0; message = "Opening your feed…"
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        address = webView.url?.isFileURL == true ? "Practice feed" : (webView.url?.host ?? "Reddit")
        message = webView.url?.isFileURL == true ? "Practice meals stay separate from your pet." : "Tap Feed on a post to give your pet a snack."
        configure()
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--smoke"), webView.url?.isFileURL == true {
            let script = """
            (() => {
              const item = document.querySelector('#demo-normal');
              item.nextElementSibling.click();
              const hidden = item.style.display === 'none';
              document.querySelector('.gomimon-eaten-placeholder').click();
              const restored = item.style.display !== 'none';
              document.querySelector('#demo-ad').scrollIntoView({block: 'center', behavior: 'instant'});
              GomiMonMobile.configure(true);
              const adHidden = document.querySelector('#demo-ad').style.display === 'none';
              GomiMonMobile.configure(false);
              const adRestored = document.querySelector('#demo-ad').style.display !== 'none';
              return { hidden, restored, adHidden, adRestored };
            })()
            """
            webView.evaluateJavaScript(script, in: nil, in: world) { result in
                if case .success(let value) = result, let checks = value as? [String: Bool] {
                    UserDefaults.standard.set(checks, forKey: "smokeChecks")
                    UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "smokeCheckedAt")
                }
            }
        }
        #endif
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError(error) }
    private func showError(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        self.error = error.localizedDescription
        message = "Couldn’t load the page. Try reload or the practice feed."
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, allowed(url),
              let data = message.body as? [String: Any], let type = data["type"] as? String else { return }
        if type == "analyze" { analyze(data, url: url); return }
        if type == "status", let count = data["count"] as? Int { self.count = max(0, count); return }
        guard type == "meal", let key = data["key"] as? String, key.count <= 300,
              let reason = data["reason"] as? String, ["manual", "ad", "category"].contains(reason) else { return }
        if url.isFileURL { self.message = "Practice snack eaten! Try Show post to restore it."; return }
        guard credited.insert(key).inserted else { self.message = "Post hidden. This meal was already counted."; return }
        meals += 1
        UserDefaults.standard.set(meals, forKey: "mobileMeals")
        UserDefaults.standard.set(Array(credited), forKey: "creditedMeals")
        self.message = reason == "ad" ? "Crunch! Your GomiMon ate an ad." : "One less post. One happy GomiMon."
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

struct RedditWebView: UIViewRepresentable {
    let model: BrowserModel
    func makeUIView(context: Context) -> WKWebView { model.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct PetImage: UIViewRepresentable {
    var resource = "bubble-gomi_idle"
    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView(); view.contentMode = .scaleAspectFit
        if let url = Bundle.main.url(forResource: resource, withExtension: "gif"),
           let data = try? Data(contentsOf: url) {
            if !UIAccessibility.isReduceMotionEnabled,
               let source = CGImageSourceCreateWithData(data as CFData, nil) {
                var frames: [UIImage] = []
                var duration = 0.0
                for index in 0..<CGImageSourceGetCount(source) {
                    guard let frame = CGImageSourceCreateImageAtIndex(source, index, nil) else { continue }
                    frames.append(UIImage(cgImage: frame))
                    let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
                    let gif = properties?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
                    duration += max(0.02, gif?[kCGImagePropertyGIFDelayTime] as? Double ?? 0.1)
                }
                view.image = UIImage.animatedImage(with: frames, duration: duration)
            } else { view.image = UIImage(data: data) }
        }
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return view
    }
    func updateUIView(_ uiView: UIImageView, context: Context) {}
}

struct BrowserView: View {
    @StateObject private var model = BrowserModel()
    @State private var showInfo = false
    private let ink = Color(red: 0.15, green: 0.17, blue: 0.28)
    private let purple = Color(red: 0.36, green: 0.27, blue: 0.68)
    var body: some View {
        Group {
        if model.preferences.stage < 4 && !model.isSmokeTest { OnboardingView(model: model) } else {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("GomiMon").font(.system(.title2, design: .rounded, weight: .heavy))
                    Text("BROWSER LAB").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(2)
                }
                Spacer()
                Menu("Browse") {
                    ForEach(model.preferences.platforms, id: \.self) { platform in
                        Button(platform == "x" ? "X" : "Reddit") { model.openFeed(platform) }
                    }
                }.buttonStyle(.borderedProminent).tint(purple)
                Button { showInfo = true } label: { Image(systemName: "slider.horizontal.3").frame(width: 36, height: 40) }.accessibilityLabel("Prototype settings")
            }.padding(.horizontal, 18).padding(.vertical, 10)
            HStack {
                Image(systemName: model.address == "Practice feed" ? "leaf" : "lock.fill")
                Text(model.address).lineLimit(1)
                Spacer()
                if model.loading { ProgressView().controlSize(.small) }
                Button { model.webView.reload() } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Reload page")
            }.font(.caption).padding(12).background(.white.opacity(0.7)).clipShape(RoundedRectangle(cornerRadius: 12)).padding(.horizontal, 16).padding(.bottom, 10)
            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(.red).padding(10)
            }
            RedditWebView(model: model)
            VStack(spacing: 9) {
                HStack(spacing: 12) {
                    PetImage(resource: model.meals < 100 ? "baby1_idle" : model.meals < 1000 ? "bubble-gomi_idle" : "nimbus-gomi_idle").id(model.meals < 100 ? "baby" : model.meals < 1000 ? "bubble" : "nimbus").frame(width: 62, height: 62).background(Color.white.opacity(0.7)).clipShape(RoundedRectangle(cornerRadius: 18))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(model.preferences.petName) · \(model.meals) meals").font(.system(.headline, design: .rounded))
                        Text(model.checkStatus.isEmpty ? model.message : model.checkStatus).font(.caption).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                HStack {
                    Button { model.webView.goBack() } label: { Image(systemName: "chevron.left").frame(width: 36, height: 30) }.disabled(!model.canGoBack).accessibilityLabel("Back")
                    Text("\(model.count) posts found").font(.system(.caption2, design: .monospaced))
                    Spacer()
                    Toggle("Automatic", isOn: $model.preferences.automatic).font(.subheadline.weight(.semibold)).fixedSize().tint(purple)
                }
            }.padding(.horizontal, 18).padding(.vertical, 12)
        }
        }
        }
        .foregroundStyle(ink).background(Color(red: 0.92, green: 0.91, blue: 0.98))
        .preferredColorScheme(.light)
        .sheet(isPresented: $showInfo) { MobileSettingsView(model: model) }
        .alert("Open outside GomiMon?", isPresented: Binding(get: { model.externalURL != nil }, set: { if !$0 { model.externalURL = nil } })) {
            Button("Open Safari") { if let url = model.externalURL { UIApplication.shared.open(url) }; model.externalURL = nil }
            Button("Stay here", role: .cancel) { model.externalURL = nil }
        } message: { Text("\(model.externalURL?.host ?? "This site") will open in your browser. Its login session may not carry back into GomiMon.") }
    }
}

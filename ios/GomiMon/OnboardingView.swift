import SwiftUI
import GoogleSignInSwift
import AuthenticationServices

struct DietPicker: View {
    @ObservedObject var model: BrowserModel
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(dietCategories) { category in
                Toggle(category.name, isOn: Binding(get: { model.preferences.categories.contains(category.id) }, set: { enabled in
                    if enabled { model.preferences.categories.append(category.id) }
                    else { model.preferences.categories.removeAll { $0 == category.id } }
                })).padding(12).background(.white.opacity(0.75)).clipShape(RoundedRectangle(cornerRadius: 14))
            }
            Text(model.preferences.categories.isEmpty ? "No filters selected — nothing is hidden." : "Matching posts will be hidden. Unchecked categories stay visible.")
                .font(.caption).foregroundStyle(.secondary)
            Picker("Category strength", selection: $model.preferences.strength) {
                Text("Conservative · 90%").tag("conservative")
                Text("Balanced · 80%").tag("balanced")
                Text("Aggressive · 70%").tag("aggressive")
            }.pickerStyle(.menu)
            Text("AI labels are experimental. Text only; photos and videos aren’t analyzed.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct PlatformPicker: View {
    @ObservedObject var model: BrowserModel
    var body: some View {
        ForEach(["reddit", "x"], id: \.self) { platform in
            Toggle(platform == "reddit" ? "Reddit" : "X · For You and Following", isOn: Binding(get: { model.preferences.platforms.contains(platform) }, set: { selected in
                if selected { model.preferences.platforms.append(platform) }
                else if model.preferences.platforms.count > 1 { model.preferences.platforms.removeAll { $0 == platform } }
            })).padding(16).background(.white.opacity(0.75)).clipShape(RoundedRectangle(cornerRadius: 16))
        }
        Text("Choose at least one feed. Your diet applies to both. X mobile support is experimental.").font(.caption).foregroundStyle(.secondary)
    }
}

struct DetectorAccountControls: View {
    @ObservedObject var model: BrowserModel
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Toggle("Allow text checks", isOn: $model.preferences.consent)
            Text("Selected post text and context are sent to GomiMon’s detector service and TypeSafe to check your diet. GomiMon does not retain raw post text on its server. Ads are detected on this device.")
                .font(.caption).foregroundStyle(.secondary)
            Link("Read the privacy notice", destination: URL(string: "https://gomimon-api.goldentechlabs.com/privacy.html")!)
            if let error = model.accountError { Text(error).font(.caption).foregroundStyle(.red) }
            if model.signedIn {
                Text(model.accountName.isEmpty ? "Signed in" : model.accountName).font(.subheadline)
                if model.preferences.stage < 4 {
                    Button("Finish setup") { Task { await model.signIn() } }.buttonStyle(.borderedProminent).disabled(model.accountBusy)
                }
                Text("Linked: \(model.linkedProviders.map { $0.capitalized }.joined(separator: ", "))").font(.caption)
                if !model.linkedProviders.contains("apple") {
                    Button("Link Apple to this account") { Task { await model.signIn(provider: "apple", link: true) } }.disabled(model.accountBusy)
                }
                if !model.linkedProviders.contains("google") {
                    Button("Link Google to this account") { Task { await model.signIn(provider: "google", link: true) } }.disabled(model.accountBusy)
                }
                Text("Link providers here to use either sign-in with the same companion. Existing separate accounts are never merged automatically.").font(.caption).foregroundStyle(.secondary)
                Button("Sign out") { Task { await model.signOut() } }.disabled(model.accountBusy)
            } else {
                AppleSignInButton { Task { await model.signIn(provider: "apple") } }
                    .frame(height: 50)
                    .disabled(model.accountBusy || !model.preferences.consent || !model.preferences.validName)
                GoogleSignInButton(scheme: .light, style: .wide,
                    state: model.accountBusy || !model.preferences.consent || !model.preferences.validName ? .disabled : .normal) {
                    Task { await model.signIn(provider: "google") }
                }
                .frame(maxWidth: .infinity)
                if model.accountBusy { ProgressView("Signing in…") }
            }
            Text("This signs in to GomiMon. You’ll sign in to Reddit or X separately inside the browser.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct OnboardingView: View {
    @ObservedObject var model: BrowserModel
    private let steps = ["Hatch", "Platforms", "Diet", "Account"]
    private let purple = Color(red: 0.36, green: 0.27, blue: 0.68)
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("GomiMon").font(.system(.title2, design: .rounded, weight: .heavy))
                Spacer()
                Text("YOUR FEED COMPANION").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1)
            }.padding(22)
            HStack(spacing: 8) {
                ForEach(0..<4) { index in
                    VStack(spacing: 6) {
                        Capsule().fill(index <= model.preferences.stage ? purple : purple.opacity(0.15)).frame(height: 4)
                        Text(steps[index]).font(.caption2.weight(index == model.preferences.stage ? .bold : .regular))
                    }
                }
            }.padding(.horizontal, 24)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if model.preferences.stage == 0 {
                        art("onboarding-egg")
                        title("Your egg is ready to hatch.", "Name your companion, then tap to meet them.")
                        TextField("Your GomiMon’s name", text: $model.preferences.petName)
                            .textInputAutocapitalization(.words).autocorrectionDisabled().padding(18).background(.white).clipShape(RoundedRectangle(cornerRadius: 16))
                        Text("Use 2–24 characters: letters, numbers, spaces, apostrophes, hyphens, or underscores.").font(.caption).foregroundStyle(.secondary)
                    } else if model.preferences.stage == 1 {
                        PetImage(resource: "baby1_idle").frame(height: 140).id("hatched")
                        title("Where should GomiMon eat?", "Choose the feeds your companion calls home.")
                        PlatformPicker(model: model)
                    } else if model.preferences.stage == 2 {
                        title("What’s on the menu?", "Pick the posts GomiMon should eat, so you see less of them.")
                        DietPicker(model: model)
                    } else {
                        art("onboarding-account")
                        title("One last step.", "Connect your companion to automatic category checks.")
                        DetectorAccountControls(model: model)
                        Button("Continue without an account") { model.completeSetup() }.frame(maxWidth: .infinity)
                        Text("Without sign-in, manual feeding and selected ad filtering work. Other categories wait until you sign in and allow text checks.").font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(24)
            }
            HStack {
                if model.preferences.stage > 0 { Button("Back") { model.preferences.stage -= 1 }.disabled(model.accountBusy) }
                Spacer()
                if model.preferences.stage < 3 {
                    Button(model.preferences.stage == 0 ? "Hatch my egg" : model.preferences.stage == 1 ? "Choose diet" : "Continue") {
                        withAnimation(.easeInOut(duration: 0.3)) { model.preferences.stage += 1 }
                    }.buttonStyle(.borderedProminent).controlSize(.large)
                        .disabled(model.preferences.stage == 0 && !model.preferences.validName)
                }
            }.padding(22)
        }.tint(purple)
    }
    private func title(_ heading: String, _ description: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(heading).font(.system(size: 30, weight: .heavy, design: .rounded))
            Text(description).font(.subheadline).foregroundStyle(.secondary)
        }
    }
    @ViewBuilder private func art(_ name: String) -> some View {
        if let url = Bundle.main.url(forResource: name, withExtension: "png"), let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity).frame(height: 170).accessibilityHidden(true)
        }
    }
}

struct MobileSettingsView: View {
    @ObservedObject var model: BrowserModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Your companion").font(.headline)
                    Text(model.preferences.petName)
                    Text("Your diet").font(.headline)
                    DietPicker(model: model)
                    Toggle("Automatic feeding", isOn: $model.preferences.automatic)
                    Text("When paused, automatically hidden posts return. Manual meals remain hidden until you choose Show post.").font(.caption).foregroundStyle(.secondary)
                    Text("Platforms").font(.headline)
                    PlatformPicker(model: model)
                    Text("Detector account").font(.headline)
                    DetectorAccountControls(model: model)
                    Button("Open practice feed") { model.openDemo(); dismiss() }
                    Button("Review onboarding") { model.preferences.stage = 0; dismiss() }
                    Text("Pet meals remain local to this prototype. Your account and reserved name are shared with the extension; pet progress and diet settings are not synced yet.").font(.caption).foregroundStyle(.secondary)
                }.padding(22)
            }.background(Color(red: 0.92, green: 0.91, blue: 0.98)).navigationTitle("Settings")
                .toolbar { Button("Done") { dismiss() } }
        }
    }
}

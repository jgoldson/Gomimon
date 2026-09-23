import Foundation

struct DietCategory: Identifiable {
    let id: String
    let name: String
}
let dietCategories = [
    DietCategory(id: "politics", name: "Politics"), DietCategory(id: "ads", name: "Ads"),
    DietCategory(id: "promotions", name: "Promotions"), DietCategory(id: "ragebait", name: "Ragebait"),
    DietCategory(id: "celebrity_gossip", name: "Celebrity gossip"), DietCategory(id: "sports", name: "Sports"),
    DietCategory(id: "crypto", name: "Crypto"), DietCategory(id: "ai_content", name: "AI content")
]
struct MobilePreferences: Codable {
    var stage = 0
    var petName = ""
    var platforms = ["reddit"]
    var categories: [String] = []
    var strength = "balanced"
    var automatic = true
    var consent = false
    static func load() -> Self {
        guard let data = UserDefaults.standard.data(forKey: "mobilePreferences"),
              let value = try? JSONDecoder().decode(Self.self, from: data) else { return Self() }
        return value
    }
    func save() { if let data = try? JSONEncoder().encode(self) { UserDefaults.standard.set(data, forKey: "mobilePreferences") } }
    var validName: Bool {
        let name = petName.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        return (2...24).contains(name.count) && name.range(of: "^[\\p{L}\\p{N}](?:[\\p{L}\\p{N} _'’-]*[\\p{L}\\p{N}])?$", options: .regularExpression) != nil
    }
}

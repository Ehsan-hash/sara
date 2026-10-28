// Shared by the app and its widget through the app group: which server, the sign-in cookie
// (so the widget can ask the server for her face, mood and last message), and the last good data.
import Foundation

enum SharedStore {
    static let group = "group.com.backstagecoding.sara"
    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }

    static var server: String? {
        get { defaults.string(forKey: "server") }
        set { defaults.set(newValue, forKey: "server") }
    }
    /// The Cookie header for the server (the app's signed-in session).
    static var cookie: String? {
        get { defaults.string(forKey: "cookie") }
        set { defaults.set(newValue, forKey: "cookie") }
    }
    /// Last widget data (JSON from /api/phone/widget) and her face, for when the server can't be reached.
    static var widgetJSON: Data? {
        get { defaults.data(forKey: "widgetJSON") }
        set { defaults.set(newValue, forKey: "widgetJSON") }
    }
    static var face: Data? {
        get { defaults.data(forKey: "face") }
        set { defaults.set(newValue, forKey: "face") }
    }
}

/// What /api/phone/widget returns.
struct WidgetData: Codable {
    struct Last: Codable {
        let id: Int
        let conversationId: String
        let text: String
        let at: String
    }
    let name: String
    let mood: String?
    let face: String?
    let last: Last?
}

import AppIntents
import Foundation

// Phase 72: Siri and Shortcuts. "Ask Sara" (or the Ask Sara action in Shortcuts) sends one message
// to her on the server the app is using now, with that server's own sign-in (Phase 68: each saved
// server keeps its cookie in its own website data store), and returns her reply as Siri's dialog.
// She answers in a conversation of her own called "Siri" (made on first use, per server). Her
// safety layer runs on the server: the AI notice at a session start and every 3 hours and crisis
// resources come back as part of the reply, and her reply that fails the minors check arrives
// replaced. Nothing here is stored but the id of that conversation.

struct AskSaraIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Sara"
    static let description = IntentDescription("Send Sara a message and hear her reply.")
    static let openAppWhenRun = false

    @Parameter(title: "Message", requestValueDialog: "What do you want to tell her?")
    var message: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask Sara \(\.$message)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let reply = try await SaraAsk.ask(message)
        return .result(value: reply, dialog: IntentDialog(stringLiteral: reply))
    }
}

struct SaraShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskSaraIntent(),
            phrases: ["Ask \(.applicationName)", "Talk to \(.applicationName)", "Tell \(.applicationName) something"],
            shortTitle: "Ask Sara",
            systemImageName: "bubble.left.and.bubble.right"
        )
    }
}

struct SaraAskError: Error, CustomLocalizedStringResourceConvertible {
    let message: String
    var localizedStringResource: LocalizedStringResource { LocalizedStringResource(stringLiteral: message) }
}

/// One message to her, through the server the app is using now.
enum SaraAsk {
    @MainActor
    static func ask(_ text: String) async throws -> String {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { throw SaraAskError(message: "Tell me what to send her.") }
        guard let profile = Servers.active, let base = URL(string: profile.url) else {
            throw SaraAskError(message: "Open the Sara app and connect to your server first.")
        }
        let cookie = await Servers.cookie(profile)
        guard let cookie else { throw SaraAskError(message: "Open the Sara app and sign in first.") }
        let key = "siriConversation.\(profile.id)"
        var conv = UserDefaults.standard.string(forKey: key)
        if conv == nil {
            conv = try await newConversation(base, cookie: cookie)
            UserDefaults.standard.set(conv, forKey: key)
        }
        do {
            return try await send(message, conversation: conv!, base: base, cookie: cookie)
        } catch let e as HTTPStatus where e.code == 404 {
            // The "Siri" conversation was deleted in the app: start a new one.
            let fresh = try await newConversation(base, cookie: cookie)
            UserDefaults.standard.set(fresh, forKey: key)
            return try await send(message, conversation: fresh, base: base, cookie: cookie)
        }
    }

    struct HTTPStatus: Error { let code: Int }

    static func request(_ url: URL, cookie: String, body: [String: Any]) -> URLRequest {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("SaraPhone/1 (iOS; Siri)", forHTTPHeaderField: "User-Agent")
        req.setValue(cookie, forHTTPHeaderField: "Cookie")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return req
    }

    static func check(_ res: URLResponse) throws {
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        switch code {
        case 200 ... 299: return
        case 401: throw SaraAskError(message: "Open the Sara app and sign in again.")
        case 403: throw SaraAskError(message: "Open Sara in the app once and accept the AI notice first.")
        case 409: throw SaraAskError(message: "She's still answering your last message. Ask again in a moment.")
        case 404: throw HTTPStatus(code: 404)
        default: throw SaraAskError(message: "Her server didn't answer (\(code)). Try again in a moment.")
        }
    }

    static func newConversation(_ base: URL, cookie: String) async throws -> String {
        let (data, res) = try await URLSession.shared.data(for: request(base.appendingPathComponent("api/conversations"), cookie: cookie, body: ["title": "Siri"]))
        try check(res)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any], let id = obj["id"] as? String else {
            throw SaraAskError(message: "Her server sent something unexpected.")
        }
        return id
    }

    /// Sends the message and reads her streamed answer (server-sent events) until it is done.
    static func send(_ text: String, conversation: String, base: URL, cookie: String) async throws -> String {
        let url = base.appendingPathComponent("api/conversations").appendingPathComponent(conversation).appendingPathComponent("messages")
        let (bytes, res) = try await URLSession.shared.bytes(for: request(url, cookie: cookie, body: ["content": text]))
        try check(res)
        var notices: [String] = []
        var reply = ""
        var event = ""
        for try await line in bytes.lines {
            if line.hasPrefix("event: ") {
                event = String(line.dropFirst(7))
                continue
            }
            guard line.hasPrefix("data: "), let data = line.dropFirst(6).data(using: .utf8),
                  let ev = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            let t = ev["text"] as? String ?? ""
            switch event {
            case "notice":
                if let kind = ev["kind"] as? String, kind == "disclosure" || kind == "crisis" { notices.append(t) }
            case "token":
                reply += t
            case "replace":
                reply = t
            case "error":
                throw SaraAskError(message: (ev["message"] as? String) ?? "Something went wrong on her server.")
            case "done":
                return plain((notices + [reply]).filter { !$0.isEmpty }.joined(separator: "\n\n"))
            default:
                break
            }
        }
        return plain((notices + [reply]).filter { !$0.isEmpty }.joined(separator: "\n\n"))
    }

    /// Siri reads it aloud: markdown marks out.
    static func plain(_ s: String) -> String {
        var out = s.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "__", with: "").replacingOccurrences(of: "`", with: "")
        out = out.replacingOccurrences(of: "(?m)^#{1,6}\\s+", with: "", options: .regularExpression)
        out = out.replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]*\\)", with: "$1", options: .regularExpression)
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

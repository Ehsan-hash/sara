// "Share → Sara" from any app (Phase 18): text, a link or up to 4 photos, with your own note,
// sent to your latest conversation. Her answer comes back as a notification.
import Social
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Send to Sara"
        placeholder = "Add a note (optional)"
        if SharedStore.server == nil || SharedStore.cookie == nil {
            placeholder = "Open the Sara app and sign in first."
        }
    }

    override func isContentValid() -> Bool {
        SharedStore.server != nil && SharedStore.cookie != nil
    }

    override func didSelectPost() {
        Task {
            let (text, images) = await collect()
            var note = contentText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty, !note.contains(text) { note = note.isEmpty ? text : note + "\n" + text }
            await send(content: note, images: images)
            extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }

    /// Links and text from the shared items, and photos as small JPEG data URLs.
    private func collect() async -> (String, [String]) {
        var texts: [String] = []
        var images: [String] = []
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        for p in providers {
            if p.hasItemConformingToTypeIdentifier(UTType.image.identifier), images.count < 4 {
                if let data = try? await p.loadItem(forTypeIdentifier: UTType.image.identifier) {
                    let img: UIImage? = (data as? UIImage) ?? (data as? URL).flatMap { try? Data(contentsOf: $0) }.flatMap { UIImage(data: $0) } ?? (data as? Data).flatMap { UIImage(data: $0) }
                    if let img, let jpeg = Self.shrink(img).jpegData(compressionQuality: 0.85) { images.append("data:image/jpeg;base64," + jpeg.base64EncodedString()) }
                }
            } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                if let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL { texts.append(url.absoluteString) }
            } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let t = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String { texts.append(t) }
            }
        }
        return (texts.joined(separator: "\n"), images)
    }

    private static func shrink(_ img: UIImage) -> UIImage {
        let maxSide: CGFloat = 2048
        let s = img.size
        let scale = min(1, maxSide / max(s.width, s.height))
        if scale >= 1 { return img }
        let size = CGSize(width: s.width * scale, height: s.height * scale)
        let f = UIGraphicsImageRendererFormat()
        f.scale = 1
        return UIGraphicsImageRenderer(size: size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    }

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest? {
        guard let server = SharedStore.server, let url = URL(string: server + path) else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.timeoutInterval = 30
        r.setValue("SaraPhone/1 (iOS)", forHTTPHeaderField: "User-Agent")
        if let c = SharedStore.cookie { r.setValue(c, forHTTPHeaderField: "Cookie") }
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return r
    }

    private func send(content: String, images: [String]) async {
        // The most recent conversation (not off the record, not with someone else), or a new one.
        var convId: String?
        if let r = request("/api/conversations"), let (d, _) = try? await URLSession.shared.data(for: r),
           let list = try? JSONSerialization.jsonObject(with: d) as? [[String: Any]] {
            convId = list.first { c in (c["offRecord"] as? Bool) != true && (c["partner"] == nil || c["partner"] is NSNull) }?["id"] as? String
        }
        if convId == nil, let r = request("/api/conversations", method: "POST", body: [:]), let (d, _) = try? await URLSession.shared.data(for: r) {
            convId = (try? JSONSerialization.jsonObject(with: d) as? [String: Any])?["id"] as? String
        }
        guard let convId, let id = convId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let r = request("/api/conversations/\(id)/messages", method: "POST", body: ["content": content, "images": images, "background": true])
        else { return }
        _ = try? await URLSession.shared.data(for: r)
    }

    override func configurationItems() -> [Any]! { [] }
}

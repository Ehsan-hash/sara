// Home Screen and Lock Screen widget (Phase 17): her face, mood and latest message, refreshed
// about every 15 minutes (and whenever the app is opened). Uses the app's sign-in.
import SwiftUI
import UIKit
import WidgetKit

struct SaraEntry: TimelineEntry {
    let date: Date
    let name: String
    let mood: String?
    let text: String?
    let conversation: String?
    let face: UIImage?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SaraEntry {
        SaraEntry(date: Date(), name: "Sara", mood: "cheerful", text: "Good morning! Ready for today?", conversation: nil, face: UIImage(named: "Face"))
    }

    func getSnapshot(in context: Context, completion: @escaping (SaraEntry) -> Void) {
        if context.isPreview { return completion(cached() ?? placeholder(in: context)) }
        Task { completion(await load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SaraEntry>) -> Void) {
        Task {
            let entry = await load()
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
        }
    }

    private func request(_ url: URL) -> URLRequest {
        var r = URLRequest(url: url)
        r.timeoutInterval = 15
        if let c = SharedStore.cookie { r.setValue(c, forHTTPHeaderField: "Cookie") }
        return r
    }

    func load() async -> SaraEntry {
        guard let server = SharedStore.server, let url = URL(string: server + "/api/phone/widget") else {
            return SaraEntry(date: Date(), name: "Sara", mood: nil, text: "Open the app to connect.", conversation: nil, face: UIImage(named: "Face"))
        }
        guard let (data, res) = try? await URLSession.shared.data(for: request(url)), (res as? HTTPURLResponse)?.statusCode == 200,
              let w = try? JSONDecoder().decode(WidgetData.self, from: data)
        else {
            return cached() ?? SaraEntry(date: Date(), name: "Sara", mood: nil, text: "Open the app to sign in.", conversation: nil, face: UIImage(named: "Face"))
        }
        SharedStore.widgetJSON = data
        if let f = w.face, let fu = URL(string: server + f),
           let (img, r2) = try? await URLSession.shared.data(for: request(fu)), (r2 as? HTTPURLResponse)?.statusCode == 200,
           let small = UIImage(data: img).map({ squareThumb($0, side: 360) }) {
            SharedStore.face = small.jpegData(compressionQuality: 0.85)
        }
        return entry(from: w)
    }

    private func entry(from w: WidgetData) -> SaraEntry {
        SaraEntry(date: Date(), name: w.name, mood: w.mood, text: w.last?.text, conversation: w.last?.conversationId,
                  face: SharedStore.face.flatMap { UIImage(data: $0) } ?? UIImage(named: "Face"))
    }

    private func cached() -> SaraEntry? {
        guard let d = SharedStore.widgetJSON, let w = try? JSONDecoder().decode(WidgetData.self, from: d) else { return nil }
        return entry(from: w)
    }

    /// Square crop from the top (where her face is), small enough for the widget's memory limit.
    private func squareThumb(_ img: UIImage, side: CGFloat) -> UIImage {
        let s = img.size
        let scale = side / min(s.width, s.height)
        let w = s.width * scale
        let h = s.height * scale
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            img.draw(in: CGRect(x: (side - w) / 2, y: 0, width: w, height: h))
        }
    }
}

struct SaraWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SaraEntry

    private var link: URL {
        if let c = entry.conversation { return URL(string: "sara://open?c=\(c)")! }
        return URL(string: "sara://open")!
    }

    private var face: some View {
        Group {
            if let f = entry.face { Image(uiImage: f).resizable().scaledToFill() } else { Color(red: 0.14, green: 0.12, blue: 0.17) }
        }
    }

    var body: some View {
        content.widgetURL(link)
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                if let f = entry.face {
                    Image(uiImage: f).resizable().scaledToFill().clipShape(Circle()).padding(2).widgetAccentable()
                } else {
                    Text(String(entry.name.prefix(1))).font(.title2.bold())
                }
            }
            .containerBackground(for: .widget) { Color.clear }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(entry.name + (entry.mood.map { " · \($0)" } ?? "")).font(.headline).widgetAccentable().lineLimit(1)
                Text(entry.text ?? "").font(.caption).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) { Color.clear }
        case .accessoryInline:
            Text(entry.name + (entry.mood.map { ": \($0)" } ?? ""))
                .containerBackground(for: .widget) { Color.clear }
        case .systemSmall:
            VStack(alignment: .leading, spacing: 0) {
                Spacer()
                Text(entry.name).font(.headline).foregroundStyle(.white)
                if let m = entry.mood { Text(m).font(.caption).foregroundStyle(.white.opacity(0.85)) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) {
                ZStack {
                    face
                    LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                }
            }
        default:
            HStack(spacing: 12) {
                face.frame(width: 110, height: 110).clipShape(RoundedRectangle(cornerRadius: 16))
                VStack(alignment: .leading, spacing: 4) {
                    Text(entry.name).font(.headline)
                    if let m = entry.mood { Text(m).font(.caption).foregroundStyle(.secondary) }
                    Text(entry.text ?? "Say hi!").font(.subheadline).lineLimit(4)
                    Spacer(minLength: 0)
                }
                Spacer(minLength: 0)
            }
            .containerBackground(for: .widget) { Color(red: 0.106, green: 0.094, blue: 0.125) }
        }
    }
}

struct SaraWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SaraWidget", provider: Provider()) { SaraWidgetView(entry: $0) }
            .configurationDisplayName("Your companion")
            .description("Her face, mood and latest message.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct SaraWidgets: WidgetBundle {
    var body: some Widget { SaraWidget() }
}

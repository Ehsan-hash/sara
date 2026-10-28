// Sara for iPhone (Phase 17): the web app in a native shell, like the Android app, plus Apple
// notifications, the Home Screen / Lock Screen widget, sign-in with a pairing code, and the demo.
import SwiftUI

@main
struct SaraApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .onOpenURL { model.handle(url: $0) }
                .preferredColorScheme(.dark)
        }
    }
}

let saraBackground = Color(red: 0.071, green: 0.063, blue: 0.086)
let saraAccent = Color(red: 0.878, green: 0.471, blue: 0.604)

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ZStack {
            saraBackground.ignoresSafeArea()
            if model.screen == .web, model.server != nil {
                WebView(model: model)
            } else {
                SetupView()
            }
            if model.locked || model.covered {
                LockView(locked: model.locked) { model.unlock() }
            }
        }
        .onChange(of: phase) { _, p in model.scene(p) }
        .alert(pairTitle, isPresented: pairShown, presenting: model.pairLink) { link in
            if link.refused {
                Button("OK", role: .cancel) {}
            } else if switching(link) {
                // Switching servers is the careful choice; Cancel is the default.
                Button("Switch server", role: .destructive) { Task { await model.accept(link) } }
                Button("Cancel", role: .cancel) {}
            } else {
                // Without a code: open that server's sign-in page (code or owner token there).
                Button("Sign in") { Task { await model.accept(link) } }
                Button("Cancel", role: .cancel) {}
            }
        } message: { link in
            Text(pairMessage(link))
        }
        .alert("Couldn't switch", isPresented: switchErrorShown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.switchError ?? "")
        }
    }
}

extension RootView {
    private var pairShown: Binding<Bool> {
        Binding(get: { model.pairLink != nil }, set: { if !$0 { model.pairLink = nil } })
    }

    private var switchErrorShown: Binding<Bool> {
        Binding(get: { model.switchError != nil }, set: { if !$0 { model.switchError = nil } })
    }

    private func switching(_ link: AppModel.PairLink) -> Bool {
        model.server != nil && model.server != link.server
    }

    private var pairTitle: String {
        guard let link = model.pairLink else { return "" }
        if link.refused { return "This link can't be used" }
        if switching(link) { return "Switch server?" }
        return link.code != nil ? "Sign in with a code" : "Open your Sara"
    }

    private func pairMessage(_ link: AppModel.PairLink) -> String {
        if link.refused {
            return "The pairing link doesn't hold a plain server address, so the app won't open it. Make a new code in Sara on your computer: Settings → Data & health → Devices and sign-in → Add a phone."
        }
        var m = switching(link)
            ? "This link wants to move the app to another server.\n\nNow: \(model.server ?? "")\nNew: \(link.server)"
            : "Sign in to \(link.server)?"
        if link.server.hasPrefix("http://") && !AppModel.isPrivateHost(link.server) {
            m += "\n\n⚠ This address uses plain http on the open internet: anyone on the way could read your messages. Only continue if you set it up that way."
        }
        if switching(link) { m += "\n\nOnly switch if you made this link yourself." }
        return m
    }
}

/// Shown while the app lock is on and the app is locked (or in the app switcher).
struct LockView: View {
    let locked: Bool
    let unlock: () -> Void

    var body: some View {
        ZStack {
            saraBackground.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "lock.fill").font(.system(size: 44)).foregroundStyle(.white)
                if locked {
                    Text("Locked").font(.title2.bold())
                    Button("Unlock", action: unlock).buttonStyle(.borderedProminent).tint(saraAccent)
                }
            }
        }
    }
}

import SwiftUI

/// First screen: the server's address and an optional pairing code, or the demo.
struct SetupView: View {
    @EnvironmentObject var model: AppModel
    @State private var address = ""
    @State private var code = ""
    @FocusState private var focus: Field?
    private enum Field { case address, code }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Image("Face")
                    .resizable()
                    .scaledToFill()
                    .frame(width: 84, height: 84)
                    .clipShape(Circle())
                    .padding(.top, 36)
                Text(model.server == nil || model.server == AppModel.demoServer ? "Connect to your Sara" : "Add a Sara")
                    .font(.title.bold())
                Text(model.server == nil || model.server == AppModel.demoServer ? "Type the address you open Sara at in a web browser, for example sara.example.com or 192.168.1.20:7860." : "Type the address of another Sara. Your other Saras stay signed in.")
                    .foregroundStyle(.secondary)
                TextField("Server address", text: $address)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .address)
                    .onSubmit { focus = .code }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.07)))
                    .accessibilityIdentifier("address")
                TextField("Pairing code (optional)", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                    .submitLabel(.go)
                    .focused($focus, equals: .code)
                    .onSubmit(connect)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.07)))
                    .accessibilityIdentifier("code")
                Text("Get a code on a device where you're signed in: Settings → Data & health → Devices and sign-in → Add a phone or computer. Without one, you sign in with your owner token.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let e = model.setupError {
                    Text(e).foregroundStyle(Color(red: 1, green: 0.54, blue: 0.54))
                }
                Button(action: connect) {
                    HStack {
                        Spacer()
                        if model.busy { ProgressView() } else { Text("Connect").bold() }
                        Spacer()
                    }
                    .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(saraAccent)
                .disabled(model.busy)
                .accessibilityIdentifier("connect")

                Divider().padding(.vertical, 10)
                Text("No server yet? The demo shows what Sara is like (conversations there aren't saved).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Try the demo") { model.tryDemo() }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("demo")
                if model.server != nil {
                    Button("Back to \(Servers.list().first { $0.url == model.server }?.name ?? "Sara")") { model.open(path: "/") }
                        .buttonStyle(.bordered)
                        .padding(.top, 6)
                }
            }
            .padding(24)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            if address.isEmpty, let s = model.server, s != AppModel.demoServer { address = s }
        }
    }

    private func connect() {
        focus = nil
        Task { await model.connect(address: address, code: code) }
    }
}

// Sara for Windows (Phase 33): a native window around the owner's own Sara server, using the
// system's Edge WebView2. Tray icon (keeps running when the window is closed), notifications,
// start with Windows, microphone for calls, first-run setup (server address, then the server's own
// /pair page for the sign-in code). No credentials are stored here: the sign-in is the server's
// session cookie, kept in this user's WebView2 profile.
// Phase 55: works the same against a Sara on another computer or server (the installer's
// "Connect to a Sara somewhere else" installs only this app): "Connect to a different Sara…" in the
// tray menu, and a "can't reach your Sara" page with Try again and Change address.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <wrl.h>
#include <objbase.h>
#include <string>
#include <map>
#include <vector>
#include "WebView2.h"
#include "resource.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

static const wchar_t* kVersion = L"0.33.0";
static const wchar_t* kWindowClass = L"SaraDesktopWindow";
static const UINT WM_APP_TRAY = WM_APP + 1;
static const UINT WM_APP_SHOW = WM_APP + 2;
static const UINT WM_APP_BALLOON = WM_APP + 3;
static const UINT kTrayId = 1;
enum MenuId { ID_OPEN = 100, ID_LOGIN, ID_QUIT, ID_CHANGE };

static HINSTANCE g_inst;
static HWND g_wnd;
static ComPtr<ICoreWebView2Controller> g_controller;
static ComPtr<ICoreWebView2> g_web;
static NOTIFYICONDATAW g_tray{};
static std::wstring g_server;        // e.g. https://sara.example.com (origin, no trailing slash)
static std::wstring g_pendingConv;   // conversation to open when a notification is clicked
static bool g_quitting = false;
static bool g_toldAboutTray = false;

// ---------- small helpers ----------
static std::wstring dataDir() {
  wchar_t* p = nullptr;
  std::wstring dir;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &p))) dir = std::wstring(p) + L"\\Sara";
  CoTaskMemFree(p);
  CreateDirectoryW(dir.c_str(), nullptr);
  return dir;
}
static std::wstring iniPath() { return dataDir() + L"\\desktop.ini"; }
static std::wstring getPref(const wchar_t* key, const wchar_t* def = L"") {
  wchar_t buf[2048];
  GetPrivateProfileStringW(L"sara", key, def, buf, 2048, iniPath().c_str());
  return buf;
}
static void setPref(const wchar_t* key, const std::wstring& v) { WritePrivateProfileStringW(L"sara", key, v.c_str(), iniPath().c_str()); }
static bool prefOn(const wchar_t* key, bool def) { return getPref(key, def ? L"1" : L"0") == L"1"; }

static std::wstring exePath() {
  wchar_t buf[MAX_PATH];
  GetModuleFileNameW(nullptr, buf, MAX_PATH);
  return buf;
}
static std::wstring exeDir() {
  std::wstring p = exePath();
  return p.substr(0, p.find_last_of(L'\\'));
}
/** Phase 46c: installed by Sara-Setup.exe together with the server (SaraService.exe beside it). The
 *  installer then owns the program folder, shortcuts and uninstall; the app doesn't install itself. */
static bool fileExists(const std::wstring& p) { return GetFileAttributesW(p.c_str()) != INVALID_FILE_ATTRIBUTES; }
static bool installedWithServer() { return fileExists(exeDir() + L"\\SaraService.exe"); }
/** Phase 55: installed by Sara-Setup.exe (with her server, or the app only for a Sara elsewhere):
 *  the installer owns the folder, shortcut and uninstall entry. */
static bool installedBySetup() { return installedWithServer() || fileExists(exeDir() + L"\\unins000.exe"); }
/** Her port on this computer (sara.env next to SaraService.exe), or "" when she doesn't run here. */
static std::wstring localPort() {
  if (!installedWithServer()) return L"";
  FILE* f = nullptr;
  if (_wfopen_s(&f, (exeDir() + L"\\sara.env").c_str(), L"r, ccs=UTF-8") != 0 || !f) return L"";
  std::wstring port;
  wchar_t line[1024];
  while (fgetws(line, 1024, f)) {
    std::wstring l = line;
    if (l.rfind(L"SARA_PORT=", 0) != 0) continue;
    for (wchar_t c : l.substr(10))
      if (iswdigit(c)) port += c;
      else break;
  }
  fclose(f);
  return port;
}

static std::string toUtf8(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
  return s;
}
static std::wstring fromUtf8(const std::string& s) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring w(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
  return w;
}

static std::wstring jsonEscape(const std::wstring& s) {
  std::wstring o;
  for (wchar_t c : s) {
    switch (c) {
      case L'"': o += L"\\\""; break;
      case L'\\': o += L"\\\\"; break;
      case L'\n': o += L"\\n"; break;
      case L'\r': o += L"\\r"; break;
      case L'\t': o += L"\\t"; break;
      default:
        if (c < 0x20) { wchar_t b[8]; swprintf(b, 8, L"\\u%04x", c); o += b; } else o += c;
    }
  }
  return o;
}

/** Parses a flat JSON object of string / number / boolean values (all the bridge sends). */
static std::map<std::wstring, std::wstring> parseFlatJson(const std::wstring& s) {
  std::map<std::wstring, std::wstring> out;
  size_t i = 0;
  auto ws = [&] { while (i < s.size() && iswspace(s[i])) i++; };
  auto str = [&]() -> std::wstring {
    std::wstring v;
    i++;  // opening quote
    while (i < s.size() && s[i] != L'"') {
      if (s[i] == L'\\' && i + 1 < s.size()) {
        wchar_t e = s[++i];
        if (e == L'n') v += L'\n';
        else if (e == L't') v += L'\t';
        else if (e == L'r') v += L'\r';
        else if (e == L'u' && i + 4 < s.size()) { v += (wchar_t)wcstol(s.substr(i + 1, 4).c_str(), nullptr, 16); i += 4; }
        else v += e;
      } else v += s[i];
      i++;
    }
    i++;  // closing quote
    return v;
  };
  ws();
  if (i >= s.size() || s[i] != L'{') return out;
  i++;
  while (i < s.size()) {
    ws();
    if (s[i] == L'}') break;
    if (s[i] != L'"') break;
    std::wstring k = str();
    ws();
    if (s[i] != L':') break;
    i++;
    ws();
    std::wstring v;
    if (s[i] == L'"') v = str();
    else {
      size_t st = i;
      while (i < s.size() && s[i] != L',' && s[i] != L'}') i++;
      v = s.substr(st, i - st);
      while (!v.empty() && iswspace(v.back())) v.pop_back();
    }
    out[k] = v;
    ws();
    if (i < s.size() && s[i] == L',') i++;
  }
  return out;
}

/** A host that's reached without HTTPS when no scheme is typed: localhost, *.local and IP
 *  addresses (a home network, Tailscale's 100.x addresses). The installer uses the same rule. */
static bool plainHttpHost(const std::wstring& hostPort) {
  if (!hostPort.empty() && hostPort[0] == L'[') return true;  // IPv6
  std::wstring name = hostPort.substr(0, hostPort.find(L':'));
  if (name == L"localhost") return true;
  if (name.size() > 6 && name.compare(name.size() - 6, 6, L".local") == 0) return true;
  int parts = 0, digits = 0, value = 0;
  for (size_t i = 0; i <= name.size(); i++) {
    wchar_t c = i < name.size() ? name[i] : L'.';
    if (c == L'.') {
      if (digits == 0 || value > 255) return false;
      parts++;
      digits = value = 0;
    } else if (iswdigit(c) && digits < 3) {
      value = value * 10 + (c - L'0');
      digits++;
    } else return false;
  }
  return parts == 4;
}

/** "https://host:port/anything" → "https://host:port"; empty if it isn't an http(s) address.
 *  Without a scheme: https, except for plainHttpHost addresses. */
static std::wstring originOf(std::wstring url) {
  while (!url.empty() && iswspace(url.back())) url.pop_back();
  while (!url.empty() && iswspace(url.front())) url.erase(url.begin());
  if (url.find(L"://") == std::wstring::npos) {
    std::wstring host = url.substr(0, url.find_first_of(L"/?#"));
    for (auto& c : host) c = towlower(c);
    url = (plainHttpHost(host) ? L"http://" : L"https://") + url;
  }
  size_t scheme = url.find(L"://");
  std::wstring sch = url.substr(0, scheme);
  for (auto& c : sch) c = towlower(c);
  if (sch != L"https" && sch != L"http") return L"";
  size_t end = url.find_first_of(L"/?#", scheme + 3);
  std::wstring host = url.substr(scheme + 3, end == std::wstring::npos ? std::wstring::npos : end - scheme - 3);
  if (host.empty() || host.find_first_of(L" @\\") != std::wstring::npos) return L"";
  for (auto& c : host) c = towlower(c);
  return sch + L"://" + host;
}
static bool sameOrigin(const std::wstring& uri) {
  if (g_server.empty()) return false;
  std::wstring o = originOf(uri);
  return !o.empty() && o == g_server;
}

// ---------- start with Windows ----------
static const wchar_t* kRunKey = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
static bool startAtLogin() {
  HKEY k;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, kRunKey, 0, KEY_READ, &k) != ERROR_SUCCESS) return false;
  bool on = RegQueryValueExW(k, L"Sara", nullptr, nullptr, nullptr, nullptr) == ERROR_SUCCESS;
  RegCloseKey(k);
  return on;
}
static void setStartAtLogin(bool on) {
  HKEY k;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, kRunKey, 0, KEY_SET_VALUE, &k) != ERROR_SUCCESS) return;
  if (on) {
    std::wstring cmd = L"\"" + exePath() + L"\" --background";
    RegSetValueExW(k, L"Sara", 0, REG_SZ, (const BYTE*)cmd.c_str(), (DWORD)((cmd.size() + 1) * sizeof(wchar_t)));
  } else RegDeleteValueW(k, L"Sara");
  RegCloseKey(k);
}

// ---------- install (a downloaded Sara.exe puts itself in the user's Programs and Start menu) ----------
static bool installIfNeeded() {
  wchar_t* p = nullptr;
  if (FAILED(SHGetKnownFolderPath(FOLDERID_UserProgramFiles, KF_FLAG_CREATE, nullptr, &p))) return false;
  std::wstring dir = std::wstring(p) + L"\\Sara";
  CoTaskMemFree(p);
  std::wstring target = dir + L"\\Sara.exe";
  std::wstring self = exePath();
  if (_wcsicmp(self.c_str(), target.c_str()) == 0) return false;  // already running the installed copy
  CreateDirectoryW(dir.c_str(), nullptr);
  if (!CopyFileW(self.c_str(), target.c_str(), FALSE)) return false;  // e.g. the installed one is running: just run from here
  // Start menu shortcut.
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Programs, 0, nullptr, &p))) {
    std::wstring lnk = std::wstring(p) + L"\\Sara.lnk";
    CoTaskMemFree(p);
    ComPtr<IShellLinkW> link;
    if (SUCCEEDED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&link)))) {
      link->SetPath(target.c_str());
      link->SetDescription(L"Sara, your companion");
      link->SetIconLocation(target.c_str(), 0);
      ComPtr<IPersistFile> file;
      if (SUCCEEDED(link.As(&file))) file->Save(lnk.c_str(), TRUE);
    }
  }
  if (startAtLogin()) setStartAtLogin(true);  // point the login entry at the installed copy
  // Listed in Settings → Apps, with Uninstall.
  HKEY k;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SaraDesktop", 0, nullptr, 0, KEY_SET_VALUE, nullptr, &k, nullptr) == ERROR_SUCCESS) {
    auto put = [&](const wchar_t* name, const std::wstring& v) { RegSetValueExW(k, name, 0, REG_SZ, (const BYTE*)v.c_str(), (DWORD)((v.size() + 1) * sizeof(wchar_t))); };
    put(L"DisplayName", L"Sara");
    put(L"DisplayVersion", kVersion);
    put(L"Publisher", L"Backstage Coding");
    put(L"DisplayIcon", target);
    put(L"InstallLocation", dir);
    put(L"UninstallString", L"\"" + target + L"\" --uninstall");
    DWORD one = 1;
    RegSetValueExW(k, L"NoModify", 0, REG_DWORD, (const BYTE*)&one, sizeof(one));
    RegSetValueExW(k, L"NoRepair", 0, REG_DWORD, (const BYTE*)&one, sizeof(one));
    RegCloseKey(k);
  }
  ShellExecuteW(nullptr, L"open", target.c_str(), nullptr, dir.c_str(), SW_SHOWNORMAL);
  return true;
}

/** Settings → Apps → Uninstall: removes the app, its shortcut, login entry and data on this PC. */
static void uninstall() {
  if (installedBySetup()) {
    // Sara-Setup.exe installed the app (with the server, or the app only): its uninstaller removes
    // it (and, with a server, asks about her data).
    std::wstring unins = exeDir() + L"\\unins000.exe";
    if (GetFileAttributesW(unins.c_str()) != INVALID_FILE_ATTRIBUTES) ShellExecuteW(nullptr, L"open", unins.c_str(), nullptr, exeDir().c_str(), SW_SHOWNORMAL);
    else MessageBoxW(nullptr, L"Sara was installed with Sara-Setup. Remove her from Settings → Apps → Sara.", L"Sara", MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND | MB_TOPMOST);
    return;
  }
  if (MessageBoxW(nullptr, L"Remove Sara from this computer? Your conversations stay on your Sara server; this only removes the app here.", L"Sara", MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND | MB_TOPMOST) != IDYES) return;
  if (HWND other = FindWindowW(kWindowClass, L"Sara")) {
    // Quit the running app and wait for it (and its WebView) to finish, so nothing is rewritten afterwards.
    DWORD pid = 0;
    GetWindowThreadProcessId(other, &pid);
    HANDLE proc = OpenProcess(SYNCHRONIZE, FALSE, pid);
    PostMessageW(other, WM_COMMAND, ID_QUIT, 0);
    if (proc) {
      WaitForSingleObject(proc, 15000);
      CloseHandle(proc);
    }
    Sleep(3000);
  }
  setStartAtLogin(false);
  RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SaraDesktop");
  wchar_t* p = nullptr;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Programs, 0, nullptr, &p))) {
    DeleteFileW((std::wstring(p) + L"\\Sara.lnk").c_str());
    CoTaskMemFree(p);
  }
  // The app's own folder and its data are removed once this process has exited.
  std::wstring self = exePath();
  std::wstring dir = self.substr(0, self.find_last_of(L'\\'));
  // (WebView2 can take several seconds to let go of its files, so it keeps trying for up to 30 s.)
  std::wstring data = dataDir();
  std::wstring cmd;
  if (GetFileAttributesW((data + L"\\data").c_str()) != INVALID_FILE_ATTRIBUTES) {
    // A Sara server keeps her data in <this folder>\data (Phase 46c): remove only the app's own files.
    std::wstring wv = data + L"\\WebView";
    cmd = L"/c timeout /t 3 /nobreak >nul & del /q \"" + data + L"\\desktop.ini\" \"" + data + L"\\desktop.log\" 2>nul & for /l %i in (1,1,15) do (if exist \"" + dir +
          L"\" rmdir /s /q \"" + dir + L"\" & if exist \"" + wv + L"\" rmdir /s /q \"" + wv + L"\" & if exist \"" + wv + L"\" timeout /t 2 /nobreak >nul)";
  } else {
    cmd = L"/c timeout /t 3 /nobreak >nul & for /l %i in (1,1,15) do (if exist \"" + dir + L"\" rmdir /s /q \"" + dir +
          L"\" & if exist \"" + data + L"\" rmdir /s /q \"" + data + L"\" & if exist \"" + data + L"\" timeout /t 2 /nobreak >nul)";
  }
  ShellExecuteW(nullptr, L"open", L"cmd.exe", cmd.c_str(), nullptr, SW_HIDE);
}

// ---------- window, tray, notifications ----------
static void showWindow() {
  if (!g_wnd) return;
  ShowWindow(g_wnd, IsIconic(g_wnd) ? SW_RESTORE : SW_SHOW);
  SetForegroundWindow(g_wnd);
  if (g_controller) g_controller->put_IsVisible(TRUE);
}
static bool windowInFront() { return g_wnd && IsWindowVisible(g_wnd) && !IsIconic(g_wnd) && GetForegroundWindow() == g_wnd; }

static void logLine(const std::wstring& line) {
  FILE* f = nullptr;
  if (_wfopen_s(&f, (dataDir() + L"\\desktop.log").c_str(), L"a, ccs=UTF-8") == 0 && f) {
    SYSTEMTIME t;
    GetLocalTime(&t);
    fwprintf(f, L"%04d-%02d-%02d %02d:%02d:%02d %s\n", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, line.c_str());
    fclose(f);
  }
}

static std::wstring g_balloonTitle, g_balloonBody;
/** Shown from the message loop (calling the shell from inside a WebView2 callback times out). */
static void trayBalloon(const std::wstring& title, const std::wstring& body) {
  g_balloonTitle = title;
  g_balloonBody = body;
  PostMessageW(g_wnd, WM_APP_BALLOON, 0, 0);
}
static void showBalloonNow() {
  const std::wstring& title = g_balloonTitle;
  const std::wstring& body = g_balloonBody;
  g_tray.uFlags = NIF_INFO;
  wcsncpy_s(g_tray.szInfoTitle, title.c_str(), _TRUNCATE);
  wcsncpy_s(g_tray.szInfo, body.empty() ? L" " : body.c_str(), _TRUNCATE);
  // No extra icon: Windows already shows Sara's icon and name on the notification (NIIF_USER with
  // a custom balloon icon fails here with a timeout).
  g_tray.dwInfoFlags = NIIF_NONE;
  g_tray.uTimeout = 10000;
  if (!Shell_NotifyIconW(NIM_MODIFY, &g_tray)) logLine(L"notification failed (" + std::to_wstring(GetLastError()) + L")");
}

static void addTray() {
  g_tray.cbSize = sizeof(g_tray);
  g_tray.hWnd = g_wnd;
  g_tray.uID = kTrayId;
  g_tray.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
  g_tray.uCallbackMessage = WM_APP_TRAY;
  g_tray.hIcon = (HICON)LoadImageW(g_inst, MAKEINTRESOURCEW(IDI_SARA), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
  g_tray.hBalloonIcon = (HICON)LoadImageW(g_inst, MAKEINTRESOURCEW(IDI_SARA), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), 0);
  wcscpy_s(g_tray.szTip, L"Sara");
  if (!Shell_NotifyIconW(NIM_ADD, &g_tray)) logLine(L"tray icon failed (" + std::to_wstring(GetLastError()) + L")");
}

static void trayMenu() {
  HMENU m = CreatePopupMenu();
  AppendMenuW(m, MF_STRING, ID_OPEN, L"Open Sara");
  AppendMenuW(m, MF_STRING | (startAtLogin() ? MF_CHECKED : 0), ID_LOGIN, L"Start with Windows");
  AppendMenuW(m, MF_STRING, ID_CHANGE, L"Connect to a different Sara…");
  AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(m, MF_STRING, ID_QUIT, L"Quit Sara");
  POINT pt;
  GetCursorPos(&pt);
  SetForegroundWindow(g_wnd);
  TrackPopupMenu(m, TPM_RIGHTBUTTON, pt.x, pt.y, 0, g_wnd, nullptr);
  DestroyMenu(m);
}

// ---------- pages shown before the server is known or when it can't be reached ----------
static const wchar_t* kPageStyle =
    L"<meta name=viewport content='width=device-width'><style>body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#121016;color:#eee;"
    L"display:flex;align-items:center;justify-content:center;height:100vh}.c{max-width:420px;padding:28px;background:#1c1922;border-radius:16px;box-shadow:0 10px 40px #0006}"
    L"h1{font-size:22px;margin:0 0 8px}p{color:#aaa;line-height:1.45;font-size:14px}input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:9px;"
    L"border:1px solid #444;background:#0f0d12;color:#eee;font-size:15px}button{margin-top:14px;padding:10px 18px;border:0;border-radius:9px;background:#c76b98;color:#fff;"
    L"font-size:15px;cursor:pointer}button.g{background:none;border:1px solid #555;color:#ccc;margin-left:8px}#e{color:#f88;font-size:13px;min-height:1em}</style>";

static std::wstring htmlEscape(const std::wstring& s) {
  std::wstring o;
  for (wchar_t c : s) {
    if (c == L'&') o += L"&amp;";
    else if (c == L'<') o += L"&lt;";
    else if (c == L'>') o += L"&gt;";
    else if (c == L'\'') o += L"&#39;";
    else if (c == L'"') o += L"&quot;";
    else o += c;
  }
  return o;
}

static void showSetup(const std::wstring& error = L"") {
  std::wstring port = localPort();
  std::wstring html = std::wstring(L"<!doctype html><html><head>") + kPageStyle +
                      L"</head><body><div class=c><h1>Welcome to Sara</h1><p>Type the address of your Sara (the one you open in a web browser, "
                      L"for example <b>sara.example.com</b>).</p><input id=u autofocus placeholder='sara.example.com' value='" +
                      htmlEscape(getPref(L"lastServer")) +
                      L"'><p id=e>" + htmlEscape(error) +
                      L"</p><button id=b>Continue</button><p>Next you sign in with a code from Settings → Devices and sign-in on a device where "
                      L"you're already signed in.</p>" +
                      (port.empty() ? L"" : L"<p><a href='#' id=l style='color:#e3a3c3'>Or use Sara on this computer</a></p>") +
                      L"</div><script>const go=()=>chrome.webview.postMessage({m:'setServer',url:document.getElementById('u').value});"
                      L"const l=document.getElementById('l');if(l)l.onclick=(e)=>{e.preventDefault();chrome.webview.postMessage({m:'useLocal'})};"
                      L"document.getElementById('b').onclick=go;document.getElementById('u').onkeydown=e=>e.key==='Enter'&&go();</script></body></html>";
  if (g_web) g_web->NavigateToString(html.c_str());
}

/** The server is her own on this computer (installed together with this app). */
static bool serverIsLocal() {
  std::wstring port = localPort();
  return !port.empty() && (g_server == L"http://127.0.0.1:" + port || g_server == L"http://localhost:" + port);
}

static void showOffline() {
  std::wstring why = serverIsLocal()
      ? L"She runs on this computer and may still be starting. If she doesn't answer in a minute, open a terminal and run <b>sara status</b> (and <b>sara logs</b>)."
      : L"Check your internet connection, that the address is right, and that Sara is running there.";
  std::wstring html = std::wstring(L"<!doctype html><html><head>") + kPageStyle + L"</head><body><div class=c><h1>Can't reach your Sara</h1><p>Sara at <b>" +
                      htmlEscape(g_server) + L"</b> isn't answering.</p><p>" + why +
                      L"</p><button id=r>Try again</button><button class=g id=s>Change address</button></div><script>document.getElementById('r').onclick=()=>chrome.webview.postMessage({m:'retry'});"
                      L"document.getElementById('s').onclick=()=>chrome.webview.postMessage({m:'changeServer'});setTimeout(()=>chrome.webview.postMessage({m:'retry'}),30000);</script></body></html>";
  if (g_web) g_web->NavigateToString(html.c_str());
}

/** Connect to a different Sara: this app signs out of the old one and keeps nothing from it (its
 *  cookies, storage and cache in the app's web view profile are cleared), then asks for the new
 *  address. The new server can never receive the old one's sign-in. */
static void forgetServer() {
  g_server.clear();
  setPref(L"server", L"");
  if (!g_web) return;
  ComPtr<ICoreWebView2_2> w2;
  if (SUCCEEDED(g_web.As(&w2))) {
    ComPtr<ICoreWebView2CookieManager> cm;
    if (SUCCEEDED(w2->get_CookieManager(&cm))) cm->DeleteAllCookies();
  }
  ComPtr<ICoreWebView2_13> w13;
  ComPtr<ICoreWebView2Profile> profile;
  ComPtr<ICoreWebView2Profile2> p2;
  if (SUCCEEDED(g_web.As(&w13)) && SUCCEEDED(w13->get_Profile(&profile)) && SUCCEEDED(profile.As(&p2))) {
    g_web->NavigateToString(L"<!doctype html><html><body style='background:#121016'></body></html>");
    HRESULT hr = p2->ClearBrowsingDataAll(Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>([](HRESULT) -> HRESULT {
                    logLine(L"signed out of the old server (browsing data cleared)");
                    showSetup();
                    return S_OK;
                  }).Get());
    if (SUCCEEDED(hr)) return;
  }
  showSetup();
}

/** Tray menu → Connect to a different Sara… */
static void changeServerFromMenu() {
  showWindow();
  if (!g_server.empty()) {
    std::wstring q = L"Connect to a different Sara?\n\nThis app signs out of " + g_server +
                     L" and forgets it. Then you type the new address and sign in there with a code. Nothing changes on " + g_server + L".";
    if (MessageBoxW(g_wnd, q.c_str(), L"Sara", MB_YESNO | MB_ICONQUESTION) != IDYES) return;
  }
  forgetServer();
}

static void openServer(const std::wstring& path = L"/") {
  if (g_server.empty()) return showSetup();
  g_web->Navigate((g_server + path).c_str());
}

// ---------- the bridge (window.SaraDesktop in the page) ----------
static const wchar_t* kShim = LR"JS(
(() => {
  if (window.SaraDesktop || !window.chrome || !chrome.webview) return;
  let next = 1;
  const pending = new Map();
  chrome.webview.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error)) : p.resolve(d.result); }
    if (d.open) location.hash = 'c=' + d.open;
  });
  const post = (o) => chrome.webview.postMessage(o);
  window.SaraDesktop = {
    platform: 'windows',
    call(m, a = {}) { return new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); post({ id, m, ...a }); }); },
    notify(title, body, conv) { post({ m: 'notify', title: String(title || ''), body: String(body || ''), conv: String(conv || '') }); },
    attention(kind) { post({ m: 'attention', kind: String(kind || '') }); },
  };
})();
)JS";

static void reply(const std::wstring& id, const std::wstring& resultJson, const std::wstring& error = L"") {
  if (id.empty() || !g_web) return;
  std::wstring msg = L"{\"id\":" + id + (error.empty() ? L",\"result\":" + resultJson : L",\"error\":\"" + jsonEscape(error) + L"\"") + L"}";
  g_web->PostWebMessageAsJson(msg.c_str());
}

static std::wstring prefsJson() {
  return std::wstring(L"{\"platform\":\"windows\",\"version\":\"") + kVersion + L"\",\"startAtLogin\":" + (startAtLogin() ? L"true" : L"false") +
         L",\"keepRunning\":" + (prefOn(L"keepRunning", true) ? L"true" : L"false") + L",\"notifications\":" + (prefOn(L"notifications", true) ? L"true" : L"false") +
         L",\"server\":\"" + jsonEscape(g_server) + L"\"}";
}

static void onMessage(const std::wstring& json, const std::wstring& source) {
  auto m = parseFlatJson(json);
  const std::wstring& kind = m[L"m"];
  const std::wstring id = m[L"id"];
  bool fromServer = sameOrigin(source);
  // The local setup/offline pages may only set the server, retry or change server.
  if (kind == L"setServer") {
    std::wstring o = originOf(m[L"url"]);
    if (o.empty()) return showSetup(L"That doesn't look like a web address. Try something like sara.example.com.");
    g_server = o;
    setPref(L"server", o);
    setPref(L"lastServer", o);
    return openServer(L"/pair");
  }
  if (kind == L"retry") return openServer();
  if (kind == L"changeServer") return forgetServer();
  if (kind == L"useLocal") {
    std::wstring port = localPort();
    if (port.empty()) return showSetup();
    g_server = L"http://127.0.0.1:" + port;
    setPref(L"server", g_server);
    setPref(L"lastServer", g_server);
    return openServer();
  }
  if (!fromServer) return;  // everything else only from the owner's own server
  if (kind == L"getPrefs") return reply(id, prefsJson());
  if (kind == L"setPref") {
    const std::wstring& key = m[L"key"];
    bool on = m[L"value"] == L"true";
    if (key == L"startAtLogin") setStartAtLogin(on);
    else if (key == L"keepRunning" || key == L"notifications") setPref(key.c_str(), on ? L"1" : L"0");
    else return reply(id, L"null", L"Unknown setting");
    return reply(id, prefsJson());
  }
  if (kind == L"testNotification") {
    g_pendingConv.clear();
    trayBalloon(m[L"title"], m[L"body"]);
    return reply(id, L"true");
  }
  if (kind == L"notify") {
    if (!prefOn(L"notifications", true) || windowInFront()) return;
    g_pendingConv = m[L"conv"];
    trayBalloon(m[L"title"], m[L"body"]);
    return;
  }
  if (kind == L"attention") {
    // A call: bring the window up (Windows may only flash the taskbar button if another app is busy).
    showWindow();
    FLASHWINFO f{sizeof(f), g_wnd, FLASHW_ALL | FLASHW_TIMERNOFG, 0, 0};
    FlashWindowEx(&f);
    return;
  }
}

static void createWebView() {
  std::wstring userData = dataDir() + L"\\WebView";
  HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, userData.c_str(), nullptr,
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([](HRESULT res, ICoreWebView2Environment* env) -> HRESULT {
        if (FAILED(res) || !env) {
          if (MessageBoxW(g_wnd, L"Sara needs Microsoft Edge WebView2, which is part of Windows 11 and most Windows 10 PCs. Open the download page?", L"Sara", MB_YESNO | MB_ICONWARNING | MB_SETFOREGROUND) == IDYES)
            ShellExecuteW(nullptr, L"open", L"https://developer.microsoft.com/microsoft-edge/webview2/", nullptr, nullptr, SW_SHOWNORMAL);
          PostQuitMessage(1);
          return S_OK;
        }
        env->CreateCoreWebView2Controller(g_wnd, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([](HRESULT r2, ICoreWebView2Controller* ctl) -> HRESULT {
          if (FAILED(r2) || !ctl) return S_OK;
          g_controller = ctl;
          g_controller->get_CoreWebView2(&g_web);
          RECT rc;
          GetClientRect(g_wnd, &rc);
          g_controller->put_Bounds(rc);
          ComPtr<ICoreWebView2Controller2> c2;
          if (SUCCEEDED(g_controller.As(&c2))) c2->put_DefaultBackgroundColor({255, 0x12, 0x10, 0x16});

          ComPtr<ICoreWebView2Settings> settings;
          g_web->get_Settings(&settings);
          settings->put_AreDevToolsEnabled(FALSE);
          settings->put_IsStatusBarEnabled(FALSE);
          ComPtr<ICoreWebView2Settings2> s2;
          if (SUCCEEDED(settings.As(&s2))) {
            LPWSTR ua = nullptr;
            s2->get_UserAgent(&ua);
            std::wstring full = std::wstring(ua ? ua : L"") + L" SaraDesktop/1 (Windows)";
            CoTaskMemFree(ua);
            s2->put_UserAgent(full.c_str());
          }

          // Only the owner's server opens inside the app; other links go to the browser.
          g_web->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* a) -> HRESULT {
            LPWSTR uri = nullptr;
            a->get_Uri(&uri);
            std::wstring u = uri ? uri : L"";
            CoTaskMemFree(uri);
            if (u.rfind(L"data:", 0) == 0 || u.rfind(L"about:", 0) == 0 || sameOrigin(u)) return S_OK;
            a->put_Cancel(TRUE);
            if (u.rfind(L"http", 0) == 0) ShellExecuteW(nullptr, L"open", u.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            return S_OK;
          }).Get(), nullptr);
          g_web->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* a) -> HRESULT {
            LPWSTR uri = nullptr;
            a->get_Uri(&uri);
            std::wstring u = uri ? uri : L"";
            CoTaskMemFree(uri);
            a->put_Handled(TRUE);
            if (u.rfind(L"http", 0) == 0) ShellExecuteW(nullptr, L"open", u.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            return S_OK;
          }).Get(), nullptr);
          // Can't reach the server: a friendly page with Try again.
          g_web->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>([](ICoreWebView2* w, ICoreWebView2NavigationCompletedEventArgs* a) -> HRESULT {
            BOOL ok = TRUE;
            a->get_IsSuccess(&ok);
            COREWEBVIEW2_WEB_ERROR_STATUS st;
            a->get_WebErrorStatus(&st);
            LPWSTR uri = nullptr;
            w->get_Source(&uri);
            std::wstring u = uri ? uri : L"";
            CoTaskMemFree(uri);
            if (!ok && sameOrigin(u) && st != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED) showOffline();
            return S_OK;
          }).Get(), nullptr);
          // Microphone (calls, voice messages) and notifications: allowed for the owner's server only.
          g_web->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* a) -> HRESULT {
            LPWSTR uri = nullptr;
            a->get_Uri(&uri);
            std::wstring u = uri ? uri : L"";
            CoTaskMemFree(uri);
            COREWEBVIEW2_PERMISSION_KIND k;
            a->get_PermissionKind(&k);
            bool wanted = k == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || k == COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS || k == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ;
            a->put_State(sameOrigin(u) && wanted ? COREWEBVIEW2_PERMISSION_STATE_ALLOW : COREWEBVIEW2_PERMISSION_STATE_DEFAULT);
            return S_OK;
          }).Get(), nullptr);
          g_web->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>([](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* a) -> HRESULT {
            LPWSTR json = nullptr, src = nullptr;
            a->get_WebMessageAsJson(&json);
            a->get_Source(&src);
            std::wstring j = json ? json : L"", s = src ? src : L"";
            CoTaskMemFree(json);
            CoTaskMemFree(src);
            onMessage(j, s);
            return S_OK;
          }).Get(), nullptr);
          // Open the server only once the bridge script is registered, or the first page misses it.
          g_web->AddScriptToExecuteOnDocumentCreated(kShim, Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>([](HRESULT, LPCWSTR) -> HRESULT {
            // Phase 55: the installer set the address of a Sara elsewhere: the first start goes
            // straight to her sign-in with a code.
            if (getPref(L"pairNext") == L"1") {
              setPref(L"pairNext", L"");
              if (!g_server.empty()) {
                openServer(L"/pair");
                return S_OK;
              }
            }
            openServer();
            return S_OK;
          }).Get());
          return S_OK;
        }).Get());
        return S_OK;
      }).Get());
  if (FAILED(hr)) {
    MessageBoxW(g_wnd, L"Sara couldn't start Microsoft Edge WebView2.", L"Sara", MB_ICONERROR);
    PostQuitMessage(1);
  }
}

static void saveWindowPlace() {
  WINDOWPLACEMENT wp{sizeof(wp)};
  if (!GetWindowPlacement(g_wnd, &wp)) return;
  RECT& r = wp.rcNormalPosition;
  setPref(L"window", std::to_wstring(r.left) + L"," + std::to_wstring(r.top) + L"," + std::to_wstring(r.right) + L"," + std::to_wstring(r.bottom) + L"," + (wp.showCmd == SW_SHOWMAXIMIZED ? L"1" : L"0"));
}

static LRESULT CALLBACK WndProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_SIZE:
      if (g_controller) {
        RECT rc;
        GetClientRect(h, &rc);
        g_controller->put_Bounds(rc);
      }
      return 0;
    case WM_CLOSE:
      saveWindowPlace();
      if (!g_quitting && prefOn(L"keepRunning", true)) {
        ShowWindow(h, SW_HIDE);
        if (!g_toldAboutTray && getPref(L"toldTray") != L"1") {
          g_toldAboutTray = true;
          setPref(L"toldTray", L"1");
          g_pendingConv.clear();
          trayBalloon(L"Sara is still here", L"She keeps running next to the clock so she can reach you. Right-click her icon to quit.");
        }
        return 0;
      }
      DestroyWindow(h);
      return 0;
    case WM_QUERYENDSESSION:
      return TRUE;
    case WM_ENDSESSION:
      // Windows is signing out, or an installer asks the app to close (Restart Manager): really quit.
      if (wp) {
        g_quitting = true;
        saveWindowPlace();
        DestroyWindow(h);
      }
      return 0;
    case WM_DESTROY:
      Shell_NotifyIconW(NIM_DELETE, &g_tray);
      PostQuitMessage(0);
      return 0;
    case WM_APP_SHOW:
      showWindow();
      return 0;
    case WM_APP_BALLOON:
      showBalloonNow();
      return 0;
    case WM_APP_TRAY:
      switch (LOWORD(lp)) {
        case WM_LBUTTONUP:
        case NIN_SELECT:
        case NIN_KEYSELECT:
          showWindow();
          break;
        case WM_CONTEXTMENU:
        case WM_RBUTTONUP:
          trayMenu();
          break;
        case NIN_BALLOONUSERCLICK:
          showWindow();
          if (!g_pendingConv.empty() && g_web) g_web->PostWebMessageAsJson((L"{\"open\":\"" + jsonEscape(g_pendingConv) + L"\"}").c_str());
          g_pendingConv.clear();
          break;
      }
      return 0;
    case WM_COMMAND:
      switch (LOWORD(wp)) {
        case ID_OPEN: showWindow(); break;
        case ID_LOGIN: setStartAtLogin(!startAtLogin()); break;
        case ID_CHANGE: changeServerFromMenu(); break;
        case ID_QUIT:
          g_quitting = true;
          SendMessageW(h, WM_CLOSE, 0, 0);
          break;
      }
      return 0;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, LPWSTR cmd, int show) {
  g_inst = inst;
  bool background = wcsstr(cmd, L"--background") != nullptr;
  bool portable = wcsstr(cmd, L"--portable") != nullptr;
  if (wcsstr(cmd, L"--uninstall")) {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    uninstall();
    return 0;
  }
  // One Sara at a time: a second start just shows the first.
  HANDLE single = CreateMutexW(nullptr, TRUE, L"Local\\SaraDesktopApp");
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    if (HWND other = FindWindowW(kWindowClass, nullptr)) PostMessageW(other, WM_APP_SHOW, 0, 0);
    return 0;
  }
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (!portable && !installedBySetup() && installIfNeeded()) {
    CloseHandle(single);
    return 0;
  }
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  g_server = getPref(L"server");
  // Phase 46c: the installer's "Open Sara" passes the address of the server it just installed.
  {
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    for (int i = 1; argv && i + 1 < argc; i++) {
      if (wcscmp(argv[i], L"--server") != 0) continue;
      std::wstring o = originOf(argv[i + 1]);
      if (!o.empty()) {
        g_server = o;
        setPref(L"server", o);
        setPref(L"lastServer", o);
      }
    }
    if (argv) LocalFree(argv);
  }

  WNDCLASSEXW wc{sizeof(wc)};
  wc.lpfnWndProc = WndProc;
  wc.hInstance = inst;
  wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(IDI_SARA));
  wc.hIconSm = (HICON)LoadImageW(inst, MAKEINTRESOURCEW(IDI_SARA), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.hbrBackground = CreateSolidBrush(RGB(0x12, 0x10, 0x16));
  wc.lpszClassName = kWindowClass;
  RegisterClassExW(&wc);

  int x = CW_USEDEFAULT, y = CW_USEDEFAULT, w = 1100, hgt = 780;
  bool maximized = false;
  std::wstring place = getPref(L"window");
  int l, t, r, b, mx;
  if (swscanf_s(place.c_str(), L"%d,%d,%d,%d,%d", &l, &t, &r, &b, &mx) == 5 && r - l > 300 && b - t > 300) {
    x = l; y = t; w = r - l; hgt = b - t; maximized = mx == 1;
  }
  g_wnd = CreateWindowExW(0, kWindowClass, L"Sara", WS_OVERLAPPEDWINDOW, x, y, w, hgt, nullptr, nullptr, inst, nullptr);
  addTray();
  if (!background) ShowWindow(g_wnd, maximized ? SW_SHOWMAXIMIZED : show);
  createWebView();

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  CoUninitialize();
  CloseHandle(single);
  return (int)msg.wParam;
}

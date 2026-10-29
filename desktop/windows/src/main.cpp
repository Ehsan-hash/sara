// Sara for Windows (Phase 33): a native window around the owner's own Sara server, using the
// system's Edge WebView2. Tray icon (keeps running when the window is closed), notifications,
// start with Windows, microphone for calls, first-run setup (server address, then the server's own
// /pair page for the sign-in code). No credentials are stored here: the sign-in is the server's
// session cookie, kept in this user's WebView2 profile.
// Phase 55: works the same against a Sara on another computer or server (the installer's
// "Connect to a Sara somewhere else" installs only this app): a different server from the tray menu,
// and a "can't reach your Sara" page with Try again.
// Phase 68: several Sara servers in one app, each with its own sign-in. Every server has its own
// WebView2 profile (cookies, storage, cache: kept apart, encrypted by WebView2 with this Windows
// user's DPAPI key); the first one is the profile used before 1.8, so an update keeps its sign-in.
// The tray menu and the page's ⇄ menu switch between them without signing out.
// Phase 75 (the new look): a dark or light title bar that follows the page's theme (Night / Day),
// Mica behind it on Windows 11 22H2+, the page drawn into the title area (WebView2's non-client
// region support: CSS app-region: drag) with the native minimize / maximize / close buttons kept
// (DWM draws them; snap layouts on the maximize button keep working), and the theme colour from the
// first frame so there is never a white flash. Older Windows or an older WebView2: the normal title
// bar, dark or light. The page learns all of it from window.saraShell (kShellScript below).
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <dwmapi.h>
#include <uxtheme.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <wrl.h>
#include <objbase.h>
#include <string>
#include <map>
#include <vector>
#include <ctime>
#include <windowsx.h>
#include "WebView2.h"
#include "resource.h"
#include "page-logo.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

// The version is package.json's (CMakeLists.txt passes it in), so Settings → This computer shows
// the release it came with.
#ifndef SARA_APP_VERSION
#define SARA_APP_VERSION "0.0.0-dev"
#endif
#define SARA_WIDEN2(x) L##x
#define SARA_WIDEN(x) SARA_WIDEN2(x)
static const wchar_t* kVersion = SARA_WIDEN(SARA_APP_VERSION);
static const wchar_t* kWindowClass = L"SaraDesktopWindow";
static const UINT WM_APP_TRAY = WM_APP + 1;
static const UINT WM_APP_SHOW = WM_APP + 2;
static const UINT WM_APP_BALLOON = WM_APP + 3;
static const UINT WM_APP_SWITCH = WM_APP + 4;   // switch to g_switchTo (from the message loop)
static const UINT WM_APP_REMOVED = WM_APP + 5;  // finish removing a server (sign-in cleared)
static const UINT kTrayId = 1;
static const UINT_PTR kRemoveTimer = 7;
enum MenuId { ID_OPEN = 100, ID_LOGIN, ID_QUIT, ID_CHANGE, ID_SETTINGS, ID_HELP, ID_SERVER0 = 200 };

static HINSTANCE g_inst;
static HWND g_wnd;
static ComPtr<ICoreWebView2Controller> g_controller;
static ComPtr<ICoreWebView2> g_web;
static ComPtr<ICoreWebView2Environment> g_env;
static std::wstring g_profile;       // Phase 68: the server in use (s1, s2, …)
static std::wstring g_switchTo, g_switchPath;
static std::wstring g_removing;      // being signed out and forgotten
static std::wstring g_removeAfterLoad;
static std::wstring g_nextPath = L"/";
static NOTIFYICONDATAW g_tray{};
static std::wstring g_server;        // e.g. https://sara.example.com (origin, no trailing slash)
static std::wstring g_pendingConv;   // conversation to open when a notification is clicked
static bool g_quitting = false;
static bool g_toldAboutTray = false;

// ---------- small helpers ----------
static std::wstring dataDir() {
#ifdef SARA_TEST_HOOKS
  // Test builds only (cmake -DSARA_TEST_HOOKS=ON): a data folder of their own, so a test run never
  // touches the real app's settings or sign-ins on this PC. Release builds don't contain this.
  wchar_t t[MAX_PATH];
  if (GetEnvironmentVariableW(L"SARA_DESKTOP_TEST_DIR", t, MAX_PATH) > 0) {
    CreateDirectoryW(t, nullptr);
    return t;
  }
#endif
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
static std::wstring getIni(const std::wstring& section, const wchar_t* key) {
  wchar_t buf[2048];
  GetPrivateProfileStringW(section.c_str(), key, L"", buf, 2048, iniPath().c_str());
  return buf;
}
static void setIni(const std::wstring& section, const wchar_t* key, const std::wstring& v) { WritePrivateProfileStringW(section.c_str(), key, v.c_str(), iniPath().c_str()); }

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

// ---------- Phase 68: the saved servers ----------
// desktop.ini: [servers] list=s1,s2 active=s2; [server.s1] url, name, named, emoji, lastUsed.
// No sign-in is stored here: each server's sign-in is its session cookie in its own WebView2
// profile (s1: the default profile, as before 1.8; the others: "sara-<id>").
struct Profile {
  std::wstring id, url, name, emoji;
  bool named = false;
  long long lastUsed = 0;
};
static std::wstring hostOfUrl(const std::wstring& url) {
  size_t p = url.find(L"://");
  return p == std::wstring::npos ? url : url.substr(p + 3);
}
static std::vector<std::wstring> profileIds() {
  std::vector<std::wstring> out;
  std::wstring list = getIni(L"servers", L"list"), cur;
  for (wchar_t c : list + L",") {
    if (c == L',') {
      if (!cur.empty()) out.push_back(cur);
      cur.clear();
    } else if (iswalnum(c)) cur += c;
  }
  return out;
}
static void setProfileIds(const std::vector<std::wstring>& ids) {
  std::wstring list;
  for (auto& i : ids) list += (list.empty() ? L"" : L",") + i;
  setIni(L"servers", L"list", list);
}
static Profile loadProfile(const std::wstring& id) {
  std::wstring sec = L"server." + id;
  Profile p;
  p.id = id;
  p.url = getIni(sec, L"url");
  p.name = getIni(sec, L"name");
  if (p.name.empty()) p.name = hostOfUrl(p.url);
  p.emoji = getIni(sec, L"emoji");
  p.named = getIni(sec, L"named") == L"1";
  p.lastUsed = _wtoi64(getIni(sec, L"lastUsed").c_str());
  return p;
}
static void saveProfile(const Profile& p) {
  std::wstring sec = L"server." + p.id;
  setIni(sec, L"url", p.url);
  setIni(sec, L"name", p.name);
  setIni(sec, L"named", p.named ? L"1" : L"0");
  setIni(sec, L"emoji", p.emoji);
  setIni(sec, L"lastUsed", std::to_wstring(p.lastUsed));
}
static std::vector<Profile> profiles() {
  std::vector<Profile> out;
  for (auto& id : profileIds()) {
    Profile p = loadProfile(id);
    if (!p.url.empty()) out.push_back(p);
  }
  return out;
}
static std::wstring lower(std::wstring s) {
  for (auto& c : s) c = towlower(c);
  return s;
}
/** A name no other saved server uses: "Sara", then "Sara (127.0.0.1:7882)". */
static std::wstring uniqueName(const std::wstring& wanted, const std::wstring& url, const std::wstring& self) {
  auto taken = [&](const std::wstring& n) {
    for (auto& p : profiles())
      if (p.id != self && lower(p.name) == lower(n)) return true;
    return false;
  };
  std::wstring base = wanted.empty() ? hostOfUrl(url) : wanted.substr(0, 60);
  if (!taken(base)) return base;
  std::wstring withHost = base + L" (" + hostOfUrl(url) + L")";
  if (!taken(withHost)) return withHost;
  for (int i = 2;; i++)
    if (!taken(withHost + L" " + std::to_wstring(i))) return withHost + L" " + std::to_wstring(i);
}
/** The saved server at exactly this address, or a new one (not signed in yet). */
static std::wstring profileFor(const std::wstring& url) {
  for (auto& p : profiles())
    if (p.url == url) return p.id;
  auto ids = profileIds();
  std::wstring id;
  for (int i = 1;; i++) {
    id = L"s" + std::to_wstring(i);
    bool used = false;
    for (auto& x : ids) used = used || x == id;
    if (!used && loadProfile(id).url.empty()) break;
  }
  Profile p;
  p.id = id;
  p.url = url;
  p.name = uniqueName(L"", url, id);
  saveProfile(p);
  ids.push_back(id);
  setProfileIds(ids);
  return id;
}
/** Makes it the one in use (the address is also kept in "server", as before 1.8). */
static void activate(const std::wstring& id) {
  Profile p = loadProfile(id);
  p.lastUsed = (long long)time(nullptr);
  saveProfile(p);
  g_profile = id;
  g_server = p.url;
  setIni(L"servers", L"active", id);
  setPref(L"server", p.url);
  std::wstring tip = L"Sara · " + p.name;
  wcsncpy_s(g_tray.szTip, tip.c_str(), _TRUNCATE);
  if (g_tray.hWnd) {
    g_tray.uFlags = NIF_TIP;
    Shell_NotifyIconW(NIM_MODIFY, &g_tray);
  }
}
/** The one server saved before 1.8 becomes profile s1, with its sign-in, with nothing to do. */
static void migrateProfiles() {
  if (!profileIds().empty() || g_server.empty()) return;
  Profile p;
  p.id = L"s1";
  p.url = g_server;
  p.name = hostOfUrl(g_server);
  p.lastUsed = (long long)time(nullptr);
  saveProfile(p);
  setProfileIds({L"s1"});
  setIni(L"servers", L"active", L"s1");
}
static void forgetProfile(const std::wstring& id) {
  auto ids = profileIds();
  std::vector<std::wstring> keep;
  for (auto& x : ids)
    if (x != id) keep.push_back(x);
  setProfileIds(keep);
  WritePrivateProfileStringW((L"server." + id).c_str(), nullptr, nullptr, iniPath().c_str());
}
static std::wstring serversJson() {
  std::wstring out = L"{\"servers\":[";
  bool first = true;
  for (auto& p : profiles()) {
    out += (first ? L"" : L",") + std::wstring(L"{\"id\":\"") + jsonEscape(p.id) + L"\",\"name\":\"" + jsonEscape(p.name) + L"\",\"host\":\"" + jsonEscape(hostOfUrl(p.url)) +
           L"\",\"emoji\":\"" + jsonEscape(p.emoji) + L"\",\"active\":" + (p.id == g_profile ? L"true" : L"false") + L"}";
    first = false;
  }
  return out + L"]}";
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

// ---------- Phase 75: theme, title bar, Mica ----------
// The page's theme is Night (dark, the default) or Day. The page tells the app when it changes
// ({type:'theme', theme:'night'|'day'|'system'}); the app remembers it in desktop.ini so the next
// start opens in the right colours before the page has loaded.
static const COLORREF kNight = RGB(0x0f, 0x0d, 0x17);
static const COLORREF kDay = RGB(0xfa, 0xf7, 0xf5);
static std::wstring g_themePref = L"night";  // night | day | system (as the page said)
static bool g_day = false;                    // what is shown now
static bool g_customFrame = false;            // the page draws into the title area
static bool g_wantCustomFrame = false;        // Windows 11 + a WebView2 that has app-region support
static bool g_mica = false;                   // DWMSBT_MAINWINDOW is set (Windows 11 22H2+)
static bool g_wantMica = false;               // the page asked for Mica (its background is see-through)
// The page said it draws its header in the title strip ({type:'shell', titlebar:true}); until then
// (an older Sara server, a page still loading) the app keeps a plain title strip of its own above it.
static bool g_pageTitle = false;
static std::wstring g_pageTitleOrigin;
static HBRUSH g_bgBrush = nullptr;
static const int kTitlebarDip = 40;           // the page's header strip (CSS px)

static DWORD windowsBuild() {
  static DWORD build = 0;
  if (build) return build;
  using RtlGetVersionFn = LONG(WINAPI*)(OSVERSIONINFOW*);
  if (HMODULE nt = GetModuleHandleW(L"ntdll.dll")) {
    if (auto fn = reinterpret_cast<RtlGetVersionFn>(reinterpret_cast<void*>(GetProcAddress(nt, "RtlGetVersion")))) {
      OSVERSIONINFOW v{sizeof(v)};
      if (fn(&v) == 0) build = v.dwBuildNumber;
    }
  }
  return build;
}
static bool systemUsesLight() {
  DWORD v = 0, n = sizeof(v);
  if (RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &v, &n) != ERROR_SUCCESS) return false;
  return v != 0;
}
static bool resolveDay(const std::wstring& pref) { return pref == L"day" || (pref == L"system" && systemUsesLight()); }
static COLORREF themeColor() { return g_day ? kDay : kNight; }
static UINT windowDpi() { return g_wnd ? GetDpiForWindow(g_wnd) : 96; }
/** The resize border at the top while the page draws into the title area (not when maximized). */
static int topResizeBand() {
  if (!g_customFrame || !g_wnd || IsZoomed(g_wnd)) return 0;
  UINT dpi = windowDpi();
  return GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
}
static int titlebarPx() { return MulDiv(kTitlebarDip, (int)windowDpi(), 96); }
/** Where DWM draws minimize / maximize / close, in client coordinates (empty without the custom frame). */
static RECT captionButtons() {
  RECT r{};
  if (!g_customFrame || FAILED(DwmGetWindowAttribute(g_wnd, DWMWA_CAPTION_BUTTON_BOUNDS, &r, sizeof(r)))) return RECT{};
  // The bounds are relative to the window; the client area starts after the left border.
  RECT wr;
  GetWindowRect(g_wnd, &wr);
  POINT origin{0, 0};
  ClientToScreen(g_wnd, &origin);
  OffsetRect(&r, wr.left - origin.x, wr.top - origin.y);
  return r;
}

/** The web view fills the window below the top resize band (or below the app's own title strip
 *  while the page doesn't draw one); with the custom frame its window is cut out under the caption
 *  buttons, so DWM's own buttons show (and take the clicks) there. */
static void layoutWebView() {
  if (!g_controller || !g_wnd) return;
  RECT rc;
  GetClientRect(g_wnd, &rc);
  rc.top += g_customFrame && !g_pageTitle ? titlebarPx() : topResizeBand();
  g_controller->put_Bounds(rc);
  RECT btn = captionButtons();
  for (HWND c = GetWindow(g_wnd, GW_CHILD); c; c = GetWindow(c, GW_HWNDNEXT)) {
    if (!g_customFrame || IsRectEmpty(&btn)) {
      SetWindowRgn(c, nullptr, TRUE);
      continue;
    }
    HRGN all = CreateRectRgn(0, 0, rc.right - rc.left, rc.bottom - rc.top);
    HRGN hole = CreateRectRgn(btn.left - rc.left, btn.top - rc.top, btn.right - rc.left, btn.bottom - rc.top);
    CombineRgn(all, all, hole, RGN_DIFF);
    DeleteObject(hole);
    SetWindowRgn(c, all, TRUE);  // the window owns the region now
  }
}

static void extendFrame() {
  if (!g_wnd) return;
  // Mica: the whole window is "frame", so it shows behind every see-through part of the page.
  MARGINS m = g_mica ? MARGINS{-1, -1, -1, -1} : MARGINS{0, 0, g_customFrame ? titlebarPx() : 0, 0};
  DwmExtendFrameIntoClientArea(g_wnd, &m);
}

/** Title bar colours, Mica and the web view's background for the theme shown now. */
static void applyTheme() {
  if (!g_wnd) return;
  BOOL dark = g_day ? FALSE : TRUE;
  // 20 = DWMWA_USE_IMMERSIVE_DARK_MODE (Windows 10 20H1+ and 11); 19 was its number before that.
  if (FAILED(DwmSetWindowAttribute(g_wnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark)))) DwmSetWindowAttribute(g_wnd, 19, &dark, sizeof(dark));
  DWORD build = windowsBuild();
  // Mica only when the page asked for it (it then leaves its background see-through, so Mica shows
  // behind the whole header). Otherwise the frame and the place under the caption buttons are the
  // theme colour, the same as the page's own background, so nothing shows as a box.
  g_mica = false;
  if (build >= 22621) {
    DWM_SYSTEMBACKDROP_TYPE type = g_wantMica ? DWMSBT_MAINWINDOW : DWMSBT_NONE;
    g_mica = SUCCEEDED(DwmSetWindowAttribute(g_wnd, DWMWA_SYSTEMBACKDROP_TYPE, &type, sizeof(type))) && g_wantMica;
  }
  if (build >= 22000) {
    // Windows 11: the caption (and the frame DWM draws its buttons on) in the theme colour.
    // With Mica: the default (DWMWA_COLOR_DEFAULT), or DWM paints the caption strip over Mica.
    COLORREF caption = g_mica ? DWMWA_COLOR_DEFAULT : themeColor();
    COLORREF text = g_mica ? DWMWA_COLOR_DEFAULT : g_day ? RGB(0x24, 0x1c, 0x2b) : RGB(0xee, 0xe9, 0xf3);
    DwmSetWindowAttribute(g_wnd, DWMWA_CAPTION_COLOR, &caption, sizeof(caption));
    DwmSetWindowAttribute(g_wnd, DWMWA_TEXT_COLOR, &text, sizeof(text));
  }
  HBRUSH old = g_bgBrush;
  g_bgBrush = CreateSolidBrush(themeColor());
  SetClassLongPtrW(g_wnd, GCLP_HBRBACKGROUND, (LONG_PTR)g_bgBrush);
  if (old) DeleteObject(old);
  ComPtr<ICoreWebView2Controller2> c2;
  COLORREF c = themeColor();
  if (g_controller && SUCCEEDED(g_controller.As(&c2))) c2->put_DefaultBackgroundColor({(BYTE)(g_mica ? 0 : 255), GetRValue(c), GetGValue(c), GetBValue(c)});
  // Windows 10 repaints the caption only when the frame changes.
  extendFrame();
  SetWindowPos(g_wnd, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  InvalidateRect(g_wnd, nullptr, TRUE);
}

/** The page said which theme it shows (or the system's light/dark changed while it follows it). */
static void setTheme(std::wstring pref) {
  if (pref == L"dark") pref = L"night";  // the page's own words for them (localStorage sara.theme)
  if (pref == L"light") pref = L"day";
  if (pref != L"night" && pref != L"day" && pref != L"system") return;
  bool day = resolveDay(pref);
  bool changed = pref != g_themePref || day != g_day;
  g_themePref = pref;
  g_day = day;
  if (getPref(L"theme") != pref) setPref(L"theme", pref);
  if (changed) applyTheme();
}

/** The page draws its header in the title strip (or a new page from another place hasn't said so). */
static void setPageTitle(bool on, const std::wstring& origin) {
  g_pageTitleOrigin = on ? origin : L"";
  if (g_pageTitle == on) return;
  g_pageTitle = on;
  layoutWebView();
  if (g_wnd) InvalidateRect(g_wnd, nullptr, TRUE);
}
/** "https://host" for server pages, "local" for the app's own pages (data: / about:). */
static std::wstring pageOrigin(const std::wstring& uri) {
  if (uri.rfind(L"data:", 0) == 0 || uri.rfind(L"about:", 0) == 0) return L"local";
  return originOf(uri);
}

/** The page asks for Mica behind it ('mica') or its own solid background ('solid'). */
static void setBackdrop(const std::wstring& b) {
  if (b != L"mica" && b != L"solid") return;
  bool want = b == L"mica" && windowsBuild() >= 22621;
  if (getPref(L"backdrop") != b) setPref(L"backdrop", b);
  if (want == g_wantMica) return;
  g_wantMica = want;
  applyTheme();
}

/** Switches the page-in-the-title-area frame on or off (off: the normal title bar). */
static void setCustomFrame(bool on) {
  if (g_customFrame == on || !g_wnd) return;
  g_customFrame = on;
  extendFrame();
  SetWindowPos(g_wnd, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  layoutWebView();
}

/** The page's view of the window (window.saraShell and <html class="shell-windows">), set before
 *  any page script runs. titlebar: the height in CSS px of the strip the page draws its header in
 *  and marks app-region: drag (0 = Windows draws a normal title bar above the page). controls: the
 *  part of that strip the native caption buttons cover, so the page keeps it free. */
static std::wstring shellScript() {
  int title = g_wantCustomFrame ? kTitlebarDip : 0;
  // Windows 11's caption buttons: 3 × 46 px wide at 100%; the real width is measured once the
  // frame is on, this is the start value.
  int controls = g_wantCustomFrame ? 138 : 0;
  RECT b = captionButtons();
  if (!IsRectEmpty(&b)) controls = MulDiv(b.right - b.left, 96, (int)windowDpi()) + 8;
  // backdrops: what this Windows can show behind a see-through page; backdrop: what it shows now.
  std::wstring backdrops = windowsBuild() >= 22621 ? L"['solid', 'mica']" : L"['solid']";
  std::wstring backdrop = g_wantMica ? L"mica" : L"solid";
  return L"(() => {\n"
         L"  if (window.top !== window) return;\n"
         L"  window.saraShell = { platform: 'windows', titlebar: " + std::to_wstring(title) + L", controls: { side: 'right', width: " + std::to_wstring(controls) +
         L" }, theme: '" + g_themePref + L"', backdrop: '" + backdrop + L"', backdrops: " + backdrops + L", version: '" + kVersion + L"' };\n"
         L"  const mark = () => {\n"
         L"    const d = document.documentElement;\n"
         L"    if (!d) return false;\n"
         L"    d.classList.add('shell-windows');\n"
         L"    d.style.setProperty('--shell-titlebar', window.saraShell.titlebar + 'px');\n"
         L"    d.style.setProperty('--shell-controls-right', window.saraShell.controls.width + 'px');\n"
         L"    return true;\n"
         L"  };\n"
         L"  if (!mark()) new MutationObserver((_, o) => { if (mark()) o.disconnect(); }).observe(document, { childList: true });\n"
         L"})();\n";
}

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
  if (!g_tray.szTip[0]) wcscpy_s(g_tray.szTip, L"Sara");
  if (!Shell_NotifyIconW(NIM_ADD, &g_tray)) logLine(L"tray icon failed (" + std::to_wstring(GetLastError()) + L")");
}

/** A saved server as the tray menu and pages show it: "🌸 Sara (host)", or just the host. */
static std::wstring serverLabel(const Profile& p) {
  std::wstring host = hostOfUrl(p.url);
  std::wstring label = (p.emoji.empty() ? L"" : p.emoji + L" ") + p.name;
  return lower(p.name) == lower(host) ? label : label + L"  (" + host + L")";
}

/** The tray menu, the same order as the Mac's menu bar menu:
 *    Open Sara · Settings… | Your Saras ▸ | Start with Windows · Help | Quit Sara */
static void trayMenu() {
  HMENU m = CreatePopupMenu();
  UINT needsServer = g_server.empty() ? MF_GRAYED : 0;
  AppendMenuW(m, MF_STRING, ID_OPEN, L"Open Sara");
  AppendMenuW(m, MF_STRING | needsServer, ID_SETTINGS, L"Settings…");
  AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  // Phase 68: the saved servers (✓ the one in use); switching keeps every sign-in.
  HMENU saras = CreatePopupMenu();
  auto list = profiles();
  for (size_t i = 0; i < list.size() && i < 50; i++)
    AppendMenuW(saras, MF_STRING | (list[i].id == g_profile ? MF_CHECKED : 0), ID_SERVER0 + i, serverLabel(list[i]).c_str());
  if (!list.empty()) AppendMenuW(saras, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(saras, MF_STRING, ID_CHANGE, L"Add a Sara…");
  AppendMenuW(m, MF_POPUP, (UINT_PTR)saras, L"Your Saras");
  AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(m, MF_STRING | (startAtLogin() ? MF_CHECKED : 0), ID_LOGIN, L"Start with Windows");
  AppendMenuW(m, MF_STRING | needsServer, ID_HELP, L"Help");
  AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(m, MF_STRING, ID_QUIT, L"Quit Sara");
  SetMenuDefaultItem(m, ID_OPEN, FALSE);  // bold: what a click on the icon does
  POINT pt;
  GetCursorPos(&pt);
  SetForegroundWindow(g_wnd);
  TrackPopupMenu(m, TPM_RIGHTBUTTON, pt.x, pt.y, 0, g_wnd, nullptr);
  PostMessageW(g_wnd, WM_NULL, 0, 0);  // so the menu closes when you click elsewhere
  DestroyMenu(m);  // also destroys the "Your Saras" submenu
}

// ---------- pages shown before the server is known or when it can't be reached ----------
// The app's own pages (welcome, add a Sara, can't reach): the new look's tokens (docs/design/
// NEW_LOOK.md, web/theme.css), Night or Day as the page last said, with a drag strip where the
// title bar would be. The same look as the Mac app's pages (desktop/mac/Sources/main.swift).
static const wchar_t* kPageStyle = LR"CSS(<meta name=viewport content='width=device-width'><style>
:root{--bg:#0f0d17;--panel:#17141f;--panel-2:#1e1a29;--text:#eee9f3;--muted:#a9a0b8;--accent:#f08aa5;--grad:linear-gradient(135deg,#e0607e,#9b6bff);--border:rgba(255,255,255,.08);--border-2:rgba(255,255,255,.16);--error:#ff6b7d;--on-accent:#160c14;--glow:0 0 0 1px rgba(224,96,126,.18),0 18px 50px rgba(155,107,255,.14);color-scheme:dark}
html.day{--bg:#faf7f5;--panel:#ffffff;--panel-2:#f6eff2;--text:#241c2b;--muted:#665d70;--accent:#b8436a;--border:rgba(36,28,43,.10);--border-2:rgba(36,28,43,.22);--error:#c0303a;--glow:0 12px 40px rgba(60,30,60,.10);color-scheme:light}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:15px/1.5 Inter,'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;display:grid;place-items:center;padding:24px;-webkit-user-select:none;user-select:none}
body::before{content:'';position:fixed;left:0;right:0;top:0;height:var(--tb,0px);app-region:drag;-webkit-app-region:drag}
.c{width:100%;max-width:440px;background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:30px 30px 26px;box-shadow:var(--glow)}
.logo{display:block;width:64px;height:64px;border-radius:50%;margin:0 0 18px;background:var(--panel-2);box-shadow:0 0 0 2px rgba(240,138,165,.35),0 0 24px rgba(155,107,255,.35)}
h1{font-size:22px;line-height:1.25;margin:0 0 8px;font-weight:600;letter-spacing:-.01em}
p{color:var(--muted);margin:0 0 12px}b{color:var(--text);font-weight:600}
label{display:block;font-weight:600;font-size:14px;margin:18px 0 6px}
input{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--border-2);background:var(--panel-2);color:var(--text);-webkit-user-select:text;user-select:text}
input:focus{outline:2px solid var(--accent);outline-offset:-1px}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
button{font:inherit;font-weight:600;padding:9px 18px;min-height:40px;border:0;border-radius:10px;background:var(--grad);color:var(--on-accent);cursor:pointer;transition:filter .15s ease-out}
button:hover{filter:brightness(1.08)}button:focus-visible{outline:2px solid var(--text);outline-offset:2px}
button.g{background:transparent;color:var(--text);border:1px solid var(--border-2);font-weight:500}button.g:hover{border-color:var(--accent);filter:none}
.e{color:var(--error);font-size:14px;margin:8px 0 0}.e:empty{display:none}
.small{font-size:13px}.sep{border-top:1px solid var(--border);margin:22px 0 0;padding-top:14px}.sep p{margin:0 0 8px}
@media (prefers-reduced-motion:reduce){button{transition:none}}
</style>)CSS";
/** <!doctype html><html …><head> with the style: Day or Night, and the drag strip's height. */
static std::wstring pageHead() {
  return std::wstring(L"<!doctype html><html class='") + (g_day ? L"day" : L"night") + L"' style='--tb:" + std::to_wstring(g_customFrame ? kTitlebarDip : 0) + L"px'><head>" + kPageStyle +
         L"<script>chrome.webview.postMessage({type:'shell',titlebar:true})</script></head>";
}
/** Her picture at the top of these pages (page-logo.h is made by scripts/make-app-icons.py). */
static std::wstring logoHtml() { return std::wstring(L"<img class=logo alt='' src='") + kLogoDataUrl + L"'>"; }

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

static void showSetup(const std::wstring& error = L"", const std::wstring& typed = L"") {
  std::wstring port = localPort();
  // Phase 68: with a Sara already here, this page adds another one; Back returns to her.
  Profile here = g_profile.empty() ? Profile{} : loadProfile(g_profile);
  bool adding = !here.url.empty();
  std::wstring html = pageHead() + L"<body><div class=c>" + logoHtml() + L"<h1>" +
                      (adding ? L"Add a Sara" : L"Connect to your Sara") + L"</h1><p>" +
                      (adding ? L"Type the address of another Sara. Your other Saras stay signed in."
                              : L"Type the address you open Sara at in a web browser.") +
                      L"</p><label for=u>Address</label><input id=u autofocus spellcheck=false placeholder='sara.example.com' value='" +
                      htmlEscape(!typed.empty() ? typed : adding ? L"" : getPref(L"lastServer")) + L"'><p class=e id=e role=alert>" + htmlEscape(error) +
                      L"</p><div class=row><button id=b>Continue</button>" +
                      (adding ? L"<button class=g id=k>Back to " + htmlEscape(here.name) + L"</button>" : L"") +
                      L"</div><div class=sep><p class=small>Next you sign in with a code: on a device where you're signed in, open "
                      L"Settings → Data &amp; health → Devices and sign-in → <b>Add a phone or computer</b>.</p>" +
                      (port.empty() ? L"" : L"<button class=g id=l>Use the Sara on this computer</button>") +
                      L"</div></div><script>const $=(i)=>document.getElementById(i);const k=$('k');if(k)k.onclick=()=>chrome.webview.postMessage({m:'retry'});"
                      L"const go=()=>chrome.webview.postMessage({m:'setServer',url:$('u').value});"
                      L"const l=$('l');if(l)l.onclick=()=>chrome.webview.postMessage({m:'useLocal'});"
                      L"$('b').onclick=go;$('u').onkeydown=e=>e.key==='Enter'&&go();</script></body></html>";
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
      : L"Check your internet connection, that the address is right, and that Sara is running there. This page tries again by itself.";
  // Phase 68: the other saved Saras are one click away.
  std::wstring others;
  for (auto& p : profiles())
    if (p.id != g_profile) others += L"<button class=g data-id='" + htmlEscape(p.id) + L"'>" + htmlEscape(p.name) + L"</button>";
  std::wstring html = pageHead() + L"<body><div class=c>" + logoHtml() +
                      L"<h1>Can't reach your Sara</h1><p><b>" + htmlEscape(g_server) + L"</b> isn't answering.</p><p>" + why +
                      L"</p><div class=row><button id=r>Try again</button><button class=g id=s>Add a Sara</button></div>" +
                      (others.empty() ? L"" : L"<div class=sep><p class=small>Your other Saras</p><div class=row style='margin-top:0'>" + others + L"</div></div>") +
                      L"</div><script>document.getElementById('r').onclick=()=>chrome.webview.postMessage({m:'retry'});"
                      L"for(const b of document.querySelectorAll('[data-id]'))b.onclick=()=>chrome.webview.postMessage({m:'useServer',id:b.dataset.id});"
                      L"document.getElementById('s').onclick=()=>chrome.webview.postMessage({m:'changeServer'});setTimeout(()=>chrome.webview.postMessage({m:'retry'}),30000);</script></body></html>";
  if (g_web) g_web->NavigateToString(html.c_str());
}

/** Phase 68: "Add a Sara…" (tray menu, the page's ⇄ menu, the offline page): the address page.
 *  Nothing is signed out; the new server gets a WebView2 profile of its own. */
static void changeServerFromMenu() {
  showWindow();
  showSetup();
}

static void openServer(const std::wstring& path = L"/") {
  if (g_server.empty()) return showSetup();
  if (g_web) g_web->Navigate((g_server + path).c_str());
}

/** Tray menu → Settings… / Help: opens that view of the web app (its #view= links). */
static void openView(const wchar_t* view) {
  showWindow();
  if (g_server.empty() || !g_web) return;
  LPWSTR src = nullptr;
  g_web->get_Source(&src);
  bool onServer = src && sameOrigin(src);
  CoTaskMemFree(src);
  // replaceState first: setting the hash it already has wouldn't open the view again.
  if (onServer) g_web->ExecuteScript((std::wstring(L"history.replaceState(null,'',location.pathname);location.hash='view=") + view + L"'").c_str(), nullptr);
  else openServer(std::wstring(L"/#view=") + view);
}

static void createController();
/** Phase 68: shows another saved server in its own WebView2 profile; every sign-in is kept. */
static void switchTo(const std::wstring& id, const std::wstring& path = L"/") {
  if (loadProfile(id).url.empty()) return;
  if (id == g_profile && g_web) {
    activate(id);
    return openServer(path);
  }
  activate(id);
  g_nextPath = path;
  if (g_controller) g_controller->Close();
  g_controller.Reset();
  g_web.Reset();
  createController();
}
/** Asks for a switch from the message loop (not from inside a WebView2 callback). */
static void postSwitch(const std::wstring& id, const std::wstring& path = L"/") {
  g_switchTo = id;
  g_switchPath = path;
  PostMessageW(g_wnd, WM_APP_SWITCH, 0, 0);
}

/** Removing the server in use: sign out on the server (from its own page), then clear its
 *  WebView2 profile, forget it and show the most recently used other one. */
static void removeActive() {
  g_removing = g_profile;
  SetTimer(g_wnd, kRemoveTimer, 5000, nullptr);  // offline: forget it here anyway
  if (g_web) g_web->ExecuteScript(L"fetch('/api/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).catch(()=>{}).finally(()=>chrome.webview.postMessage({m:'loggedOut'}))", nullptr);
}
static void finishRemove() {
  KillTimer(g_wnd, kRemoveTimer);
  if (g_removing.empty()) return;
  std::wstring id = g_removing;
  auto done = [id]() {
    forgetProfile(id);
    logLine(L"forgot server " + id + L" (its sign-in was cleared)");
    g_removing.clear();
    PostMessageW(g_wnd, WM_APP_REMOVED, 0, 0);
  };
  ComPtr<ICoreWebView2_13> w13;
  ComPtr<ICoreWebView2Profile> profile;
  ComPtr<ICoreWebView2Profile2> p2;
  if (g_web && SUCCEEDED(g_web.As(&w13)) && SUCCEEDED(w13->get_Profile(&profile)) && SUCCEEDED(profile.As(&p2))) {
    g_web->NavigateToString((pageHead() + L"<body></body></html>").c_str());
    HRESULT hr = p2->ClearBrowsingDataAll(Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>([done](HRESULT) -> HRESULT {
                    done();
                    return S_OK;
                  }).Get());
    if (SUCCEEDED(hr)) return;
  }
  done();
}
static void removeServer(const std::wstring& id) {
  if (loadProfile(id).url.empty() || !g_removing.empty()) return;
  if (id == g_profile) return removeActive();
  // Its sign-in is in its own profile: open it, then sign out there (see NavigationCompleted).
  g_removeAfterLoad = id;
  postSwitch(id);
}
/** After a removal: the most recently used other server, or the address page. */
static void afterRemove() {
  Profile best;
  for (auto& p : profiles())
    if (best.id.empty() || p.lastUsed > best.lastUsed) best = p;
  if (best.id.empty()) {
    g_profile.clear();
    g_server.clear();
    setPref(L"server", L"");
    setIni(L"servers", L"active", L"");
    return showSetup();
  }
  switchTo(best.id);
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
         L",\"server\":\"" + jsonEscape(g_server) + L"\",\"theme\":\"" + g_themePref + L"\",\"titlebar\":" + std::to_wstring(g_customFrame ? kTitlebarDip : 0) + L"}";
}

static void onMessage(const std::wstring& json, const std::wstring& source) {
  auto m = parseFlatJson(json);
  const std::wstring& kind = m[L"m"];
  const std::wstring id = m[L"id"];
  bool fromServer = sameOrigin(source);
  // The local setup/offline pages may only set the server, retry or change server.
  if (kind == L"setServer") {
    std::wstring o = originOf(m[L"url"]);
    if (o.empty()) return showSetup(L"That doesn't look like a web address. Try something like sara.example.com.", m[L"url"]);
    setPref(L"lastServer", o);
    // Phase 68: a saved server again, or a new one next to the others (nobody is signed out).
    return postSwitch(profileFor(o), L"/pair");
  }
  // Phase 75: the page draws its header in the title strip (any page: it only moves the web view up).
  if (m[L"type"] == L"shell" || kind == L"shell") {
    setPageTitle(m[L"titlebar"] == L"true", pageOrigin(source));
    return reply(id, L"true");
  }
  if (kind == L"retry") return openServer();
  if (kind == L"changeServer") return changeServerFromMenu();
  if (kind == L"useServer" && !fromServer) return postSwitch(m[L"id"]);
  if (kind == L"useLocal") {
    std::wstring port = localPort();
    if (port.empty()) return showSetup();
    std::wstring o = L"http://127.0.0.1:" + port;
    setPref(L"lastServer", o);
    return postSwitch(profileFor(o));
  }
  if (!fromServer) return;  // everything else only from the owner's own server
  // Phase 75: the page's theme (Night / Day / follow the system): the title bar, Mica and the
  // background before the next page paints follow it. {type:'theme', theme} or SaraDesktop.call('theme', {theme}).
  if (m[L"type"] == L"theme" || kind == L"theme") {
    setTheme(m[L"theme"]);
    if (!m[L"backdrop"].empty()) setBackdrop(m[L"backdrop"]);
    return reply(id, L"true");
  }
  // {type:'backdrop', backdrop:'mica'|'solid'}: 'mica' once the page's background is see-through.
  if (m[L"type"] == L"backdrop" || kind == L"backdrop") {
    setBackdrop(m[L"backdrop"]);
    return reply(id, g_mica ? L"\"mica\"" : L"\"solid\"");
  }
  if (kind == L"getPrefs") return reply(id, prefsJson());
  // Phase 68: the page's ⇄ menu. Names and hosts only: no sign-in ever goes to a page.
  if (kind == L"servers") return reply(id, serversJson());
  if (kind == L"useServer") {
    reply(id, L"true");
    return postSwitch(m[L"id"]);
  }
  if (kind == L"addServer") {
    reply(id, L"true");
    return showSetup();
  }
  if (kind == L"removeServer") {
    reply(id, L"true");
    return removeServer(m[L"id"]);
  }
  if (kind == L"renameServer" || kind == L"serverName") {
    bool byUser = kind == L"renameServer";
    Profile p = loadProfile(byUser ? m[L"id"] : g_profile);
    std::wstring name = m[L"name"];
    if (!p.url.empty() && !name.empty() && (byUser || !p.named)) {
      p.name = uniqueName(name, p.url, p.id);
      if (byUser) p.named = true;
      saveProfile(p);
      if (p.id == g_profile) activate(p.id);
    }
    return reply(id, serversJson());
  }
  if (kind == L"loggedOut") return finishRemove();
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

/** Phase 68: the web view for the server in use, in that server's own WebView2 profile (s1: the
 *  default profile, the one used before 1.8; others: "sara-<id>"), so sign-ins stay apart. */
static void createController() {
  if (!g_env) return;
  auto done = Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([](HRESULT r2, ICoreWebView2Controller* ctl) -> HRESULT {
          if (FAILED(r2) || !ctl) return S_OK;
          g_controller = ctl;
          g_controller->get_CoreWebView2(&g_web);
          // Phase 75: the theme colour behind every page (no white flash on start, navigation or resize).
          ComPtr<ICoreWebView2Controller2> c2;
          COLORREF bg = themeColor();
          if (SUCCEEDED(g_controller.As(&c2))) c2->put_DefaultBackgroundColor({(BYTE)(g_mica ? 0 : 255), GetRValue(bg), GetGValue(bg), GetBValue(bg)});

          ComPtr<ICoreWebView2Settings> settings;
          g_web->get_Settings(&settings);
          settings->put_AreDevToolsEnabled(FALSE);
          settings->put_IsStatusBarEnabled(FALSE);
          // Phase 75: CSS app-region: drag in the page's header moves the window (double-click
          // maximizes). A WebView2 without it keeps the normal title bar.
          ComPtr<ICoreWebView2Settings9> s9;
          bool regions = SUCCEEDED(settings.As(&s9)) && SUCCEEDED(s9->put_IsNonClientRegionSupportEnabled(TRUE));
          if (!regions && g_wantCustomFrame) {
            logLine(L"this WebView2 has no app-region support: the normal title bar is used");
            g_wantCustomFrame = false;
            setCustomFrame(false);
          }
          layoutWebView();
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
            if (u.rfind(L"data:", 0) == 0 || u.rfind(L"about:", 0) == 0 || sameOrigin(u)) {
              // Another place (a server, the app's own page): its page says again whether it draws the strip.
              if (g_pageTitle && pageOrigin(u) != g_pageTitleOrigin) setPageTitle(false, L"");
              return S_OK;
            }
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
            // Phase 68: removing a server that wasn't in use: now it's open, sign out there.
            if (!g_removeAfterLoad.empty() && g_removeAfterLoad == g_profile && sameOrigin(u)) {
              g_removeAfterLoad.clear();
              removeActive();
            }
            return S_OK;
          }).Get(), nullptr);
          // Microphone (calls, voice messages), the camera (video calls, Phase 69: only after the owner
          // turns it on in the call) and notifications: allowed for the owner's server only.
          g_web->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* a) -> HRESULT {
            LPWSTR uri = nullptr;
            a->get_Uri(&uri);
            std::wstring u = uri ? uri : L"";
            CoTaskMemFree(uri);
            COREWEBVIEW2_PERMISSION_KIND k;
            a->get_PermissionKind(&k);
            bool wanted = k == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || k == COREWEBVIEW2_PERMISSION_KIND_CAMERA || k == COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS || k == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ;
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
          // Phase 75: window.saraShell and <html class="shell-windows"> before any page script.
          g_web->AddScriptToExecuteOnDocumentCreated(shellScript().c_str(), nullptr);
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
            std::wstring path = g_nextPath;
            g_nextPath = L"/";
            openServer(path);
            return S_OK;
          }).Get());
          return S_OK;
  });
  ComPtr<ICoreWebView2Environment10> env10;
  if (!g_profile.empty() && g_profile != L"s1" && SUCCEEDED(g_env.As(&env10))) {
    ComPtr<ICoreWebView2ControllerOptions> opts;
    if (SUCCEEDED(env10->CreateCoreWebView2ControllerOptions(&opts))) {
      opts->put_ProfileName((L"sara-" + g_profile).c_str());
      env10->CreateCoreWebView2ControllerWithOptions(g_wnd, opts.Get(), done.Get());
      return;
    }
  }
  g_env->CreateCoreWebView2Controller(g_wnd, done.Get());
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
        g_env = env;
        createController();
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

/** Phase 75: the window's own hit test while the page draws into the title area. DWM answers for
 *  its caption buttons first (hover, clicks and the snap layouts flyout on maximize). */
static LRESULT customFrameHitTest(HWND h, WPARAM wp, LPARAM lp) {
  LRESULT hit = DefWindowProcW(h, WM_NCHITTEST, wp, lp);
  if (hit != HTCLIENT) return hit;  // the side and bottom borders stay Windows' own
  POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
  ScreenToClient(h, &pt);
  RECT rc;
  GetClientRect(h, &rc);
  // DWM doesn't always answer for its buttons (maximized, the window hangs over the screen edge):
  // the same three buttons by position, so clicks, the restore button and snap layouts still work.
  RECT btn = captionButtons();
  if (!IsRectEmpty(&btn) && PtInRect(&btn, pt)) {
    int third = (btn.right - btn.left) / 3;
    if (pt.x < btn.left + third) return HTMINBUTTON;
    if (pt.x < btn.left + 2 * third) return HTMAXBUTTON;
    return HTCLOSE;
  }
  int band = topResizeBand();
  if (band > 0 && pt.y < band) {
    UINT dpi = windowDpi();
    int corner = GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi) + GetSystemMetricsForDpi(SM_CXSIZE, dpi) / 2;
    if (pt.x < corner) return HTTOPLEFT;
    if (pt.x >= rc.right - corner) return HTTOPRIGHT;
    return HTTOP;
  }
  // The strip beside the caption buttons (the page covers the rest and answers with app-region).
  if (pt.y < titlebarPx()) return HTCAPTION;
  return HTCLIENT;
}

static LRESULT CALLBACK WndProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  if (g_customFrame) {
    LRESULT r = 0;
    if (DwmDefWindowProc(h, msg, wp, lp, &r)) return r;  // the caption buttons
  }
  switch (msg) {
    case WM_NCCALCSIZE:
      if (g_customFrame && wp) {
        // Keep Windows' left, right and bottom borders; take the title bar away (the page draws
        // there). Maximized, the window hangs over the screen edge by the border: keep it visible.
        auto* p = reinterpret_cast<NCCALCSIZE_PARAMS*>(lp);
        LONG top = p->rgrc[0].top;
        DefWindowProcW(h, msg, wp, lp);
        p->rgrc[0].top = top;
        if (IsZoomed(h)) {
          UINT dpi = GetDpiForWindow(h);
          p->rgrc[0].top += GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
        }
        return 0;
      }
      break;
    case WM_NCHITTEST:
      if (g_customFrame) return customFrameHitTest(h, wp, lp);
      break;
    case WM_ACTIVATE:
      extendFrame();
      break;
    case WM_ERASEBKGND:
      return 1;  // WM_PAINT fills it (no flash of the old colour)
    case WM_PAINT: {
      // The top resize band and the place under the caption buttons: the theme colour, fully
      // opaque (plain GDI leaves alpha 0, which DWM shows see-through in the extended frame).
      PAINTSTRUCT ps;
      HDC dc = BeginPaint(h, &ps);
      HDC buf = nullptr;
      HPAINTBUFFER pb = BeginBufferedPaint(dc, &ps.rcPaint, BPBF_TOPDOWNDIB, nullptr, &buf);
      // With Mica all of it is see-through (black, alpha 0) and Mica shows.
      HBRUSH b = g_mica ? (HBRUSH)GetStockObject(BLACK_BRUSH) : CreateSolidBrush(themeColor());
      FillRect(pb ? buf : dc, &ps.rcPaint, b);
      if (!g_mica) DeleteObject(b);
      if (pb && g_customFrame && !g_pageTitle && !g_mica) {
        // The app's own title strip (the page doesn't draw one): her icon and "Sara".
        HDC t = buf;
        UINT dpi = windowDpi();
        int strip = titlebarPx(), icon = GetSystemMetricsForDpi(SM_CXSMICON, dpi), pad = MulDiv(14, (int)dpi, 96);
        int top = topResizeBand();
        int mid = top + (strip - top) / 2;
        if (HICON ic = (HICON)LoadImageW(g_inst, MAKEINTRESOURCEW(IDI_SARA), IMAGE_ICON, icon, icon, 0)) {
          DrawIconEx(t, pad, mid - icon / 2, ic, icon, icon, 0, nullptr, DI_NORMAL);
          DestroyIcon(ic);
        }
        NONCLIENTMETRICSW ncm{sizeof(ncm)};
        SystemParametersInfoForDpi(SPI_GETNONCLIENTMETRICS, sizeof(ncm), &ncm, 0, dpi);
        HFONT f = CreateFontIndirectW(&ncm.lfCaptionFont);
        HGDIOBJ oldFont = SelectObject(t, f);
        SetBkMode(t, TRANSPARENT);
        SetTextColor(t, g_day ? RGB(0x24, 0x1c, 0x2b) : RGB(0xee, 0xe9, 0xf3));
        RECT tr{pad + icon + MulDiv(10, (int)dpi, 96), top, MulDiv(400, (int)dpi, 96), strip};
        DrawTextW(t, L"Sara", -1, &tr, DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
        SelectObject(t, oldFont);
        DeleteObject(f);
      }
      if (pb) {
        BufferedPaintSetAlpha(pb, &ps.rcPaint, g_mica ? 0 : 255);
        // Under DWM's caption buttons: see-through (the frame there is the theme colour), or the
        // paint hides them.
        RECT btn = captionButtons();
        if (!IsRectEmpty(&btn)) {
          FillRect(buf, &btn, (HBRUSH)GetStockObject(BLACK_BRUSH));
          BufferedPaintSetAlpha(pb, &btn, 0);
        }
        EndBufferedPaint(pb, TRUE);
      }
      EndPaint(h, &ps);
      return 0;
    }
    case WM_DPICHANGED: {
      const RECT* r = reinterpret_cast<const RECT*>(lp);
      SetWindowPos(h, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
      extendFrame();
      layoutWebView();
      return 0;
    }
    case WM_SETTINGCHANGE:
      // Windows switched light/dark while the page follows the system.
      if (g_themePref == L"system" && lp && wcscmp(reinterpret_cast<const wchar_t*>(lp), L"ImmersiveColorSet") == 0 && resolveDay(L"system") != g_day) {
        g_day = !g_day;
        applyTheme();
      }
      break;
    case WM_SIZE:
      extendFrame();
      layoutWebView();
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
    case WM_APP_SWITCH:
      if (!g_switchTo.empty()) {
        std::wstring id = g_switchTo, path = g_switchPath;
        g_switchTo.clear();
        showWindow();
        switchTo(id, path.empty() ? L"/" : path);
      }
      return 0;
    case WM_APP_REMOVED:
      afterRemove();
      return 0;
    case WM_TIMER:
      if (wp == kRemoveTimer) finishRemove();
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
        case ID_SETTINGS: openView(L"settings"); break;
        case ID_HELP: openView(L"help"); break;
        case ID_CHANGE: changeServerFromMenu(); break;
        default:
          if (LOWORD(wp) >= ID_SERVER0 && LOWORD(wp) < ID_SERVER0 + 50) {
            auto list = profiles();
            size_t i = LOWORD(wp) - ID_SERVER0;
            if (i < list.size()) {
              showWindow();
              switchTo(list[i].id);
            }
          }
          break;
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
#ifdef SARA_TEST_HOOKS
  HANDLE single = CreateMutexW(nullptr, TRUE, GetEnvironmentVariableW(L"SARA_DESKTOP_TEST_DIR", nullptr, 0) > 0 ? L"Local\\SaraDesktopAppTest" : L"Local\\SaraDesktopApp");
#else
  HANDLE single = CreateMutexW(nullptr, TRUE, L"Local\\SaraDesktopApp");
#endif
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
  // Phase 68: the saved servers. Before 1.8 there was one: it becomes s1 with its sign-in. An
  // address set by the installer or --server is a saved one again, or added next to the others.
  migrateProfiles();
  if (!g_server.empty()) activate(profileFor(g_server));
  else {
    std::wstring act = getIni(L"servers", L"active");
    if (!act.empty() && !loadProfile(act).url.empty()) activate(act);
  }

  // Phase 75: the last theme the page showed, and whether the page can draw into the title area:
  // Windows 11 (DWM draws the caption buttons over the page) and a WebView2 runtime with CSS
  // app-region support (ICoreWebView2Settings9, runtime 123+); otherwise the normal title bar.
  g_themePref = getPref(L"theme", L"night");
  if (g_themePref != L"day" && g_themePref != L"system") g_themePref = L"night";
  g_day = resolveDay(g_themePref);
  g_wantMica = getPref(L"backdrop") == L"mica" && windowsBuild() >= 22621;
  {
    LPWSTR rt = nullptr;
    int cmp = -1;
    if (SUCCEEDED(GetAvailableCoreWebView2BrowserVersionString(nullptr, &rt)) && rt) CompareBrowserVersions(rt, L"123.0.2420.47", &cmp);
    logLine(std::wstring(L"WebView2 runtime ") + (rt ? rt : L"(none)") + L", Windows build " + std::to_wstring(windowsBuild()));
    CoTaskMemFree(rt);
    g_wantCustomFrame = windowsBuild() >= 22000 && cmp >= 0;
#ifdef SARA_TEST_HOOKS
    wchar_t f[32];
    if (GetEnvironmentVariableW(L"SARA_DESKTOP_FRAME", f, 32) > 0 && wcscmp(f, L"classic") == 0) g_wantCustomFrame = false;
#endif
    g_customFrame = g_wantCustomFrame;
  }
  BufferedPaintInit();

  WNDCLASSEXW wc{sizeof(wc)};
  wc.lpfnWndProc = WndProc;
  wc.hInstance = inst;
  wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(IDI_SARA));
  wc.hIconSm = (HICON)LoadImageW(inst, MAKEINTRESOURCEW(IDI_SARA), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  g_bgBrush = CreateSolidBrush(themeColor());
  wc.hbrBackground = g_bgBrush;
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
  applyTheme();
  if (g_customFrame) {
    extendFrame();
    SetWindowPos(g_wnd, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  }
  addTray();
  if (!background) ShowWindow(g_wnd, maximized ? SW_SHOWMAXIMIZED : show);
  createWebView();

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0)) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  BufferedPaintUnInit();
  CoUninitialize();
  CloseHandle(single);
  return (int)msg.wParam;
}

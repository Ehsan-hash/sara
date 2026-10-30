// Phase 87 (computer use CU1): Sara's hands on Windows. See hands.h and docs/design/COMPUTER_USE.md.
//
// Threads: one connection thread (connect, hello, receive; reconnects 1, 2, 5, 10, 30 s), one worker
// thread (runs ops one at a time, as the server sends them), and the Sara browser's pipe reader
// (DevTools answers and events: console, network, page loads). Pictures go back as binary frames:
// a 4-byte big-endian header length, a JSON header, then the JPEG bytes.
#include "hands.h"

#define NOMINMAX
#include <windows.h>
#include <winhttp.h>
#include <wincrypt.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <map>
#include <mutex>
#include <regex>
#include <set>
#include <thread>
#include <vector>
#include <algorithm>
#include <memory>

namespace sarahands {
namespace {

// ---------------- a small JSON reader/writer (enough for the protocol and DevTools) ----------------
struct J {
  enum T { Null, Bool, Num, Str, Arr, Obj } t = Null;
  bool b = false;
  double n = 0;
  std::string s;
  std::vector<J> a;
  std::vector<std::pair<std::string, J>> o;
  const J& operator[](const char* k) const {
    static const J none;
    if (t != Obj) return none;
    for (auto& kv : o)
      if (kv.first == k) return kv.second;
    return none;
  }
  bool has(const char* k) const {
    if (t != Obj) return false;
    for (auto& kv : o)
      if (kv.first == k) return true;
    return false;
  }
  std::string str(const std::string& def = "") const {
    if (t == Str) return s;
    if (t == Num) {
      char buf[40];
      if (n == (double)(long long)n) snprintf(buf, sizeof buf, "%lld", (long long)n);
      else snprintf(buf, sizeof buf, "%g", n);
      return buf;
    }
    return def;
  }
  double num(double def = 0) const { return t == Num ? n : t == Str ? atof(s.c_str()) : def; }
  bool truthy() const { return t == Bool ? b : t == Num ? n != 0 : t == Str ? !s.empty() : t != Null; }
};

struct Parser {
  const std::string& x;
  size_t i = 0;
  bool bad = false;
  explicit Parser(const std::string& s) : x(s) {}
  void ws() {
    while (i < x.size() && (x[i] == ' ' || x[i] == '\n' || x[i] == '\r' || x[i] == '\t')) i++;
  }
  static void utf8(std::string& out, unsigned cp) {
    if (cp < 0x80) out += (char)cp;
    else if (cp < 0x800) {
      out += (char)(0xC0 | (cp >> 6));
      out += (char)(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      out += (char)(0xE0 | (cp >> 12));
      out += (char)(0x80 | ((cp >> 6) & 0x3F));
      out += (char)(0x80 | (cp & 0x3F));
    } else {
      out += (char)(0xF0 | (cp >> 18));
      out += (char)(0x80 | ((cp >> 12) & 0x3F));
      out += (char)(0x80 | ((cp >> 6) & 0x3F));
      out += (char)(0x80 | (cp & 0x3F));
    }
  }
  unsigned hex4() {
    if (i + 4 > x.size()) {
      bad = true;
      return 0;
    }
    unsigned v = 0;
    for (int k = 0; k < 4; k++) {
      char c = x[i++];
      v <<= 4;
      if (c >= '0' && c <= '9') v |= c - '0';
      else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
      else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
      else bad = true;
    }
    return v;
  }
  std::string string() {
    std::string out;
    i++;  // "
    while (i < x.size() && x[i] != '"') {
      char c = x[i++];
      if (c != '\\') {
        out += c;
        continue;
      }
      if (i >= x.size()) break;
      char e = x[i++];
      switch (e) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'u': {
          unsigned cp = hex4();
          if (cp >= 0xD800 && cp <= 0xDBFF && i + 6 <= x.size() && x[i] == '\\' && x[i + 1] == 'u') {
            i += 2;
            unsigned lo = hex4();
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          }
          utf8(out, cp);
          break;
        }
        default: out += e;
      }
    }
    if (i >= x.size()) bad = true;
    i++;
    return out;
  }
  J value(int depth = 0) {
    J v;
    ws();
    if (i >= x.size() || depth > 200) {
      bad = true;
      return v;
    }
    char c = x[i];
    if (c == '{') {
      v.t = J::Obj;
      i++;
      ws();
      if (i < x.size() && x[i] == '}') {
        i++;
        return v;
      }
      while (!bad) {
        ws();
        if (i >= x.size() || x[i] != '"') {
          bad = true;
          break;
        }
        std::string k = string();
        ws();
        if (i >= x.size() || x[i] != ':') {
          bad = true;
          break;
        }
        i++;
        v.o.emplace_back(k, value(depth + 1));
        ws();
        if (i < x.size() && x[i] == ',') {
          i++;
          continue;
        }
        if (i < x.size() && x[i] == '}') {
          i++;
          break;
        }
        bad = true;
      }
    } else if (c == '[') {
      v.t = J::Arr;
      i++;
      ws();
      if (i < x.size() && x[i] == ']') {
        i++;
        return v;
      }
      while (!bad) {
        v.a.push_back(value(depth + 1));
        ws();
        if (i < x.size() && x[i] == ',') {
          i++;
          continue;
        }
        if (i < x.size() && x[i] == ']') {
          i++;
          break;
        }
        bad = true;
      }
    } else if (c == '"') {
      v.t = J::Str;
      v.s = string();
    } else if (x.compare(i, 4, "true") == 0) {
      v.t = J::Bool;
      v.b = true;
      i += 4;
    } else if (x.compare(i, 5, "false") == 0) {
      v.t = J::Bool;
      i += 5;
    } else if (x.compare(i, 4, "null") == 0) {
      i += 4;
    } else {
      size_t st = i;
      while (i < x.size() && (isdigit((unsigned char)x[i]) || x[i] == '-' || x[i] == '+' || x[i] == '.' || x[i] == 'e' || x[i] == 'E')) i++;
      if (st == i) bad = true;
      v.t = J::Num;
      v.n = atof(x.substr(st, i - st).c_str());
    }
    return v;
  }
};
J parse(const std::string& s, bool* ok = nullptr) {
  Parser p(s);
  J v = p.value();
  if (ok) *ok = !p.bad;
  return v;
}
/** A JSON string literal. */
std::string q(const std::string& s) {
  std::string o = "\"";
  for (unsigned char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) {
          char b[8];
          snprintf(b, sizeof b, "\\u%04x", c);
          o += b;
        } else o += (char)c;
    }
  }
  return o + "\"";
}
std::string dump(const J& v) {
  switch (v.t) {
    case J::Null: return "null";
    case J::Bool: return v.b ? "true" : "false";
    case J::Num: return v.str();
    case J::Str: return q(v.s);
    case J::Arr: {
      std::string o = "[";
      for (size_t k = 0; k < v.a.size(); k++) o += (k ? "," : "") + dump(v.a[k]);
      return o + "]";
    }
    case J::Obj: {
      std::string o = "{";
      for (size_t k = 0; k < v.o.size(); k++) o += (k ? "," : "") + q(v.o[k].first) + ":" + dump(v.o[k].second);
      return o + "}";
    }
  }
  return "null";
}
std::string num(double d) {
  J v;
  v.t = J::Num;
  v.n = d;
  return v.str();
}

std::string u8(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
  return s;
}
std::wstring wide(const std::string& s) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring w(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
  return w;
}

/** Text that looks like a key or token is masked before it leaves this computer. */
std::string mask(std::string t) {
  static const std::vector<std::regex> shapes = {
      std::regex("sk-[A-Za-z0-9_-]{16,}"),
      std::regex("[sr]k_(live|test)_[A-Za-z0-9]{10,}"),
      std::regex("gh[pousr]_[A-Za-z0-9]{20,}"),
      std::regex("github_pat_[A-Za-z0-9_]{20,}"),
      std::regex("xox[abprs]-[A-Za-z0-9-]{10,}"),
      std::regex("AKIA[0-9A-Z]{16}"),
      std::regex("AIza[0-9A-Za-z_-]{30,}"),
      std::regex("xai-[A-Za-z0-9]{20,}"),
      std::regex("sara_(dev|hands|m)\\.[\\w-]+\\.[\\w-]+"),
      std::regex("eyJ[\\w-]{8,}\\.[\\w-]{8,}\\.[\\w-]{8,}"),
  };
  for (auto& re : shapes) t = std::regex_replace(t, re, "[hidden]");
  return t;
}
std::string shortText(const std::string& s, size_t n = 500) {
  std::string o;
  o.reserve(std::min(s.size(), n));
  bool sp = false;
  for (char c : s) {
    bool w = c == ' ' || c == '\n' || c == '\r' || c == '\t';
    if (w) {
      if (!sp && !o.empty()) o += ' ';
      sp = true;
    } else {
      o += c;
      sp = false;
    }
    if (o.size() >= n) break;
  }
  return mask(o);
}

std::vector<BYTE> b64dec(const std::string& b64) {
  DWORD n = 0;
  if (!CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, nullptr, &n, nullptr, nullptr)) return {};
  std::vector<BYTE> out(n);
  if (!CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, out.data(), &n, nullptr, nullptr)) return {};
  out.resize(n);
  return out;
}

// ---------------- the command set (CU1) and the device's own rules ----------------
const std::set<std::string> kOps = {"b.start", "b.tabs", "b.open", "b.navigate", "b.snapshot", "b.read", "b.screenshot", "b.logs", "b.request", "b.close", "c.ping"};

struct OpError {
  std::string code, message;
};

std::string lowerA(std::string s) {
  for (auto& c : s) c = (char)tolower((unsigned char)c);
  return s;
}

/** The origin of an http(s) address ("http://host:port"), empty when it isn't one. */
std::string originOfUrl(const std::string& url, std::string* path = nullptr, bool* userinfo = nullptr) {
  std::string l = lowerA(url);
  size_t p = l.find("://");
  if (p == std::string::npos) return {};
  std::string scheme = l.substr(0, p);
  if (scheme != "http" && scheme != "https") return {};
  size_t hs = p + 3;
  size_t he = l.find_first_of("/?#", hs);
  std::string auth = l.substr(hs, he == std::string::npos ? std::string::npos : he - hs);
  if (userinfo) *userinfo = auth.find('@') != std::string::npos;
  if (auth.empty()) return {};
  // Default ports are left out (as browsers write origins).
  if (scheme == "http" && auth.size() > 3 && auth.compare(auth.size() - 3, 3, ":80") == 0) auth.resize(auth.size() - 3);
  if (scheme == "https" && auth.size() > 4 && auth.compare(auth.size() - 4, 4, ":443") == 0) auth.resize(auth.size() - 4);
  if (path) *path = he == std::string::npos ? "/" : url.substr(he);
  return scheme + "://" + auth;
}

bool isPreviewPath(const std::string& path) {
  static const std::regex re("^/preview/[0-9a-f]{32}(/|\\?|#|$)");
  return std::regex_search(path, re);
}

/** Whether the Sara browser may load an address (§4.1); `why` says why not. */
bool addressAllowed(const std::string& url, const std::string& serverOrigin, std::string& why) {
  if (url == "about:blank") return true;
  std::string path;
  bool userinfo = false;
  std::string o = originOfUrl(url, &path, &userinfo);
  if (o.empty()) {
    why = "The Sara browser only opens web addresses (http or https).";
    return false;
  }
  if (userinfo) {
    why = "Addresses with a user name or password are not opened.";
    return false;
  }
  if (o == serverOrigin && !isPreviewPath(path)) {
    why = "Sara's own server is never opened in the Sara browser.";
    return false;
  }
  return true;
}

// ---------------- the Sara browser: Edge or Chrome over a DevTools pipe ----------------
std::wstring regAppPath(const wchar_t* exe) {
  for (HKEY root : {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE}) {
    wchar_t buf[MAX_PATH];
    DWORD n = sizeof(buf);
    std::wstring key = std::wstring(L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\") + exe;
    if (RegGetValueW(root, key.c_str(), nullptr, RRF_RT_REG_SZ, nullptr, buf, &n) == ERROR_SUCCESS && GetFileAttributesW(buf) != INVALID_FILE_ATTRIBUTES) return buf;
  }
  return {};
}
struct BrowserFound {
  std::wstring path;
  std::string kind, name;
};
BrowserFound findBrowser() {
  BrowserFound f;
  std::wstring p = regAppPath(L"msedge.exe");
  if (p.empty()) {
    for (const wchar_t* c : {L"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", L"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"})
      if (GetFileAttributesW(c) != INVALID_FILE_ATTRIBUTES) {
        p = c;
        break;
      }
  }
  if (!p.empty()) return {p, "edge", "Microsoft Edge"};
  p = regAppPath(L"chrome.exe");
  if (p.empty() && GetFileAttributesW(L"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe") != INVALID_FILE_ATTRIBUTES) p = L"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (!p.empty()) return {p, "chrome", "Google Chrome"};
  return f;
}

struct LogEntry {
  long long seq;
  std::string json;  // the entry without seq
  std::string requestId;
  int status = 0;
};

struct Tab {
  std::string id, targetId, sessionId, frameId;
  std::deque<LogEntry> logs;
  int consoleErrors = 0, failedRequests = 0, status = 0;
  long long loads = 0;
  std::map<std::string, std::pair<std::string, std::string>> requests;  // requestId → method, url
};

class Browser {
 public:
  std::string serverOrigin;
  BrowserFound found = findBrowser();
  std::wstring profileDir;

  bool running() {
    std::lock_guard<std::mutex> l(m_);
    return alive_;
  }

  void start(OpError& err) {
    if (running()) return;
    if (found.path.empty()) {
      err = {"perm_missing", "There is no Microsoft Edge or Google Chrome on this computer for the Sara browser."};
      return;
    }
    CreateDirectoryW(profileDir.c_str(), nullptr);
    // Two pipes: the browser reads DevTools commands from its fd 3 and writes answers to fd 4.
    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE toRd = nullptr, toWr = nullptr, fromRd = nullptr, fromWr = nullptr;
    if (!CreatePipe(&toRd, &toWr, &sa, 0) || !CreatePipe(&fromRd, &fromWr, &sa, 0)) {
      err = {"error", "Couldn't make the pipe to the Sara browser."};
      return;
    }
    SetHandleInformation(toWr, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(fromRd, HANDLE_FLAG_INHERIT, 0);
    // The C runtime's inherited-handles block (lpReserved2): count, one flag byte each, the handles.
    const int count = 5;
    std::vector<BYTE> block(sizeof(int) + count + count * sizeof(HANDLE), 0);
    *reinterpret_cast<int*>(block.data()) = count;
    BYTE* flags = block.data() + sizeof(int);
    HANDLE* handles = reinterpret_cast<HANDLE*>(flags + count);
    for (int k = 0; k < count; k++) handles[k] = INVALID_HANDLE_VALUE;
    flags[3] = 0x01 | 0x08;  // FOPEN | FPIPE
    flags[4] = 0x01 | 0x08;
    handles[3] = toRd;
    handles[4] = fromWr;

    std::wstring args = L"\"" + found.path + L"\" --user-data-dir=\"" + profileDir + L"\" --remote-debugging-pipe --no-first-run --no-default-browser-check" +
                        L" --disable-extensions --disable-sync --disable-background-networking --disable-component-update --disable-default-apps --disable-breakpad --no-pings" +
                        L" --disable-features=Translate,MediaRouter,OptimizationHints,msEdgeSync,msImplicitSignin,msSignInFRE,EdgeCollections,msShopping,msEdgeShoppingUI" +
                        L" --window-size=1280,860" + (found.kind == "edge" ? L" --edge-skip-compat-layer-relaunch" : L"") + L" about:blank";
    STARTUPINFOEXW si{};
    si.StartupInfo.cb = sizeof(si);
    si.StartupInfo.dwFlags = STARTF_USESHOWWINDOW;
    si.StartupInfo.wShowWindow = SW_SHOWNOACTIVATE;  // never steal the owner's focus
    si.StartupInfo.cbReserved2 = (WORD)block.size();
    si.StartupInfo.lpReserved2 = block.data();
    // Only the two pipe ends are inherited (nothing else of this app).
    SIZE_T attrSize = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attrSize);
    std::vector<BYTE> attrs(attrSize);
    si.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attrs.data());
    InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, &attrSize);
    HANDLE inherit[2] = {toRd, fromWr};
    UpdateProcThreadAttribute(si.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherit, sizeof(inherit), nullptr, nullptr);
    PROCESS_INFORMATION pi{};
    std::vector<wchar_t> cmd(args.begin(), args.end());
    cmd.push_back(0);
    BOOL ok = CreateProcessW(found.path.c_str(), cmd.data(), nullptr, nullptr, TRUE, EXTENDED_STARTUPINFO_PRESENT, nullptr, nullptr, &si.StartupInfo, &pi);
    DeleteProcThreadAttributeList(si.lpAttributeList);
    CloseHandle(toRd);
    CloseHandle(fromWr);
    if (!ok) {
      CloseHandle(toWr);
      CloseHandle(fromRd);
      err = {"error", "The Sara browser didn't start."};
      return;
    }
    CloseHandle(pi.hThread);
    {
      std::lock_guard<std::mutex> l(m_);
      proc_ = pi.hProcess;
      wr_ = toWr;
      rd_ = fromRd;
      alive_ = true;
      tabs_.clear();
      results_.clear();
    }
    if (reader_.joinable()) reader_.join();
    reader_ = std::thread([this] { readLoop(); });
    // Attach to the first page (it may take a moment to appear).
    for (int k = 0; k < 50; k++) {
      OpError e2;
      J r = call("Target.getTargets", "{}", "", 10000, e2);
      if (!e2.code.empty()) {
        err = e2;
        return;
      }
      for (auto& t : r["targetInfos"].a)
        if (t["type"].str() == "page") attach(t["targetId"].str(), err);
      if (tabCount()) break;
      Sleep(150);
    }
    if (!tabCount()) newTab(err);
  }

  void close() {
    HANDLE proc = nullptr;
    {
      std::lock_guard<std::mutex> l(m_);
      proc = proc_;
    }
    if (running()) send("Browser.close", "{}", "");
    if (proc) {
      if (WaitForSingleObject(proc, 3000) == WAIT_TIMEOUT) TerminateProcess(proc, 0);  // only the browser this app started
    }
    {
      std::lock_guard<std::mutex> l(m_);
      if (wr_) CloseHandle(wr_);
      wr_ = nullptr;
      alive_ = false;
    }
    if (reader_.joinable()) reader_.join();
    std::lock_guard<std::mutex> l(m_);
    if (rd_) CloseHandle(rd_);
    rd_ = nullptr;
    if (proc_) CloseHandle(proc_);
    proc_ = nullptr;
    tabs_.clear();
  }

  /** Sends a DevTools command without waiting. */
  void send(const std::string& method, const std::string& params, const std::string& session) {
    int id;
    {
      std::lock_guard<std::mutex> l(m_);
      id = next_++;
    }
    write("{\"id\":" + std::to_string(id) + ",\"method\":" + q(method) + ",\"params\":" + params + (session.empty() ? "" : ",\"sessionId\":" + q(session)) + "}");
  }

  /** A DevTools command and its answer (or an error). */
  J call(const std::string& method, const std::string& params, const std::string& session, DWORD timeoutMs, OpError& err, const std::atomic<bool>* cancel = nullptr) {
    int id;
    {
      std::lock_guard<std::mutex> l(m_);
      if (!alive_) {
        err = {"error", "The Sara browser was closed."};
        return {};
      }
      id = next_++;
    }
    if (!write("{\"id\":" + std::to_string(id) + ",\"method\":" + q(method) + ",\"params\":" + params + (session.empty() ? "" : ",\"sessionId\":" + q(session)) + "}")) {
      err = {"error", "The Sara browser was closed."};
      return {};
    }
    std::unique_lock<std::mutex> l(m_);
    auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    while (!results_.count(id)) {
      if (!alive_) {
        err = {"error", "The Sara browser was closed."};
        return {};
      }
      if (cancel && cancel->load()) {
        err = {"stopped", "Stopped."};
        return {};
      }
      if (cv_.wait_until(l, std::min(until, std::chrono::steady_clock::now() + std::chrono::milliseconds(100))) == std::cv_status::timeout && std::chrono::steady_clock::now() >= until) {
        err = {"timeout", method + " took too long."};
        return {};
      }
    }
    J r = std::move(results_[id]);
    results_.erase(id);
    if (r.has("error")) {
      err = {"error", r["error"]["message"].str("DevTools error")};
      return {};
    }
    return r["result"];
  }

  bool attach(const std::string& targetId, OpError& err) {
    J r = call("Target.attachToTarget", "{\"targetId\":" + q(targetId) + ",\"flatten\":true}", "", 10000, err);
    if (!err.code.empty()) return false;
    std::string session = r["sessionId"].str();
    std::string id;
    {
      std::lock_guard<std::mutex> l(m_);
      Tab t;
      t.id = "t" + std::to_string(++tabN_);
      t.targetId = targetId;
      t.sessionId = session;
      tabs_[t.id] = t;
      active_ = t.id;
      id = t.id;
    }
    for (const char* d : {"Page.enable", "Runtime.enable", "Network.enable", "Log.enable"}) call(d, "{}", session, 10000, err);
    // §4.1: the server's own pages are refused even when a page sends the browser there.
    call("Fetch.enable", "{\"patterns\":[{\"urlPattern\":" + q(serverOrigin + "/*") + "}]}", session, 10000, err);
    J tree = call("Page.getFrameTree", "{}", session, 10000, err);
    std::lock_guard<std::mutex> l(m_);
    if (tabs_.count(id)) tabs_[id].frameId = tree["frameTree"]["frame"]["id"].str();
    return err.code.empty();
  }

  std::string newTab(OpError& err) {
    J r = call("Target.createTarget", "{\"url\":\"about:blank\"}", "", 10000, err);
    if (!err.code.empty()) return {};
    attach(r["targetId"].str(), err);
    std::lock_guard<std::mutex> l(m_);
    return active_;
  }

  size_t tabCount() {
    std::lock_guard<std::mutex> l(m_);
    return tabs_.size();
  }

  /** A copy of a tab (the current one when id is empty). */
  bool tab(const std::string& want, Tab& out, OpError& err) {
    std::lock_guard<std::mutex> l(m_);
    auto it = tabs_.find(want.empty() ? active_ : want);
    if (it == tabs_.end() && want.empty() && !tabs_.empty()) it = std::prev(tabs_.end());
    if (it == tabs_.end()) {
      err = {"not_found", want.empty() ? "No tab is open." : "No tab " + want + " (pc_browser_tabs lists them)."};
      return false;
    }
    out = it->second;
    return true;
  }
  void activate(const std::string& id) {
    std::lock_guard<std::mutex> l(m_);
    if (tabs_.count(id)) active_ = id;
  }
  std::string activeId() {
    std::lock_guard<std::mutex> l(m_);
    return active_;
  }
  void resetCounts(const std::string& id, bool clearLogs = false) {
    std::lock_guard<std::mutex> l(m_);
    if (!tabs_.count(id)) return;
    tabs_[id].consoleErrors = tabs_[id].failedRequests = tabs_[id].status = 0;
    // A newly opened page starts with its own logs (the numbers keep counting up).
    if (clearLogs) tabs_[id].logs.clear();
  }
  void forget(const std::string& id) {
    std::lock_guard<std::mutex> l(m_);
    tabs_.erase(id);
    if (active_ == id) active_ = tabs_.empty() ? "" : std::prev(tabs_.end())->first;
  }
  std::vector<Tab> allTabs() {
    std::lock_guard<std::mutex> l(m_);
    std::vector<Tab> v;
    for (auto& kv : tabs_) v.push_back(kv.second);
    return v;
  }
  long long loads(const std::string& id) {
    std::lock_guard<std::mutex> l(m_);
    return tabs_.count(id) ? tabs_[id].loads : -1;
  }
  /** Waits for the tab's next page load after `before` (false on timeout / stop). */
  bool waitLoad(const std::string& id, long long before, DWORD ms, const std::atomic<bool>* cancel) {
    std::unique_lock<std::mutex> l(m_);
    auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
    while (alive_ && tabs_.count(id) && tabs_[id].loads == before) {
      if (cancel && cancel->load()) return false;
      if (std::chrono::steady_clock::now() >= until) return false;
      cv_.wait_for(l, std::chrono::milliseconds(100));
    }
    return alive_ && tabs_.count(id);
  }
  long long lastSeq() {
    std::lock_guard<std::mutex> l(m_);
    return seq_;
  }

 private:
  std::mutex m_;
  std::condition_variable cv_;
  bool alive_ = false;
  HANDLE proc_ = nullptr, wr_ = nullptr, rd_ = nullptr;
  std::thread reader_;
  int next_ = 1;
  std::map<int, J> results_;
  std::map<std::string, Tab> tabs_;
  std::string active_;
  int tabN_ = 0;
  long long seq_ = 0;

  bool write(const std::string& msg) {
    HANDLE h;
    {
      std::lock_guard<std::mutex> l(m_);
      h = wr_;
    }
    if (!h) return false;
    static std::mutex wm;
    std::lock_guard<std::mutex> l2(wm);
    std::string data = msg;
    data.push_back('\0');
    DWORD done = 0;
    return WriteFile(h, data.data(), (DWORD)data.size(), &done, nullptr) && done == data.size();
  }

  void readLoop() {
    std::string buf;
    char chunk[65536];
    HANDLE h;
    {
      std::lock_guard<std::mutex> l(m_);
      h = rd_;
    }
    for (;;) {
      DWORD n = 0;
      if (!ReadFile(h, chunk, sizeof chunk, &n, nullptr) || n == 0) break;
      buf.append(chunk, n);
      size_t z;
      while ((z = buf.find('\0')) != std::string::npos) {
        std::string msg = buf.substr(0, z);
        buf.erase(0, z + 1);
        bool ok = false;
        J m = parse(msg, &ok);
        if (!ok) continue;
        if (m.has("id")) {
          std::lock_guard<std::mutex> l(m_);
          results_[(int)m["id"].num()] = std::move(m);
          cv_.notify_all();
        } else event(m);
      }
    }
    std::lock_guard<std::mutex> l(m_);
    alive_ = false;
    tabs_.clear();
    cv_.notify_all();
  }

  Tab* tabOf(const std::string& session) {
    for (auto& kv : tabs_)
      if (kv.second.sessionId == session) return &kv.second;
    return nullptr;
  }
  void log(Tab& t, const std::string& body, const std::string& requestId = "", int status = 0) {
    LogEntry e{++seq_, body, requestId, status};
    t.logs.push_back(e);
    while (t.logs.size() > 500) t.logs.pop_front();
  }

  void event(const J& m) {
    const std::string method = m["method"].str();
    const J& p = m["params"];
    if (method == "Fetch.requestPaused") {
      std::string url = p["request"]["url"].str();
      std::string why;
      bool ok = addressAllowed(url, serverOrigin, why);
      std::string session = m["sessionId"].str();
      send(ok ? "Fetch.continueRequest" : "Fetch.failRequest", ok ? "{\"requestId\":" + q(p["requestId"].str()) + "}" : "{\"requestId\":" + q(p["requestId"].str()) + ",\"errorReason\":\"BlockedByClient\"}", session);
      if (!ok) {
        std::lock_guard<std::mutex> l(m_);
        if (Tab* t = tabOf(session)) log(*t, "\"kind\":\"network\",\"method\":\"GET\",\"url\":" + q(shortText(url)) + ",\"error\":\"blocked by the Sara browser (Sara\\u2019s own server)\"");
      }
      return;
    }
    std::lock_guard<std::mutex> l(m_);
    if (method == "Target.detachedFromTarget") {
      for (auto it = tabs_.begin(); it != tabs_.end(); ++it)
        if (it->second.sessionId == p["sessionId"].str()) {
          if (active_ == it->first) active_.clear();
          tabs_.erase(it);
          if (active_.empty() && !tabs_.empty()) active_ = std::prev(tabs_.end())->first;
          break;
        }
      cv_.notify_all();
      return;
    }
    Tab* t = tabOf(m["sessionId"].str());
    if (!t) return;
    if (method == "Page.loadEventFired") {
      t->loads++;
      cv_.notify_all();
    } else if (method == "Page.frameNavigated") {
      if (!p["frame"].has("parentId")) t->frameId = p["frame"]["id"].str();
    } else if (method == "Runtime.consoleAPICalled") {
      std::string type = p["type"].str();
      if (type != "error" && type != "warning" && type != "assert") return;
      std::string text;
      for (auto& a : p["args"].a) text += (text.empty() ? "" : " ") + (a.has("value") ? (a["value"].t == J::Str ? a["value"].s : dump(a["value"])) : a["description"].str());
      if (type != "warning") t->consoleErrors++;
      const J& f = p["stackTrace"]["callFrames"];
      std::string where = f.a.empty() ? "" : ",\"url\":" + q(shortText(f.a[0]["url"].str())) + ",\"line\":" + num(f.a[0]["lineNumber"].num() + 1);
      log(*t, "\"kind\":\"console\",\"level\":" + q(type == "warning" ? "warning" : "error") + ",\"text\":" + q(shortText(text)) + where);
    } else if (method == "Runtime.exceptionThrown") {
      const J& d = p["exceptionDetails"];
      std::string desc = d["exception"]["description"].str(d["text"].str("error"));
      desc = desc.substr(0, desc.find('\n'));
      t->consoleErrors++;
      log(*t, "\"kind\":\"exception\",\"text\":" + q(shortText(desc)) + (d.has("url") ? ",\"url\":" + q(shortText(d["url"].str())) + ",\"line\":" + num(d["lineNumber"].num() + 1) : ""));
    } else if (method == "Log.entryAdded") {
      const J& e = p["entry"];
      std::string level = e["level"].str();
      if ((level != "error" && level != "warning") || e["source"].str() == "network") return;
      if (level == "error") t->consoleErrors++;
      log(*t, "\"kind\":\"console\",\"level\":" + q(level) + ",\"text\":" + q(shortText(e["text"].str())));
    } else if (method == "Network.requestWillBeSent") {
      t->requests[p["requestId"].str()] = {p["request"]["method"].str("GET"), shortText(p["request"]["url"].str())};
      if (t->requests.size() > 2000) t->requests.erase(t->requests.begin());
    } else if (method == "Network.responseReceived") {
      int status = (int)p["response"]["status"].num();
      std::string url = p["response"]["url"].str();
      if (p["type"].str() == "Document" && p["frameId"].str() == t->frameId) t->status = status;
      if (status >= 400 && url.find("/favicon.ico") == std::string::npos) {
        t->failedRequests++;
        std::string rid = p["requestId"].str();
        std::string meth = t->requests.count(rid) ? t->requests[rid].first : "GET";
        log(*t, "\"kind\":\"network\",\"method\":" + q(meth) + ",\"url\":" + q(shortText(url)) + ",\"status\":" + std::to_string(status) + ",\"type\":" + q(p["type"].str()) + ",\"requestId\":" + q(rid), rid, status);
      }
    } else if (method == "Network.loadingFailed") {
      if (p["canceled"].truthy() || p["blockedReason"].str() == "inspector") return;
      t->failedRequests++;
      std::string rid = p["requestId"].str();
      auto it = t->requests.find(rid);
      log(*t, "\"kind\":\"network\",\"method\":" + q(it != t->requests.end() ? it->second.first : "GET") + ",\"url\":" + q(it != t->requests.end() ? it->second.second : "") + ",\"error\":" + q(shortText(p["errorText"].str())) + ",\"type\":" + q(p["type"].str()) + ",\"requestId\":" + q(rid), rid);
    }
  }

 public:
  /** Log entries after `since` of one tab, as JSON objects. */
  std::string logsJson(const std::string& id, long long since, int max = 200) {
    std::lock_guard<std::mutex> l(m_);
    if (!tabs_.count(id)) return "[]";
    std::vector<const LogEntry*> v;
    for (auto& e : tabs_[id].logs)
      if (e.seq > since) v.push_back(&e);
    if ((int)v.size() > max) v.erase(v.begin(), v.end() - max);
    std::string o = "[";
    for (size_t k = 0; k < v.size(); k++) o += (k ? ",{" : "{") + std::string("\"seq\":") + std::to_string(v[k]->seq) + "," + v[k]->json + "}";
    return o + "]";
  }
  int statusOfRequest(const std::string& id, const std::string& rid) {
    std::lock_guard<std::mutex> l(m_);
    if (!tabs_.count(id)) return 0;
    for (auto& e : tabs_[id].logs)
      if (e.requestId == rid) return e.status;
    return 0;
  }
};

// ---------------- the hands connection (WinHTTP WebSocket) ----------------
struct Request {
  std::string id, op;
  J args;
  DWORD deadlineMs = 30000;
  std::shared_ptr<std::atomic<bool>> cancel = std::make_shared<std::atomic<bool>>(false);
};

class Hands {
 public:
  Host host;
  std::atomic<bool> stopping{false};
  std::atomic<bool> isConnected{false};
  std::atomic<bool> localOnly{false};
  std::mutex errM;
  std::wstring err;
  Browser browser;

  explicit Hands(const Host& h) : host(h) {
    localOnly = h.localOnly;
    browser.profileDir = h.profileDir;
    browser.serverOrigin = lowerA(u8(h.server));
    wake_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    conn_ = std::thread([this] { connectLoop(); });
    worker_ = std::thread([this] { workLoop(); });
  }
  ~Hands() {
    stopping = true;
    SetEvent(wake_);
    closeSocket();
    {
      std::lock_guard<std::mutex> l(qm_);
      for (auto& r : queue_) r->cancel->store(true);
      if (current_) current_->cancel->store(true);
      qcv_.notify_all();
    }
    if (conn_.joinable()) conn_.join();
    if (worker_.joinable()) worker_.join();
    browser.close();
    CloseHandle(wake_);
  }

  void say(const std::wstring& line) {
    if (host.log) host.log(L"hands: " + line);
  }
  void setErr(const std::wstring& e) {
    std::lock_guard<std::mutex> l(errM);
    err = e;
  }

  bool sendText(const std::string& s) {
    std::lock_guard<std::mutex> l(sm_);
    if (!ws_) return false;
    return WinHttpWebSocketSend(ws_, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE, (PVOID)s.data(), (DWORD)s.size()) == NO_ERROR;
  }
  bool sendBinary(const std::string& header, const std::vector<BYTE>& data) {
    std::vector<BYTE> buf(4 + header.size() + data.size());
    DWORD n = (DWORD)header.size();
    buf[0] = (BYTE)(n >> 24);
    buf[1] = (BYTE)(n >> 16);
    buf[2] = (BYTE)(n >> 8);
    buf[3] = (BYTE)n;
    memcpy(buf.data() + 4, header.data(), header.size());
    if (!data.empty()) memcpy(buf.data() + 4 + header.size(), data.data(), data.size());
    std::lock_guard<std::mutex> l(sm_);
    if (!ws_) return false;
    return WinHttpWebSocketSend(ws_, WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE, buf.data(), (DWORD)buf.size()) == NO_ERROR;
  }

  void pressStop() {
    {
      std::lock_guard<std::mutex> l(qm_);
      for (auto& r : queue_) r->cancel->store(true);
      if (current_) current_->cancel->store(true);
    }
    sendText("{\"t\":\"ev\",\"kind\":\"stopped\",\"by\":\"user\"}");
  }
  void tellLocalOnly(bool on) {
    localOnly = on;
    sendText(std::string("{\"t\":\"ev\",\"kind\":\"optin\",\"optIn\":{\"browser\":true,\"desktop\":false},\"localOnly\":") + (on ? "true" : "false") + "}");
  }

 private:
  HANDLE wake_;
  std::thread conn_, worker_;
  std::mutex sm_;  // the socket
  HINTERNET ses_ = nullptr, con_ = nullptr, req_ = nullptr, ws_ = nullptr;
  std::mutex qm_;
  std::condition_variable qcv_;
  std::deque<std::shared_ptr<Request>> queue_;
  std::shared_ptr<Request> current_;
  std::map<std::string, std::string> answers_;  // id → the answer (a retried request gets the same)
  std::deque<std::string> answerOrder_;
  std::deque<ULONGLONG> opens_;
  unsigned frameN_ = 0;
  ULONGLONG lastFrameAt_ = 0;
  size_t lastFrameHash_ = 0;

  void closeSocket() {
    std::lock_guard<std::mutex> l(sm_);
    if (ws_) {
      WinHttpWebSocketClose(ws_, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, nullptr, 0);
      WinHttpCloseHandle(ws_);
    }
    if (req_) WinHttpCloseHandle(req_);
    if (con_) WinHttpCloseHandle(con_);
    if (ses_) WinHttpCloseHandle(ses_);
    ws_ = req_ = con_ = ses_ = nullptr;
  }

  bool connectOnce() {
    URL_COMPONENTS uc{sizeof(uc)};
    wchar_t hostName[256], path[1024];
    uc.lpszHostName = hostName;
    uc.dwHostNameLength = 256;
    uc.lpszUrlPath = path;
    uc.dwUrlPathLength = 1024;
    std::wstring url = host.server + L"/api/hands";
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &uc)) {
      setErr(L"That server address isn't valid.");
      return false;
    }
    HINTERNET ses = WinHttpOpen((L"SaraHands/" + host.appVersion).c_str(), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!ses) return false;
    HINTERNET con = WinHttpConnect(ses, hostName, uc.nPort, 0);
    HINTERNET req = con ? WinHttpOpenRequest(con, L"GET", L"/api/hands", nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0) : nullptr;
    auto fail = [&](const std::wstring& why) {
      if (req) WinHttpCloseHandle(req);
      if (con) WinHttpCloseHandle(con);
      WinHttpCloseHandle(ses);
      if (!why.empty()) setErr(why);
      return false;
    };
    if (!req) return fail(L"Couldn't reach the server.");
    // Never cookies: the token is the only sign-in this connection has.
    DWORD noCookies = WINHTTP_DISABLE_COOKIES;
    WinHttpSetOption(req, WINHTTP_OPTION_DISABLE_FEATURE, &noCookies, sizeof(noCookies));
    WinHttpSetOption(req, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, nullptr, 0);
    std::wstring auth = L"Authorization: Bearer " + wide(host.token);
    if (!WinHttpSendRequest(req, auth.c_str(), (DWORD)-1, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) || !WinHttpReceiveResponse(req, nullptr)) return fail(L"Couldn't reach the server.");
    DWORD status = 0, sz = sizeof(status);
    WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &sz, WINHTTP_NO_HEADER_INDEX);
    if (status == 401) return fail(L"This computer was signed out: switch \"Let Sara use this computer\" off and on again.");
    if (status == 403) return fail(L"The server refused this computer (computer use is off for you there).");
    if (status != 101) return fail(L"The server doesn't take computer use (HTTP " + std::to_wstring(status) + L"): update Sara there.");
    HINTERNET ws = WinHttpWebSocketCompleteUpgrade(req, 0);
    if (!ws) return fail(L"Couldn't open the connection.");
    std::lock_guard<std::mutex> l(sm_);
    ses_ = ses;
    con_ = con;
    req_ = req;
    ws_ = ws;
    return true;
  }

  std::string hello() {
    std::string ops;
    for (auto& o : kOps) ops += (ops.empty() ? "" : ",") + q(o);
    OSVERSIONINFOW v{sizeof(v)};
    DWORD build = 0;
    if (HMODULE nt = GetModuleHandleW(L"ntdll.dll")) {
      using Rtl = LONG(WINAPI*)(OSVERSIONINFOW*);
      if (auto f = reinterpret_cast<Rtl>(GetProcAddress(nt, "RtlGetVersion")); f && f(&v) == 0) build = v.dwBuildNumber;
    }
    return "{\"t\":\"hello\",\"v\":1,\"app\":" + q(u8(host.appVersion)) + ",\"os\":" + q("Windows (build " + std::to_string(build) + ")") + ",\"computer\":" + q(u8(host.computer)) +
           ",\"screens\":[],\"browser\":{\"found\":" + (browser.found.path.empty() ? "false" : "true") + (browser.found.kind.empty() ? "" : ",\"kind\":" + q(browser.found.kind) + ",\"name\":" + q(browser.found.name)) +
           "},\"perms\":{\"capture\":false,\"input\":false,\"ax\":false},\"optIn\":{\"browser\":true,\"desktop\":false},\"approvalsHere\":false,\"logins\":[],\"busy\":false,\"localOnly\":" + (localOnly ? "true" : "false") +
           ",\"ops\":[" + ops + "]}";
  }

  void connectLoop() {
    static const DWORD backoff[] = {1, 2, 5, 10, 30};
    size_t attempt = 0;
    while (!stopping) {
      if (connectOnce()) {
        attempt = 0;
        setErr(L"");
        isConnected = true;
        say(L"connected to " + host.server);
        sendText(hello());
        receiveLoop();
        isConnected = false;
        closeSocket();
        // Whatever was running stops with the connection.
        std::lock_guard<std::mutex> l(qm_);
        for (auto& r : queue_) r->cancel->store(true);
        queue_.clear();
        if (current_) current_->cancel->store(true);
        if (!stopping) say(L"disconnected");
      }
      if (stopping) break;
      std::wstring e;
      {
        std::lock_guard<std::mutex> l(errM);
        e = err;
      }
      // Signed out: wait much longer (the owner switches it on again from the page).
      DWORD s = e.find(L"signed out") != std::wstring::npos ? 300 : backoff[std::min(attempt++, std::size(backoff) - 1)];
      WaitForSingleObject(wake_, s * 1000);
    }
  }

  void receiveLoop() {
    std::vector<BYTE> buf(64 * 1024);
    std::string msg;
    for (;;) {
      HINTERNET ws;
      {
        std::lock_guard<std::mutex> l(sm_);
        ws = ws_;
      }
      if (!ws || stopping) return;
      DWORD n = 0;
      WINHTTP_WEB_SOCKET_BUFFER_TYPE type;
      if (WinHttpWebSocketReceive(ws, buf.data(), (DWORD)buf.size(), &n, &type) != NO_ERROR) return;
      if (type == WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE) return;
      if (type == WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE || type == WINHTTP_WEB_SOCKET_BINARY_FRAGMENT_BUFFER_TYPE) continue;  // the server sends no pictures
      msg.append(reinterpret_cast<char*>(buf.data()), n);
      if (msg.size() > 4 * 1024 * 1024) return;
      if (type == WINHTTP_WEB_SOCKET_UTF8_FRAGMENT_BUFFER_TYPE) continue;
      onText(msg);
      msg.clear();
    }
  }

  void onText(const std::string& raw) {
    bool ok = false;
    J m = parse(raw, &ok);
    if (!ok) return;
    std::string t = m["t"].str();
    if (t == "cancel") {
      std::lock_guard<std::mutex> l(qm_);
      bool all = m["all"].truthy();
      std::string id = m["id"].str();
      for (auto& r : queue_)
        if (all || r->id == id) r->cancel->store(true);
      if (current_ && (all || current_->id == id)) current_->cancel->store(true);
      return;
    }
    if (t != "req") return;
    auto r = std::make_shared<Request>();
    r->id = m["id"].str();
    r->op = m["op"].str();
    r->args = m["args"];
    r->deadlineMs = (DWORD)std::min(120000.0, std::max(1000.0, m["deadlineMs"].num(30000)));
    if (r->id.empty() || r->id.size() > 100) return;
    std::lock_guard<std::mutex> l(qm_);
    // A retried request gets the first answer (once it has one; a running one isn't run twice).
    if (answers_.count(r->id)) {
      sendText(answers_[r->id]);
      return;
    }
    if (current_ && current_->id == r->id) return;
    for (auto& x : queue_)
      if (x->id == r->id) return;
    queue_.push_back(r);
    qcv_.notify_all();
  }

  void workLoop() {
    while (!stopping) {
      std::shared_ptr<Request> r;
      {
        std::unique_lock<std::mutex> l(qm_);
        qcv_.wait(l, [this] { return stopping || !queue_.empty(); });
        if (stopping) return;
        r = queue_.front();
        queue_.pop_front();
        current_ = r;
      }
      // The deadline: the op stops waiting (and answers `timeout`) when it passes.
      std::atomic<bool> done{false};
      std::thread timer([r, &done] {
        auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(r->deadlineMs);
        while (!done && std::chrono::steady_clock::now() < until) std::this_thread::sleep_for(std::chrono::milliseconds(50));
        if (!done) r->cancel->store(true);
      });
      auto started = GetTickCount64();
      std::string answer;
      try {
        OpError e;
        std::string result = run(*r, e);
        if (e.code.empty() && r->cancel->load()) e = {"stopped", "Stopped."};
        if (!e.code.empty() && e.code == "stopped" && GetTickCount64() - started >= r->deadlineMs) e = {"timeout", "Took longer than " + std::to_string(r->deadlineMs / 1000) + " s."};
        answer = e.code.empty() ? "{\"t\":\"res\",\"id\":" + q(r->id) + ",\"ok\":true,\"result\":" + result + "}" : "{\"t\":\"res\",\"id\":" + q(r->id) + ",\"ok\":false,\"error\":{\"code\":" + q(e.code) + ",\"message\":" + q(mask(e.message).substr(0, 500)) + "}}";
      } catch (...) {
        answer = "{\"t\":\"res\",\"id\":" + q(r->id) + ",\"ok\":false,\"error\":{\"code\":\"error\",\"message\":\"Something went wrong on the computer.\"}}";
      }
      done = true;
      timer.join();
      {
        std::lock_guard<std::mutex> l(qm_);
        current_.reset();
        answers_[r->id] = answer;
        answerOrder_.push_back(r->id);
        while (answerOrder_.size() > 100) {
          answers_.erase(answerOrder_.front());
          answerOrder_.pop_front();
        }
      }
      sendText(answer);
    }
  }

  // ---------------- the ops ----------------
  struct Shot {
    std::vector<BYTE> jpeg;
    int w = 0, h = 0;
  };
  Shot shot(const Tab& t, int maxWidth, int quality, OpError& e, const std::atomic<bool>* cancel) {
    Shot s;
    J m = browser.call("Page.getLayoutMetrics", "{}", t.sessionId, 10000, e, cancel);
    if (!e.code.empty()) return s;
    double vw = std::max(1.0, m["cssVisualViewport"]["clientWidth"].num(1280)), vh = std::max(1.0, m["cssVisualViewport"]["clientHeight"].num(800));
    double scale = std::min(1.0, maxWidth / vw);
    J r = browser.call("Page.captureScreenshot", "{\"format\":\"jpeg\",\"quality\":" + std::to_string(quality) + ",\"clip\":{\"x\":0,\"y\":0,\"width\":" + num(vw) + ",\"height\":" + num(vh) + ",\"scale\":" + num(scale) + "}}", t.sessionId, 30000, e, cancel);
    if (!e.code.empty()) return s;
    s.jpeg = b64dec(r["data"].str());
    s.w = (int)(vw * scale + 0.5);
    s.h = (int)(vh * scale + 0.5);
    return s;
  }
  void thumb(const std::string& id, const Tab& t, const J& args, const std::atomic<bool>* cancel) {
    int w = (int)args["thumb"].num(0);
    if (w < 64 || w > 640) return;
    OpError e;
    Shot s = shot(t, w, 55, e, cancel);
    if (e.code.empty() && !s.jpeg.empty()) sendBinary("{\"id\":" + q(id) + ",\"kind\":\"thumb\",\"mime\":\"image/jpeg\",\"w\":" + std::to_string(s.w) + ",\"h\":" + std::to_string(s.h) + "}", s.jpeg);
  }
  /** §3.5: a live-view frame after a change (at most one per 500 ms, only when the picture changed). */
  void frame(const Tab& t) {
    if (GetTickCount64() - lastFrameAt_ < 500) return;
    OpError e;
    Shot s = shot(t, 960, 60, e, nullptr);
    if (!e.code.empty() || s.jpeg.empty()) return;
    size_t h = std::hash<std::string>()(std::string(s.jpeg.begin(), s.jpeg.end()));
    if (h == lastFrameHash_) return;
    lastFrameHash_ = h;
    lastFrameAt_ = GetTickCount64();
    sendBinary("{\"frame\":" + std::to_string(++frameN_) + ",\"mime\":\"image/jpeg\",\"w\":" + std::to_string(s.w) + ",\"h\":" + std::to_string(s.h) + "}", s.jpeg);
  }
  std::string pageInfo(const Tab& t, OpError& e) {
    J r = browser.call("Target.getTargetInfo", "{\"targetId\":" + q(t.targetId) + "}", "", 10000, e);
    return "\"url\":" + q(r["targetInfo"]["url"].str()) + ",\"title\":" + q(mask(r["targetInfo"]["title"].str()));
  }
  std::string counts(const std::string& id) {
    Tab t;
    OpError e;
    if (!browser.tab(id, t, e)) return "\"consoleErrors\":0,\"failedRequests\":0";
    return "\"consoleErrors\":" + std::to_string(t.consoleErrors) + ",\"failedRequests\":" + std::to_string(t.failedRequests);
  }
  /** Runs one page-agent function in an isolated world (the page's own scripts can't touch it). */
  J agent(const Tab& t, const std::string& fn, const std::string& argsJson, OpError& e, const std::atomic<bool>* cancel) {
    J tree = browser.call("Page.getFrameTree", "{}", t.sessionId, 10000, e, cancel);
    if (!e.code.empty()) return {};
    J w = browser.call("Page.createIsolatedWorld", "{\"frameId\":" + q(tree["frameTree"]["frame"]["id"].str()) + ",\"worldName\":\"sara-page-agent\"}", t.sessionId, 10000, e, cancel);
    if (!e.code.empty()) return {};
    std::string expr = "(" + host.pageAgent + ").call(" + q(fn) + ", " + argsJson + ")";
    J r = browser.call("Runtime.evaluate", "{\"expression\":" + q(expr) + ",\"contextId\":" + num(w["executionContextId"].num()) + ",\"returnByValue\":true}", t.sessionId, 20000, e, cancel);
    if (!e.code.empty()) return {};
    if (r.has("exceptionDetails")) {
      e = {"error", "The page couldn't be read."};
      return {};
    }
    return r["result"]["value"];
  }
  bool countOpen(OpError& e) {
    ULONGLONG now = GetTickCount64();
    while (!opens_.empty() && now - opens_.front() > 60000) opens_.pop_front();
    if (opens_.size() >= 20) {
      e = {"rate_limited", "At most 20 pages a minute in the Sara browser."};
      return false;
    }
    opens_.push_back(now);
    return true;
  }
  std::string tabsJson() {
    std::string o = "[";
    std::string act = browser.activeId();
    bool first = true;
    for (auto& t : browser.allTabs()) {
      OpError e;
      std::string info = pageInfo(t, e);
      o += (first ? "{" : ",{") + std::string("\"tab\":") + q(t.id) + "," + info + ",\"active\":" + (t.id == act ? "true" : "false") + "}";
      first = false;
    }
    return o + "]";
  }

  std::string run(Request& r, OpError& e) {
    const std::atomic<bool>* cancel = r.cancel.get();
    const J& a = r.args;
    if (!kOps.count(r.op)) {
      e = {"unsupported", "This computer doesn't do \"" + r.op.substr(0, 40) + "\" (not in its command set)."};
      return {};
    }
    if (r.op == "c.ping") return "{\"pong\":true,\"at\":" + std::to_string(GetTickCount64()) + "}";
    if (r.op != "b.tabs" || browser.running()) {
      browser.start(e);
      if (!e.code.empty()) return {};
    }
    if (r.op == "b.start") return "{\"browser\":{\"kind\":" + q(browser.found.kind) + ",\"name\":" + q(browser.found.name) + "},\"tabs\":" + tabsJson() + "}";
    if (r.op == "b.tabs") return std::string("{\"tabs\":") + (browser.running() ? tabsJson() : "[]") + "}";
    if (r.op == "b.open") {
      std::string url = a["url"].str(), why;
      if (!addressAllowed(url, browser.serverOrigin, why)) {
        e = {"denied_local", why};
        return {};
      }
      if (!countOpen(e)) return {};
      std::string id = a["newTab"].truthy() || !browser.tabCount() ? browser.newTab(e) : "";
      if (!e.code.empty()) return {};
      Tab t;
      if (!browser.tab(id, t, e)) return {};
      browser.activate(t.id);
      browser.resetCounts(t.id, true);
      long long before = browser.loads(t.id);
      J nav = browser.call("Page.navigate", "{\"url\":" + q(url) + "}", t.sessionId, 30000, e, cancel);
      if (!e.code.empty()) return {};
      if (nav.has("errorText")) {
        e = {"not_found", "The page didn't open: " + nav["errorText"].str()};
        return {};
      }
      if (!browser.waitLoad(t.id, before, std::min<DWORD>(r.deadlineMs, 60000), cancel)) {
        if (cancel->load()) e = {"stopped", "Stopped."};
        // A page that never finishes loading is still shown: answer with what is there.
      }
      if (!e.code.empty()) return {};
      Sleep(250);
      Tab now;
      browser.tab(t.id, now, e);
      std::string info = pageInfo(now, e);
      thumb(r.id, now, a, cancel);
      frame(now);
      return "{\"tab\":" + q(now.id) + "," + info + ",\"status\":" + std::to_string(now.status) + "," + counts(now.id) + "}";
    }
    Tab t;
    if (!browser.tab(a["tab"].str(), t, e)) return {};
    if (r.op == "b.navigate") {
      browser.activate(t.id);
      std::string action = a["action"].str("reload");
      long long before = browser.loads(t.id);
      if (action == "reload") {
        browser.resetCounts(t.id);
        browser.call("Page.reload", "{}", t.sessionId, 30000, e, cancel);
      } else if (action == "back" || action == "forward") {
        J h = browser.call("Page.getNavigationHistory", "{}", t.sessionId, 10000, e, cancel);
        if (!e.code.empty()) return {};
        int i = (int)h["currentIndex"].num() + (action == "back" ? -1 : 1);
        if (i < 0 || i >= (int)h["entries"].a.size()) {
          e = {"not_found", "There is no page to go " + action + " to."};
          return {};
        }
        std::string why;
        if (!addressAllowed(h["entries"].a[i]["url"].str(), browser.serverOrigin, why)) {
          e = {"denied_local", "That page isn't opened in the Sara browser."};
          return {};
        }
        browser.call("Page.navigateToHistoryEntry", "{\"entryId\":" + num(h["entries"].a[i]["id"].num()) + "}", t.sessionId, 15000, e, cancel);
      } else {
        e = {"unsupported", "action: back, forward or reload."};
        return {};
      }
      if (!e.code.empty()) return {};
      browser.waitLoad(t.id, before, std::min<DWORD>(r.deadlineMs, 15000), cancel);
      Sleep(200);
      std::string info = pageInfo(t, e);
      thumb(r.id, t, a, cancel);
      frame(t);
      return "{\"tab\":" + q(t.id) + "," + info + "," + counts(t.id) + "}";
    }
    if (r.op == "b.snapshot") {
      J v = agent(t, "snapshot", "{\"from\":" + num(a["from"].num(0)) + ",\"limit\":400}", e, cancel);
      if (!e.code.empty()) return {};
      thumb(r.id, t, a, cancel);
      std::string body = dump(v);
      if (body.size() < 2 || body[0] != '{') body = "{}";
      return "{\"tab\":" + q(t.id) + ",\"viewId\":" + q("v" + std::to_string(GetTickCount64())) + "," + counts(t.id) + (body.size() > 2 ? "," + body.substr(1) : "}");
    }
    if (r.op == "b.read") {
      std::string args = "{\"max\":" + num(a["max"].num(8000)) + (a.has("ref") ? ",\"ref\":" + q(a["ref"].str()) : "") + "}";
      J v = agent(t, "text", args, e, cancel);
      if (!e.code.empty()) return {};
      if (v.has("error")) {
        e = {"not_found", v["error"].str()};
        return {};
      }
      std::string body = dump(v);
      return "{\"tab\":" + q(t.id) + (body.size() > 2 ? "," + body.substr(1) : "}");
    }
    if (r.op == "b.screenshot") {
      int mw = (int)std::min(1920.0, std::max(160.0, a["maxWidth"].num(1280)));
      int ql = (int)std::min(90.0, std::max(30.0, a["quality"].num(70)));
      Shot s = shot(t, mw, ql, e, cancel);
      if (!e.code.empty()) return {};
      std::string viewId = "v" + std::to_string(GetTickCount64());
      sendBinary("{\"id\":" + q(r.id) + ",\"kind\":\"shot\",\"mime\":\"image/jpeg\",\"w\":" + std::to_string(s.w) + ",\"h\":" + std::to_string(s.h) + ",\"viewId\":" + q(viewId) + "}", s.jpeg);
      return "{\"tab\":" + q(t.id) + ",\"w\":" + std::to_string(s.w) + ",\"h\":" + std::to_string(s.h) + ",\"viewId\":" + q(viewId) + "}";
    }
    if (r.op == "b.logs") {
      std::string info = pageInfo(t, e);
      long long since = (long long)a["since"].num(0);
      return "{\"tab\":" + q(t.id) + "," + info + ",\"entries\":" + browser.logsJson(t.id, since) + ",\"last\":" + std::to_string(browser.lastSeq()) + "}";
    }
    if (r.op == "b.request") {
      std::string rid = a["requestId"].str();
      OpError e2;
      J body = browser.call("Network.getResponseBody", "{\"requestId\":" + q(rid) + "}", t.sessionId, 15000, e2, cancel);
      if (!e2.code.empty()) {
        e = {"not_found", "That response is no longer kept by the browser (reload and look again)."};
        return {};
      }
      int status = browser.statusOfRequest(t.id, rid);
      std::string st = status ? std::to_string(status) : "null";
      if (body["base64Encoded"].truthy()) return "{\"status\":" + st + ",\"mime\":\"binary\",\"body\":\"(not text)\",\"truncated\":false}";
      std::string text = mask(body["body"].str());
      bool cut = text.size() > 64 * 1024;
      if (cut) text.resize(64 * 1024);
      return "{\"status\":" + st + ",\"mime\":\"text\",\"body\":" + q(text) + ",\"truncated\":" + (cut ? "true" : "false") + "}";
    }
    if (r.op == "b.close") {
      browser.call("Target.closeTarget", "{\"targetId\":" + q(t.targetId) + "}", "", 10000, e, cancel);
      browser.forget(t.id);
      return "{\"closed\":" + q(t.id) + "}";
    }
    e = {"unsupported", "This computer doesn't do \"" + r.op + "\"."};
    return {};
  }
};

std::mutex g_m;
std::unique_ptr<Hands> g_hands;

}  // namespace

void start(const Host& host) {
  std::unique_ptr<Hands> old;
  {
    std::lock_guard<std::mutex> l(g_m);
    old = std::move(g_hands);
  }
  old.reset();  // closes the old connection and its Sara browser first
  std::lock_guard<std::mutex> l(g_m);
  g_hands = std::make_unique<Hands>(host);
}
void stop() {
  std::unique_ptr<Hands> old;
  {
    std::lock_guard<std::mutex> l(g_m);
    old = std::move(g_hands);
  }
}
void pressStop() {
  std::lock_guard<std::mutex> l(g_m);
  if (g_hands) g_hands->pressStop();
}
void setLocalOnly(bool on) {
  std::lock_guard<std::mutex> l(g_m);
  if (g_hands) g_hands->tellLocalOnly(on);
}
bool running() {
  std::lock_guard<std::mutex> l(g_m);
  return g_hands != nullptr;
}
bool connected() {
  std::lock_guard<std::mutex> l(g_m);
  return g_hands && g_hands->isConnected;
}
std::wstring lastError() {
  std::lock_guard<std::mutex> l(g_m);
  if (!g_hands) return {};
  std::lock_guard<std::mutex> l2(g_hands->errM);
  return g_hands->err;
}
std::wstring browserPath() { return findBrowser().path; }

std::wstring protect(const std::string& secret) {
  DATA_BLOB in{(DWORD)secret.size(), (BYTE*)secret.data()}, out{};
  static const char kEntropy[] = "Sara hands";
  DATA_BLOB ent{sizeof(kEntropy) - 1, (BYTE*)kEntropy};
  if (!CryptProtectData(&in, L"Sara hands", &ent, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &out)) return {};
  DWORD n = 0;
  CryptBinaryToStringW(out.pbData, out.cbData, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &n);
  std::wstring s(n, L'\0');
  CryptBinaryToStringW(out.pbData, out.cbData, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, s.data(), &n);
  s.resize(n);
  LocalFree(out.pbData);
  return s;
}
std::string unprotect(const std::wstring& b64) {
  if (b64.empty()) return {};
  DWORD n = 0;
  if (!CryptStringToBinaryW(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, nullptr, &n, nullptr, nullptr)) return {};
  std::vector<BYTE> raw(n);
  if (!CryptStringToBinaryW(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, raw.data(), &n, nullptr, nullptr)) return {};
  DATA_BLOB in{n, raw.data()}, out{};
  static const char kEntropy[] = "Sara hands";
  DATA_BLOB ent{sizeof(kEntropy) - 1, (BYTE*)kEntropy};
  if (!CryptUnprotectData(&in, nullptr, &ent, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &out)) return {};
  std::string s((char*)out.pbData, out.cbData);
  SecureZeroMemory(out.pbData, out.cbData);
  LocalFree(out.pbData);
  return s;
}

}  // namespace sarahands

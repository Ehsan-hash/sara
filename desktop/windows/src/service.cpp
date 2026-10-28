// SaraService.exe (Phase 46c): runs Sara's server on Windows.
//
//   SaraService.exe --service          started by Windows (service "Sara", account NT SERVICE\Sara)
//   SaraService.exe --run              the same supervisor in the signed-in user's session
//                                      ("only while I'm signed in"; started from the HKCU Run key)
//   SaraService.exe --start | --stop   start/stop her, whichever way she runs (the `sara` command)
//   SaraService.exe --state            prints running / stopped / not-installed
//   SaraService.exe --install-service | --remove-service      (administrator; used by the installer)
//   SaraService.exe --port-free N      exit code 0 when nothing listens on port N
//   SaraService.exe --lan-ip           this computer's address on the home network
//
// The supervisor reads sara.env next to this exe (KEY=VALUE lines: SARA_DATA, SARA_PORT, ...),
// starts <dir>\node\node.exe <dir>\server\src\main.ts with those variables, restarts it with a
// growing pause when it stops by itself, and on stop closes the server's stdin (the server then
// shuts down cleanly: SARA_STOP_ON_STDIN_END=1), killing it only if it hasn't gone after 20 s.
// Its own lines and the server's error output go to <data>\logs\service.log. The server's normal
// output is not kept here: the one-time owner token is printed there (it also lands in
// <data>\first-token.txt until the first sign-in, which is what the installer shows).
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>
#include <windows.h>
#include <shellapi.h>
#include <cstdio>
#include <cwchar>
#include <map>
#include <string>
#include <vector>

static const wchar_t* kServiceName = L"Sara";
static const wchar_t* kServiceAccount = L"NT SERVICE\\Sara";

// ---------- small helpers ----------
static std::wstring exePath() {
  wchar_t buf[MAX_PATH * 2];
  DWORD n = GetModuleFileNameW(nullptr, buf, (DWORD)std::size(buf));
  return std::wstring(buf, n);
}
static std::wstring exeDir() {
  std::wstring p = exePath();
  return p.substr(0, p.find_last_of(L'\\'));
}
static std::wstring lower(std::wstring s) {
  for (auto& c : s) c = (wchar_t)towlower(c);
  return s;
}
static std::wstring trim(const std::wstring& s) {
  size_t a = 0, b = s.size();
  while (a < b && iswspace(s[a])) a++;
  while (b > a && iswspace(s[b - 1])) b--;
  return s.substr(a, b - a);
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

/** A short stable tag for this install folder, so two installs never share stop signals. */
static std::wstring installTag() {
  unsigned long long h = 1469598103934665603ULL;
  for (wchar_t c : lower(exeDir())) {
    h ^= (unsigned long long)c;
    h *= 1099511628211ULL;
  }
  wchar_t b[32];
  swprintf(b, 32, L"%016llx", h);
  return b;
}

// ---------- output (a GUI-subsystem exe: no console window at sign-in. Output goes to the handle a
// caller passed in (a pipe or file), else to the terminal it was started from) ----------
static bool g_console = false;
static HANDLE g_out = nullptr;
static void attachConsole() {
  HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
  if (h && h != INVALID_HANDLE_VALUE && GetFileType(h) != FILE_TYPE_UNKNOWN) {
    g_out = h;
    g_console = true;
    return;
  }
  if (AttachConsole(ATTACH_PARENT_PROCESS)) {
    g_out = CreateFileW(L"CONOUT$", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
    g_console = g_out != INVALID_HANDLE_VALUE;
  }
}
static void say(const std::wstring& line) {
  if (!g_console) return;
  std::wstring l = line + L"\r\n";
  DWORD w;
  if (GetFileType(g_out) == FILE_TYPE_CHAR && WriteConsoleW(g_out, l.data(), (DWORD)l.size(), &w, nullptr)) return;
  std::string s = toUtf8(l);
  WriteFile(g_out, s.data(), (DWORD)s.size(), &w, nullptr);
}

// ---------- sara.env ----------
using Env = std::map<std::wstring, std::wstring>;
static std::wstring configPath() { return exeDir() + L"\\sara.env"; }
static Env readConfig() {
  Env env;
  FILE* f = nullptr;
  if (_wfopen_s(&f, configPath().c_str(), L"rb") != 0 || !f) return env;
  std::string all;
  char buf[4096];
  size_t n;
  while ((n = fread(buf, 1, sizeof buf, f)) > 0) all.append(buf, n);
  fclose(f);
  if (all.size() >= 3 && (unsigned char)all[0] == 0xEF && (unsigned char)all[1] == 0xBB && (unsigned char)all[2] == 0xBF) all.erase(0, 3);
  std::wstring text = fromUtf8(all);
  size_t start = 0;
  while (start <= text.size()) {
    size_t end = text.find(L'\n', start);
    std::wstring line = trim(text.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start));
    if (!line.empty() && line[0] != L'#') {
      size_t eq = line.find(L'=');
      if (eq != std::wstring::npos && eq > 0) {
        std::wstring k = trim(line.substr(0, eq)), v = trim(line.substr(eq + 1));
        if (v.size() >= 2 && (v.front() == L'"' || v.front() == L'\'') && v.back() == v.front()) v = v.substr(1, v.size() - 2);
        env[k] = v;
      }
    }
    if (end == std::wstring::npos) break;
    start = end + 1;
  }
  return env;
}
static bool serviceMode(const Env& cfg) {
  auto it = cfg.find(L"SARA_MODE");
  return it != cfg.end() && lower(it->second) == L"service";
}

// ---------- log ----------
static std::wstring g_logPath;
static void logLine(const std::wstring& line) {
  say(line);
  if (g_logPath.empty()) return;
  HANDLE h = CreateFileW(g_logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (h == INVALID_HANDLE_VALUE) return;
  SYSTEMTIME t;
  GetLocalTime(&t);
  wchar_t stamp[64];
  swprintf(stamp, 64, L"%04d-%02d-%02d %02d:%02d:%02d ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
  std::string s = toUtf8(std::wstring(stamp) + L"[service] " + line) + "\r\n";
  DWORD w;
  WriteFile(h, s.data(), (DWORD)s.size(), &w, nullptr);
  CloseHandle(h);
}
/** Keeps service.log below about 5 MB (one older copy kept as service.log.1). */
static void rotateLog() {
  WIN32_FILE_ATTRIBUTE_DATA a;
  if (!GetFileAttributesExW(g_logPath.c_str(), GetFileExInfoStandard, &a)) return;
  if (a.nFileSizeHigh == 0 && a.nFileSizeLow < 5u * 1024 * 1024) return;
  MoveFileExW(g_logPath.c_str(), (g_logPath + L".1").c_str(), MOVEFILE_REPLACE_EXISTING);
}

// ---------- the supervisor ----------
static HANDLE g_stop = nullptr;  // set when she should stop (service stop, --stop, Ctrl+C)

/** Our environment plus the config, as a CreateProcess environment block. */
static std::vector<wchar_t> buildEnvBlock(const Env& cfg) {
  struct CaseLess {
    bool operator()(const std::wstring& a, const std::wstring& b) const { return _wcsicmp(a.c_str(), b.c_str()) < 0; }
  };
  std::map<std::wstring, std::wstring, CaseLess> all;
  if (wchar_t* block = GetEnvironmentStringsW()) {
    for (wchar_t* p = block; *p; p += wcslen(p) + 1) {
      std::wstring e = p;
      size_t eq = e.find(L'=', 1);  // skip the "=C:=C:\..." drive entries' leading '='
      if (eq == std::wstring::npos) continue;
      all[e.substr(0, eq)] = e.substr(eq + 1);
    }
    FreeEnvironmentStringsW(block);
  }
  for (auto& [k, v] : cfg)
    if (k != L"SARA_MODE") all[k] = v;
  all[L"SARA_INSTALLED"] = L"1";
  all[L"SARA_STOP_ON_STDIN_END"] = L"1";
  std::vector<wchar_t> out;
  for (auto& [k, v] : all) {
    std::wstring e = k + L"=" + v;
    out.insert(out.end(), e.begin(), e.end());
    out.push_back(L'\0');
  }
  out.push_back(L'\0');
  return out;
}

struct Child {
  HANDLE process = nullptr;
  HANDLE job = nullptr;
  HANDLE stdinWrite = nullptr;
};

static bool startServer(const Env& cfg, Child& c) {
  std::wstring dir = exeDir();
  std::wstring node = dir + L"\\node\\node.exe";
  std::wstring server = dir + L"\\server";
  std::wstring cmd = L"\"" + node + L"\" --disable-warning=ExperimentalWarning \"" + server + L"\\src\\main.ts\"";

  SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
  HANDLE inRead = nullptr, inWrite = nullptr;
  if (!CreatePipe(&inRead, &inWrite, &sa, 0)) return false;
  SetHandleInformation(inWrite, HANDLE_FLAG_INHERIT, 0);
  HANDLE nul = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, nullptr);
  HANDLE err = CreateFileW(g_logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, &sa, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (err == INVALID_HANDLE_VALUE) err = nul;

  STARTUPINFOW si{sizeof(si)};
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = inRead;
  si.hStdOutput = nul;
  si.hStdError = err;
  PROCESS_INFORMATION pi{};
  std::vector<wchar_t> envBlock = buildEnvBlock(cfg);
  std::vector<wchar_t> cmdBuf(cmd.begin(), cmd.end());
  cmdBuf.push_back(L'\0');
  BOOL ok = CreateProcessW(node.c_str(), cmdBuf.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                           envBlock.data(), server.c_str(), &si, &pi);
  DWORD startErr = GetLastError();
  CloseHandle(inRead);
  if (nul != INVALID_HANDLE_VALUE) CloseHandle(nul);
  if (err != nul && err != INVALID_HANDLE_VALUE) CloseHandle(err);
  if (!ok) {
    CloseHandle(inWrite);
    logLine(L"Couldn't start " + node + L" (error " + std::to_wstring(startErr) + L").");
    return false;
  }
  // Everything she starts (commands, add-ons) goes with her when she stops or this process dies.
  c.job = CreateJobObjectW(nullptr, nullptr);
  if (c.job) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION li{};
    li.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(c.job, JobObjectExtendedLimitInformation, &li, sizeof(li));
    AssignProcessToJobObject(c.job, pi.hProcess);
  }
  ResumeThread(pi.hThread);
  CloseHandle(pi.hThread);
  c.process = pi.hProcess;
  c.stdinWrite = inWrite;
  return true;
}

static void stopServer(Child& c) {
  if (!c.process) return;
  // Closing her stdin is the polite "please stop" (Windows has no SIGTERM).
  if (c.stdinWrite) {
    CloseHandle(c.stdinWrite);
    c.stdinWrite = nullptr;
  }
  if (WaitForSingleObject(c.process, 20000) == WAIT_TIMEOUT) {
    logLine(L"She didn't stop within 20 seconds; ending her.");
    if (c.job) TerminateJobObject(c.job, 1);
    else TerminateProcess(c.process, 1);
    WaitForSingleObject(c.process, 5000);
  }
}
static void closeChild(Child& c) {
  if (c.stdinWrite) CloseHandle(c.stdinWrite);
  if (c.process) CloseHandle(c.process);
  if (c.job) CloseHandle(c.job);  // kills anything left in the job
  c = Child{};
}

using StatusFn = void (*)(DWORD state);
/** Runs (and re-runs) the server until g_stop is set. */
static int supervise(StatusFn status) {
  Env cfg = readConfig();
  auto data = cfg.find(L"SARA_DATA");
  if (data == cfg.end() || data->second.empty()) {
    say(L"No SARA_DATA in " + configPath() + L": run the installer again.");
    if (status) status(SERVICE_STOPPED);
    return 2;
  }
  CreateDirectoryW(data->second.c_str(), nullptr);
  CreateDirectoryW((data->second + L"\\logs").c_str(), nullptr);
  g_logPath = data->second + L"\\logs\\service.log";
  rotateLog();
  int failures = 0;
  bool reportedRunning = false;
  while (true) {
    cfg = readConfig();  // `sara access` changes apply at the next start
    Child c;
    ULONGLONG started = GetTickCount64();
    if (startServer(cfg, c)) {
      auto port = cfg.find(L"SARA_PORT");
      logLine(L"Started Sara (process " + std::to_wstring(GetProcessId(c.process)) + L", port " + (port != cfg.end() ? port->second : L"7860") + L").");
      if (status && !reportedRunning) {
        status(SERVICE_RUNNING);
        reportedRunning = true;
      }
      HANDLE both[2] = {g_stop, c.process};
      DWORD w = WaitForMultipleObjects(2, both, FALSE, INFINITE);
      if (w == WAIT_OBJECT_0) {
        logLine(L"Stopping Sara...");
        if (status) status(SERVICE_STOP_PENDING);
        stopServer(c);
        closeChild(c);
        logLine(L"Sara stopped.");
        break;
      }
      DWORD code = 0;
      GetExitCodeProcess(c.process, &code);
      closeChild(c);
      if (GetTickCount64() - started > 120000) failures = 0;  // she ran fine for a while
      logLine(L"Sara stopped by herself (exit code " + std::to_wstring(code) + L").");
    } else if (status && !reportedRunning) {
      // Report running anyway: the retry below is ours, not Windows' (it would give up at once).
      status(SERVICE_RUNNING);
      reportedRunning = true;
    }
    failures++;
    // 2, 4, 8, 16, 32, then every 60 seconds.
    DWORD pause = failures >= 6 ? 60000 : (DWORD)(1000u << failures);
    logLine(L"Starting her again in " + std::to_wstring(pause / 1000) + L" seconds.");
    if (WaitForSingleObject(g_stop, pause) == WAIT_OBJECT_0) {
      logLine(L"Sara stopped.");
      break;
    }
  }
  if (status) status(SERVICE_STOPPED);
  return 0;
}

// ---------- Windows service ----------
static SERVICE_STATUS_HANDLE g_statusHandle = nullptr;
static SERVICE_STATUS g_status{};
static void setStatus(DWORD state) {
  g_status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
  g_status.dwCurrentState = state;
  g_status.dwControlsAccepted = state == SERVICE_RUNNING ? SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN : 0;
  g_status.dwWin32ExitCode = NO_ERROR;
  g_status.dwWaitHint = state == SERVICE_STOP_PENDING ? 30000 : state == SERVICE_START_PENDING ? 10000 : 0;
  g_status.dwCheckPoint = (state == SERVICE_RUNNING || state == SERVICE_STOPPED) ? 0 : g_status.dwCheckPoint + 1;
  if (g_statusHandle) SetServiceStatus(g_statusHandle, &g_status);
}
static DWORD WINAPI serviceHandler(DWORD control, DWORD, LPVOID, LPVOID) {
  switch (control) {
    case SERVICE_CONTROL_STOP:
    case SERVICE_CONTROL_SHUTDOWN:
      setStatus(SERVICE_STOP_PENDING);
      SetEvent(g_stop);
      return NO_ERROR;
    case SERVICE_CONTROL_INTERROGATE:
      return NO_ERROR;
  }
  return ERROR_CALL_NOT_IMPLEMENTED;
}
static void WINAPI serviceMain(DWORD, LPWSTR*) {
  g_statusHandle = RegisterServiceCtrlHandlerExW(kServiceName, serviceHandler, nullptr);
  if (!g_statusHandle) return;
  setStatus(SERVICE_START_PENDING);
  g_stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  supervise(setStatus);
}

// ---------- signed-in user mode ----------
static std::wstring stopEventName() { return L"Local\\SaraServerStop-" + installTag(); }
static std::wstring runningMutexName() { return L"Local\\SaraServerRunning-" + installTag(); }

static BOOL WINAPI consoleCtrl(DWORD) {
  if (g_stop) SetEvent(g_stop);
  return TRUE;
}
static int runUser() {
  HANDLE mutex = CreateMutexW(nullptr, TRUE, runningMutexName().c_str());
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    say(L"Sara is already running.");
    return 0;
  }
  g_stop = CreateEventW(nullptr, TRUE, FALSE, stopEventName().c_str());
  ResetEvent(g_stop);
  SetConsoleCtrlHandler(consoleCtrl, TRUE);
  int rc = supervise(nullptr);
  ReleaseMutex(mutex);
  CloseHandle(mutex);
  return rc;
}
static bool userRunning() {
  HANDLE m = OpenMutexW(SYNCHRONIZE, FALSE, runningMutexName().c_str());
  if (!m) return false;
  CloseHandle(m);
  return true;
}

// ---------- service control ----------
static DWORD serviceState() {  // 0 = not installed
  SC_HANDLE scm = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
  if (!scm) return 0;
  SC_HANDLE s = OpenServiceW(scm, kServiceName, SERVICE_QUERY_STATUS);
  DWORD st = 0;
  if (s) {
    SERVICE_STATUS_PROCESS sp;
    DWORD need;
    if (QueryServiceStatusEx(s, SC_STATUS_PROCESS_INFO, (LPBYTE)&sp, sizeof(sp), &need)) st = sp.dwCurrentState;
    CloseServiceHandle(s);
  }
  CloseServiceHandle(scm);
  return st;
}
static bool waitServiceState(DWORD want, DWORD ms) {
  for (DWORD t = 0; t < ms; t += 250) {
    if (serviceState() == want) return true;
    Sleep(250);
  }
  return serviceState() == want;
}
static int controlService(bool start) {
  SC_HANDLE scm = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
  if (!scm) return 5;
  SC_HANDLE s = OpenServiceW(scm, kServiceName, SERVICE_START | SERVICE_STOP | SERVICE_QUERY_STATUS);
  if (!s) {
    DWORD e = GetLastError();
    CloseServiceHandle(scm);
    if (e == ERROR_ACCESS_DENIED) say(L"Starting or stopping the service needs a terminal opened as administrator.");
    else say(L"The Sara service isn't installed.");
    return e == ERROR_ACCESS_DENIED ? 5 : 3;
  }
  int rc = 0;
  if (start) {
    if (!StartServiceW(s, 0, nullptr) && GetLastError() != ERROR_SERVICE_ALREADY_RUNNING) rc = (int)GetLastError();
    else if (!waitServiceState(SERVICE_RUNNING, 30000)) rc = 1;
  } else {
    SERVICE_STATUS st;
    if (!ControlService(s, SERVICE_CONTROL_STOP, &st) && GetLastError() != ERROR_SERVICE_NOT_ACTIVE) rc = (int)GetLastError();
    else if (!waitServiceState(SERVICE_STOPPED, 45000)) rc = 1;
  }
  CloseServiceHandle(s);
  CloseServiceHandle(scm);
  if (rc == ERROR_ACCESS_DENIED) say(L"Starting or stopping the service needs a terminal opened as administrator.");
  return rc;
}

static int installService() {
  SC_HANDLE scm = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_ALL_ACCESS);
  if (!scm) {
    say(L"Installing the service needs administrator rights.");
    return 5;
  }
  std::wstring bin = L"\"" + exePath() + L"\" --service";
  SC_HANDLE s = OpenServiceW(scm, kServiceName, SERVICE_ALL_ACCESS);
  if (s) {
    if (!ChangeServiceConfigW(s, SERVICE_WIN32_OWN_PROCESS, SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, bin.c_str(), nullptr, nullptr, nullptr, kServiceAccount, L"", L"Sara")) {
      say(L"Couldn't update the service (error " + std::to_wstring(GetLastError()) + L").");
      CloseServiceHandle(s);
      CloseServiceHandle(scm);
      return 1;
    }
  } else {
    s = CreateServiceW(scm, kServiceName, L"Sara", SERVICE_ALL_ACCESS, SERVICE_WIN32_OWN_PROCESS, SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, bin.c_str(), nullptr, nullptr, nullptr, kServiceAccount, nullptr);
    if (!s) {
      say(L"Couldn't create the service (error " + std::to_wstring(GetLastError()) + L").");
      CloseServiceHandle(scm);
      return 1;
    }
  }
  SERVICE_DESCRIPTIONW d{(LPWSTR)L"Sara, your self-hosted AI companion (the server). Settings: sara.env next to SaraService.exe; logs in the data folder."};
  ChangeServiceConfig2W(s, SERVICE_CONFIG_DESCRIPTION, &d);
  SERVICE_DELAYED_AUTO_START_INFO delayed{TRUE};
  ChangeServiceConfig2W(s, SERVICE_CONFIG_DELAYED_AUTO_START_INFO, &delayed);
  SERVICE_SID_INFO sid{SERVICE_SID_TYPE_UNRESTRICTED};
  ChangeServiceConfig2W(s, SERVICE_CONFIG_SERVICE_SID_INFO, &sid);
  // If the service process itself dies, Windows starts it again (our own loop handles the server).
  SC_ACTION actions[3] = {{SC_ACTION_RESTART, 5000}, {SC_ACTION_RESTART, 30000}, {SC_ACTION_RESTART, 60000}};
  SERVICE_FAILURE_ACTIONSW fa{};
  fa.dwResetPeriod = 24 * 3600;
  fa.cActions = 3;
  fa.lpsaActions = actions;
  ChangeServiceConfig2W(s, SERVICE_CONFIG_FAILURE_ACTIONS, &fa);
  SERVICE_FAILURE_ACTIONS_FLAG flag{TRUE};
  ChangeServiceConfig2W(s, SERVICE_CONFIG_FAILURE_ACTIONS_FLAG, &flag);
  CloseServiceHandle(s);
  CloseServiceHandle(scm);
  say(L"Service Sara is installed (account NT SERVICE\\Sara, starts at boot).");
  return 0;
}
static int removeService() {
  SC_HANDLE scm = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_ALL_ACCESS);
  if (!scm) {
    say(L"Removing the service needs administrator rights.");
    return 5;
  }
  SC_HANDLE s = OpenServiceW(scm, kServiceName, SERVICE_ALL_ACCESS);
  if (!s) {
    CloseServiceHandle(scm);
    return 0;
  }
  SERVICE_STATUS st;
  ControlService(s, SERVICE_CONTROL_STOP, &st);
  waitServiceState(SERVICE_STOPPED, 45000);
  BOOL ok = DeleteService(s);
  CloseServiceHandle(s);
  CloseServiceHandle(scm);
  return ok ? 0 : (int)GetLastError();
}

// ---------- start / stop / state, whichever way she runs ----------
static int startAny() {
  Env cfg = readConfig();
  if (serviceMode(cfg)) return controlService(true);
  if (userRunning()) return 0;
  std::wstring cmd = L"\"" + exePath() + L"\" --run";
  std::vector<wchar_t> buf(cmd.begin(), cmd.end());
  buf.push_back(L'\0');
  STARTUPINFOW si{sizeof(si)};
  PROCESS_INFORMATION pi{};
  if (!CreateProcessW(exePath().c_str(), buf.data(), nullptr, nullptr, FALSE, DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB, nullptr, exeDir().c_str(), &si, &pi) &&
      !CreateProcessW(exePath().c_str(), buf.data(), nullptr, nullptr, FALSE, DETACHED_PROCESS, nullptr, exeDir().c_str(), &si, &pi))
    return (int)GetLastError();
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  for (int i = 0; i < 40 && !userRunning(); i++) Sleep(100);
  return userRunning() ? 0 : 1;
}
static int stopAny() {
  Env cfg = readConfig();
  if (serviceMode(cfg)) return controlService(false);
  if (!userRunning()) return 0;
  HANDLE ev = OpenEventW(EVENT_MODIFY_STATE, FALSE, stopEventName().c_str());
  if (!ev) return 1;
  SetEvent(ev);
  CloseHandle(ev);
  for (int i = 0; i < 300 && userRunning(); i++) Sleep(100);  // up to 30 s
  return userRunning() ? 1 : 0;
}
static int printState() {
  Env cfg = readConfig();
  const wchar_t* s;
  int rc;
  if (serviceMode(cfg)) {
    DWORD st = serviceState();
    s = st == 0 ? L"not-installed" : st == SERVICE_RUNNING ? L"running" : st == SERVICE_STOPPED ? L"stopped" : L"changing";
    rc = st == SERVICE_RUNNING ? 0 : st == 0 ? 3 : 1;
  } else {
    bool on = userRunning();
    s = on ? L"running" : L"stopped";
    rc = on ? 0 : 1;
  }
  say(s);
  return rc;
}

// ---------- helpers for the installer ----------
static int portFree(int port) {
  WSADATA w;
  if (WSAStartup(MAKEWORD(2, 2), &w) != 0) return 2;
  int rc = 0;
  for (const char* addr : {"127.0.0.1", "0.0.0.0"}) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) continue;
    BOOL excl = TRUE;
    setsockopt(s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char*)&excl, sizeof(excl));
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons((u_short)port);
    inet_pton(AF_INET, addr, &a.sin_addr);
    if (bind(s, (sockaddr*)&a, sizeof(a)) != 0) rc = 1;
    closesocket(s);
  }
  WSACleanup();
  say(rc == 0 ? L"free" : L"in use");
  return rc;
}
static int lanIp() {
  ULONG size = 32 * 1024;
  std::vector<unsigned char> buf(size);
  auto* aa = (IP_ADAPTER_ADDRESSES*)buf.data();
  if (GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_INCLUDE_GATEWAYS, nullptr, aa, &size) == ERROR_BUFFER_OVERFLOW) {
    buf.resize(size);
    aa = (IP_ADAPTER_ADDRESSES*)buf.data();
    if (GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_INCLUDE_GATEWAYS, nullptr, aa, &size) != NO_ERROR) return 1;
  }
  // The home-network address: an up adapter with a default gateway and a private address.
  for (auto* a = aa; a; a = a->Next) {
    if (a->OperStatus != IfOperStatusUp || a->IfType == IF_TYPE_SOFTWARE_LOOPBACK || !a->FirstGatewayAddress) continue;
    for (auto* u = a->FirstUnicastAddress; u; u = u->Next) {
      auto* sin = (sockaddr_in*)u->Address.lpSockaddr;
      unsigned char* b = (unsigned char*)&sin->sin_addr;
      bool priv = b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
      if (!priv) continue;
      char txt[32];
      inet_ntop(AF_INET, &sin->sin_addr, txt, sizeof txt);
      say(fromUtf8(txt));
      return 0;
    }
  }
  return 1;
}

static void help() {
  say(L"SaraService.exe runs Sara's server. Use the `sara` command instead (sara help).\n"
      L"  --run               run in this session    --start / --stop / --state\n"
      L"  --install-service / --remove-service (administrator)\n"
      L"  --port-free N       --lan-ip");
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, LPWSTR, int) {
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  std::wstring cmd = argc > 1 ? argv[1] : L"";
  if (cmd == L"--service") {
    SERVICE_TABLE_ENTRYW table[] = {{(LPWSTR)kServiceName, serviceMain}, {nullptr, nullptr}};
    return StartServiceCtrlDispatcherW(table) ? 0 : (int)GetLastError();
  }
  attachConsole();
  if (cmd == L"--run") return runUser();  // from a terminal its lines show there too; Ctrl+C stops her
  if (cmd == L"--start") return startAny();
  if (cmd == L"--stop") return stopAny();
  if (cmd == L"--state") return printState();
  if (cmd == L"--install-service") return installService();
  if (cmd == L"--remove-service") return removeService();
  if (cmd == L"--port-free" && argc > 2) return portFree(_wtoi(argv[2]));
  if (cmd == L"--lan-ip") return lanIp();
  help();
  return cmd.empty() || cmd == L"--help" ? 0 : 2;
}

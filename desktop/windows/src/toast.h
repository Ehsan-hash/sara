// Phase 75 stage 3 (native): Windows toast notifications with buttons, for Sara.exe.
// Raw WinRT ABI through WRL (only the Windows SDK: windows.ui.notifications.h, runtimeobject.lib),
// no C++/WinRT and no NuGet package.
//
// How Windows finds the app for a toast (an unpackaged Win32 app):
//   - the process says who it is: SetCurrentProcessExplicitAppUserModelID(<AUMID>) (main.cpp);
//   - HKCU\Software\Classes\AppUserModelId\<AUMID>: DisplayName, IconUri and CustomActivator =
//     the CLSID below (so the toast shows "Sara" with her icon, even for a --portable copy);
//   - the Start-menu shortcut carries the same AUMID and the activator CLSID (the installer's
//     [Icons] entry and the app's own self-install), so taskbar pins and toasts line up;
//   - HKCU\Software\Classes\CLSID\<CLSID>\LocalServer32 = "Sara.exe" -ToastActivated: a click on a
//     toast (or one of its buttons) while Sara isn't running starts her; while she runs, COM hands
//     the click to the class object she registered (CoRegisterClassObject), in this process.
// Everything here is per user (HKCU); no administrator rights.
#pragma once
#include <windows.h>
#include <wrl.h>
#include <wrl/wrappers/corewrappers.h>
#include <roapi.h>
#include <windows.ui.notifications.h>
#include <windows.data.xml.dom.h>
#include <notificationactivationcallback.h>
#include <functional>
#include <string>

namespace saratoast {
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::Wrappers::HStringReference;
namespace WUN = ABI::Windows::UI::Notifications;
namespace WDX = ABI::Windows::Data::Xml::Dom;

/** Text for the toast's XML (attribute values and element text). */
inline std::wstring xml(const std::wstring& s) {
  std::wstring o;
  for (wchar_t c : s) {
    if (c == L'&') o += L"&amp;";
    else if (c == L'<') o += L"&lt;";
    else if (c == L'>') o += L"&gt;";
    else if (c == L'"') o += L"&quot;";
    else if (c == L'\'') o += L"&apos;";
    else if (c < 0x20 && c != L'\n' && c != L'\t') o += L' ';
    else o += c;
  }
  return o;
}

struct State {
  std::wstring aumid;
  ComPtr<WUN::IToastNotifier> notifier;
  DWORD cookie = 0;
  /** A click on a toast or a button: (AUMID it was for, the button's / toast's arguments). */
  std::function<void(const std::wstring&, const std::wstring&)> onActivate;
};
inline State& state() {
  static State s;
  return s;
}

/** A WinRT string over s (s must outlive it). */
inline HStringReference hstr(const std::wstring& s) { return HStringReference(s.c_str(), static_cast<unsigned int>(s.size())); }

/** The notifier for this AUMID (once). False if this Windows has no toasts for us. */
inline bool init(const std::wstring& aumid) {
  State& st = state();
  if (st.notifier && st.aumid == aumid) return true;
  st.aumid = aumid;
  st.notifier.Reset();
  ComPtr<WUN::IToastNotificationManagerStatics> mgr;
  if (FAILED(RoGetActivationFactory(HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotificationManager).Get(), IID_PPV_ARGS(&mgr)))) return false;
  return SUCCEEDED(mgr->CreateToastNotifierWithId(hstr(st.aumid).Get(), &st.notifier)) && st.notifier;
}

/** Notifications for Sara are switched off in Windows' settings (or by policy). */
inline bool blockedBySettings() {
  State& st = state();
  WUN::NotificationSetting setting = WUN::NotificationSetting_Enabled;
  return st.notifier && SUCCEEDED(st.notifier->get_Setting(&setting)) && setting != WUN::NotificationSetting_Enabled;
}

/** Shows a toast from its XML. A toast with the same tag and group replaces the earlier one. */
inline bool show(const std::wstring& toastXml, const std::wstring& tag, const std::wstring& group) {
  State& st = state();
  if (!st.notifier || blockedBySettings()) return false;
  ComPtr<IInspectable> inst;
  if (FAILED(RoActivateInstance(HStringReference(RuntimeClass_Windows_Data_Xml_Dom_XmlDocument).Get(), &inst))) return false;
  ComPtr<WDX::IXmlDocumentIO> io;
  ComPtr<WDX::IXmlDocument> doc;
  if (FAILED(inst.As(&io)) || FAILED(inst.As(&doc)) || FAILED(io->LoadXml(hstr(toastXml).Get()))) return false;
  ComPtr<WUN::IToastNotificationFactory> factory;
  ComPtr<WUN::IToastNotification> toast;
  if (FAILED(RoGetActivationFactory(HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotification).Get(), IID_PPV_ARGS(&factory))) ||
      FAILED(factory->CreateToastNotification(doc.Get(), &toast)))
    return false;
  ComPtr<WUN::IToastNotification2> t2;
  if (!tag.empty() && SUCCEEDED(toast.As(&t2))) {
    const std::wstring t = tag.substr(0, 64), g = group.substr(0, 64);
    t2->put_Tag(hstr(t).Get());
    if (!g.empty()) t2->put_Group(hstr(g).Get());
  }
  return SUCCEEDED(st.notifier->Show(toast.Get()));
}

/** Takes a toast away (from the screen and the notification centre), e.g. an approval decided elsewhere. */
inline void remove(const std::wstring& tag, const std::wstring& group) {
  State& st = state();
  if (st.aumid.empty() || tag.empty()) return;
  ComPtr<WUN::IToastNotificationManagerStatics2> mgr;
  ComPtr<WUN::IToastNotificationHistory> history;
  if (FAILED(RoGetActivationFactory(HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotificationManager).Get(), IID_PPV_ARGS(&mgr))) || FAILED(mgr->get_History(&history))) return;
  const std::wstring t = tag.substr(0, 64), g = group.substr(0, 64);
  history->RemoveGroupedTagWithId(hstr(t).Get(), hstr(g).Get(), hstr(st.aumid).Get());
}

/** COM calls this for a click on one of our toasts (the body or a button), in this process. */
class Activator : public RuntimeClass<RuntimeClassFlags<ClassicCom>, INotificationActivationCallback> {
 public:
  HRESULT STDMETHODCALLTYPE Activate(LPCWSTR appUserModelId, LPCWSTR invokedArgs, const NOTIFICATION_USER_INPUT_DATA*, ULONG) override {
    State& st = state();
    if (st.onActivate) st.onActivate(appUserModelId ? appUserModelId : L"", invokedArgs ? invokedArgs : L"");
    return S_OK;
  }
};
class ActivatorFactory : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IClassFactory> {
 public:
  HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID riid, void** out) override {
    if (!out) return E_POINTER;
    *out = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;
    ComPtr<Activator> a = Make<Activator>();
    return a ? a.CopyTo(riid, out) : E_OUTOFMEMORY;
  }
  HRESULT STDMETHODCALLTYPE LockServer(BOOL) override { return S_OK; }
};

/** Takes clicks on our toasts in this process from now on (and when COM started us for one). */
inline bool registerActivator(const CLSID& clsid) {
  State& st = state();
  if (st.cookie) return true;
  ComPtr<ActivatorFactory> f = Make<ActivatorFactory>();
  return f && SUCCEEDED(CoRegisterClassObject(clsid, f.Get(), CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE, &st.cookie));
}
inline void unregisterActivator() {
  State& st = state();
  if (st.cookie) CoRevokeClassObject(st.cookie);
  st.cookie = 0;
}

inline void setString(HKEY root, const std::wstring& key, const wchar_t* name, const std::wstring& value) {
  HKEY k;
  if (RegCreateKeyExW(root, key.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &k, nullptr) != ERROR_SUCCESS) return;
  RegSetValueExW(k, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(value.c_str()), static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
  RegCloseKey(k);
}

/** HKCU: the AUMID's name and icon, and the activator that starts this exe for a click. */
inline void registerApp(const std::wstring& aumid, const std::wstring& clsidText, const std::wstring& displayName, const std::wstring& iconPng, const std::wstring& exe) {
  std::wstring app = L"Software\\Classes\\AppUserModelId\\" + aumid;
  setString(HKEY_CURRENT_USER, app, L"DisplayName", displayName);
  if (!iconPng.empty()) setString(HKEY_CURRENT_USER, app, L"IconUri", iconPng);
  setString(HKEY_CURRENT_USER, app, L"CustomActivator", clsidText);
  setString(HKEY_CURRENT_USER, L"Software\\Classes\\CLSID\\" + clsidText, nullptr, displayName + L" notifications");
  setString(HKEY_CURRENT_USER, L"Software\\Classes\\CLSID\\" + clsidText + L"\\LocalServer32", nullptr, L"\"" + exe + L"\" -ToastActivated");
}
/** The app's own uninstall: the same keys gone, and its toasts. */
inline void unregisterApp(const std::wstring& aumid, const std::wstring& clsidText) {
  ComPtr<WUN::IToastNotificationManagerStatics2> mgr;
  ComPtr<WUN::IToastNotificationHistory> history;
  if (SUCCEEDED(RoGetActivationFactory(HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotificationManager).Get(), IID_PPV_ARGS(&mgr))) && SUCCEEDED(mgr->get_History(&history)))
    history->ClearWithId(hstr(aumid).Get());
  RegDeleteTreeW(HKEY_CURRENT_USER, (L"Software\\Classes\\AppUserModelId\\" + aumid).c_str());
  RegDeleteTreeW(HKEY_CURRENT_USER, (L"Software\\Classes\\CLSID\\" + clsidText).c_str());
}
}  // namespace saratoast

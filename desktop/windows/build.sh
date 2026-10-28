#!/usr/bin/env bash
# Builds Sara.exe (the desktop app) and SaraService.exe (runs her server; Phase 46c), Windows x64. Needs Visual Studio Build Tools (C++) and CMake.
# Downloads the Microsoft Edge WebView2 SDK once (pinned version, checked by SHA-256).
set -euo pipefail
cd "$(dirname "$0")"
VER=1.0.4314.35
SHA=90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4
if [ ! -f third_party/webview2/build/native/include/WebView2.h ]; then
  mkdir -p third_party
  curl -sL -o third_party/webview2.nupkg "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$VER/microsoft.web.webview2.$VER.nupkg"
  echo "$SHA *third_party/webview2.nupkg" | sha256sum -c -
  rm -rf third_party/webview2 && mkdir -p third_party/webview2
  (cd third_party/webview2 && unzip -q ../webview2.nupkg)
fi
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 >/dev/null
cmake --build build --config Release -- -nologo -verbosity:minimal
ls -la build/Release/Sara.exe build/Release/SaraService.exe

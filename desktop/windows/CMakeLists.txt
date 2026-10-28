cmake_minimum_required(VERSION 3.20)
project(SaraDesktop CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(WV2 "${CMAKE_SOURCE_DIR}/third_party/webview2/build/native")
add_executable(Sara WIN32 src/main.cpp src/sara.rc)
target_include_directories(Sara PRIVATE "${WV2}/include" src)
target_link_libraries(Sara PRIVATE "${WV2}/x64/WebView2LoaderStatic.lib" shlwapi shell32 ole32 version advapi32 user32)
target_compile_definitions(Sara PRIVATE UNICODE _UNICODE)
target_compile_options(Sara PRIVATE /W4 /permissive- /utf-8)
# Our own manifest (DPI awareness, common controls) is in sara.rc.
target_link_options(Sara PRIVATE /MANIFEST:NO)

# Phase 46c: the Windows service host for Sara's server (installed together with Sara.exe).
add_executable(SaraService WIN32 src/service.cpp src/service.rc)
target_include_directories(SaraService PRIVATE src)
target_link_libraries(SaraService PRIVATE advapi32 shell32 ws2_32 iphlpapi user32)
target_compile_definitions(SaraService PRIVATE UNICODE _UNICODE)
target_compile_options(SaraService PRIVATE /W4 /permissive- /utf-8)

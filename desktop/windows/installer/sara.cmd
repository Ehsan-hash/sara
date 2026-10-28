@echo off
rem Sara's admin command on Windows (Phase 46c): sara help
rem Runs her own Node with server\src\sara-windows.ts; the installer puts this folder on the PATH.
setlocal
set "SARA_APP=%~dp0.."
"%SARA_APP%\node\node.exe" --disable-warning=ExperimentalWarning "%SARA_APP%\server\src\sara-windows.ts" %*
exit /b %ERRORLEVEL%

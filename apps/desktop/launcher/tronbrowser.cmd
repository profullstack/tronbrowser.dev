@echo off
setlocal enabledelayedexpansion
rem TronBrowser launcher (Windows). Runs a Chromium-family browser with
rem TronBrowser privacy flags + the AI sidebar extension. `tron <url>` passes
rem URLs through. Mirrors apps/desktop/launcher/tronbrowser (POSIX).
set "DIR=%~dp0"
set "EXT=%DIR%extensions\ai-sidebar"
set "DATA=%USERPROFILE%\.tronbrowser"

set "BROWSER="
for %%B in (chrome.exe msedge.exe brave.exe) do (
  if not defined BROWSER (
    for /f "delims=" %%P in ('where %%B 2^>nul') do if not defined BROWSER set "BROWSER=%%P"
  )
)
if not defined BROWSER (
  echo TronBrowser: no Chromium-family browser found. Install Chrome, Edge, or Brave.
  exit /b 1
)

"%BROWSER%" --user-data-dir="%DATA%" --no-default-browser-check --no-pings ^
  --disable-background-networking --disable-breakpad --disable-domain-reliability ^
  --disable-sync --load-extension="%EXT%" %*

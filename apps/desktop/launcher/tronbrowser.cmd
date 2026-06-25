@echo off
setlocal enabledelayedexpansion
rem TronBrowser launcher (Windows). Runs Ungoogled Chromium ONLY (never Chrome,
rem Edge, Brave, or regular Chromium) with TronBrowser privacy flags + bundled
rem extensions (AI sidebar + uBlock Origin). `tron <url>` passes URLs through.
rem Mirrors apps/desktop/launcher/tronbrowser (POSIX). Override the binary with
rem set "TRONBROWSER_BROWSER=C:\path\to\ungoogled-chromium\chrome.exe".
set "DIR=%~dp0"
set "DATA=%USERPROFILE%\.tronbrowser"

rem Load every bundled extension (each subdir with a manifest.json).
set "EXT="
for /d %%D in ("%DIR%extensions\*") do (
  if exist "%%D\manifest.json" (
    if defined EXT (set "EXT=!EXT!,%%D") else (set "EXT=%%D")
  )
)

rem Ungoogled Chromium ONLY. No fallback to Chrome/Edge/Brave/plain Chromium.
set "BROWSER="
if defined TRONBROWSER_BROWSER set "BROWSER=%TRONBROWSER_BROWSER%"
if not defined BROWSER (
  for %%P in (
    "%USERPROFILE%\scoop\apps\ungoogled-chromium\current\chrome.exe"
    "%ProgramFiles%\ungoogled-chromium\chrome.exe"
    "%ProgramFiles(x86)%\ungoogled-chromium\chrome.exe"
    "%LOCALAPPDATA%\ungoogled-chromium\chrome.exe"
  ) do (
    if not defined BROWSER if exist "%%~P" set "BROWSER=%%~P"
  )
)
if not defined BROWSER (
  echo TronBrowser runs Ungoogled Chromium ONLY - never Chrome/Edge/Brave/regular Chromium.
  echo Install Ungoogled Chromium:
  echo   scoop install ungoogled-chromium
  echo   - or -  choco install ungoogled-chromium
  echo   - or -  https://github.com/ungoogled-software/ungoogled-chromium-windows/releases
  echo Advanced override: set "TRONBROWSER_BROWSER=C:\path\to\chrome.exe"
  exit /b 1
)

"%BROWSER%" --user-data-dir="%DATA%" --no-first-run --no-default-browser-check --no-pings ^
  --disable-background-networking --disable-breakpad --disable-domain-reliability ^
  --disable-sync --disable-features=Translate,OptimizationHints,InterestFeedContentSuggestions ^
  --log-level=2 --load-extension="%EXT%" %*

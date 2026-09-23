@echo off
setlocal DisableDelayedExpansion
rem TronBrowser launcher (Windows). Runs Ungoogled Chromium ONLY (never Chrome,
rem Edge, Brave, or regular Chromium) with TronBrowser privacy flags + bundled
rem extensions (AI sidebar + MarkSyncr). `tron <url>` passes URLs through.
rem Mirrors apps/desktop/launcher/tronbrowser (POSIX). Override the binary with
rem set "TRONBROWSER_BROWSER=C:\path\to\ungoogled-chromium\chrome.exe".
set "DIR=%~dp0"
set "DATA=%USERPROFILE%\.tronbrowser"
if defined TRONBROWSER_DATA set "DATA=%TRONBROWSER_DATA%"

rem Validate the interpreter: Windows may have a Store alias named python.exe.
set "PYTHON="
set "PYTHON_ARGS="
if exist "%DIR%python\python.exe" (
  "%DIR%python\python.exe" -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
  if not errorlevel 1 set "PYTHON=%DIR%python\python.exe"
)
if not defined PYTHON (
  py -3 -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
  if not errorlevel 1 (
    set "PYTHON=py"
    set "PYTHON_ARGS=-3"
  )
)
if not defined PYTHON (
  for /f "delims=" %%P in ('where python.exe 2^>nul') do (
    if not defined PYTHON if /i not "%%P"=="%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe" (
      "%%P" -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
      if not errorlevel 1 set "PYTHON=%%P"
    )
  )
)
if /i "%~1"=="--setup-pit-https" goto setup_https

rem Load every bundled extension (each subdir with a manifest.json).
set "EXT="
for /d %%D in ("%DIR%extensions\*") do (
  if exist "%%D\manifest.json" (
    rem Enable delayed expansion only after capturing paths (which may contain !).
    set "NEXT_EXT=%%D"
    setlocal EnableDelayedExpansion
    if defined EXT (set "NEXT_EXT=!EXT!,!NEXT_EXT!")
    for /f "delims=" %%E in ("!NEXT_EXT!") do (
      endlocal
      set "EXT=%%E"
    )
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

rem Start only the loopback helper, not Tor, Pit, or certificate installation.
if not defined PYTHON (
  echo TronBrowser: Pit needs Python 3.9+ from python.org, then restart TronBrowser. >&2
) else if not exist "%DIR%tron-windows.py" (
  echo TronBrowser: incomplete Windows package; reinstall the complete ZIP. >&2
) else (
  "%PYTHON%" %PYTHON_ARGS% "%DIR%tron-windows.py" start
  if errorlevel 1 echo TronBrowser: network helper unavailable; ordinary browsing still works. >&2
)

rem --enable-features=EnableTabMuting makes the tab audio indicator a clickable
rem mute/unmute control (media::kEnableTabMuting is DISABLED_BY_DEFAULT upstream;
rem stock Chrome only enables it via Finch, which an ungoogled build never gets).
"%BROWSER%" --user-data-dir="%DATA%" --no-first-run --no-default-browser-check --no-pings ^
  --disable-background-networking --disable-breakpad --disable-domain-reliability ^
  --disable-sync --disable-features=Translate,OptimizationHints,InterestFeedContentSuggestions ^
  --enable-features=EnableTabMuting ^
  --log-level=2 --load-extension="%EXT%" %*
exit /b %errorlevel%

:setup_https
if not defined PYTHON (
  echo TronBrowser: install Python 3.9+ from python.org before setting up Pit HTTPS. >&2
  exit /b 1
)
"%PYTHON%" %PYTHON_ARGS% "%DIR%tron-windows.py" setup-https
exit /b %errorlevel%

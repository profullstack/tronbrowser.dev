#!/bin/sh
# TronBrowser installer.
#   curl -fsSL https://tronbrowser.dev/install.sh | sh
#
# After install, manage TronBrowser with the `tron` CLI:
#   tron            launch the browser
#   tron upgrade    update to the latest release
#   tron remove     uninstall (keeps your profile data)
#   tron version    print the installed version
#
# This installer also accepts: install (default) | upgrade | remove | version | help
# Env: TRONBROWSER_PREFIX (default $HOME/.local), TRONBROWSER_REPO
set -eu

REPO="${TRONBROWSER_REPO:-profullstack/tronbrowser.dev}"
PREFIX="${TRONBROWSER_PREFIX:-$HOME/.local}"
APP_DIR="$PREFIX/lib/tronbrowser"
CURRENT="$APP_DIR/current"          # stable symlink -> the browser binary
TRON_CLI="$PREFIX/bin/tron"         # the user-facing CLI
ALIAS_CLI="$PREFIX/bin/tronbrowser" # alias -> tron
VERSION_FILE="$APP_DIR/VERSION"
INSTALL_URL="https://tronbrowser.dev/install.sh"

say()  { printf '%s\n' "$*"; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || err "missing required tool: $1"; }

detect_asset() {
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os" in
    Linux)
      # The launcher is a shell script (arch-independent) — it runs the device's
      # own Chromium. So x86_64 desktops AND arm64 Linux phones (Librem 5,
      # PinePhone, Ubuntu Touch / PureOS / Mobian) use the same package.
      case "$arch" in
        x86_64|amd64|aarch64|arm64|armv7l|armhf) echo "tronbrowser-linux-x64.tar.gz" ;;
        *) err "unsupported Linux arch: $arch" ;;
      esac ;;
    Darwin) echo "tronbrowser-macos.zip" ;;
    *) err "unsupported OS: $os. On Windows use the .zip from the releases page." ;;
  esac
}

fetch() { # url dest
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else err "need curl or wget"; fi
}

latest_tag() {
  fetch "https://api.github.com/repos/$REPO/releases/latest" /tmp/tb_rel.json
  sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' /tmp/tb_rel.json | head -n1
}

# Writes the `tron` management CLI to $PREFIX/bin/tron.
write_cli() {
  mkdir -p "$PREFIX/bin"
  cat > "$TRON_CLI" <<'TRON'
#!/bin/sh
# tron — TronBrowser CLI
set -eu
PREFIX="${TRONBROWSER_PREFIX:-$HOME/.local}"
APP_DIR="$PREFIX/lib/tronbrowser"
CURRENT="$APP_DIR/current"
VERSION_FILE="$APP_DIR/VERSION"
AUTO_UPGRADE_STAMP="$APP_DIR/.last-auto-upgrade-check"
INSTALL_URL="https://tronbrowser.dev/install.sh"

usage() {
  cat <<USAGE
tron — TronBrowser CLI

Usage:
  tron <url> [url...]   Open URL(s) in TronBrowser (agent-friendly)
  tron open <url>       Open a URL (in the managed session if one is running)
  tron                  Launch TronBrowser
  tron restart          Force-quit and relaunch (loads the latest extension)
  tron --tor [url]      Launch a dedicated Tor session (separate wiped profile)
  tron tor              Start a standalone Tor daemon for the in-browser toggle
  tron browser launch   Start a managed automation session (CDP, loopback-only)
  tron browser status   Show managed-session status (--json for machine output)
  tron browser tabs     List tabs in the managed session (--json)
  tron browser close    Close the managed session
  tron snapshot         Structured, ref-tagged page snapshot (--json)
  tron click <ref>      Click a snapshot ref, e.g. @e3
  tron fill <ref> <val> Fill an input by ref, e.g. tron fill @e4 "hi@x.com"
  tron extract <mode>   Extract text|links|forms|tables|main (JSON)
  tron screenshot <p>   Save a PNG of the current page (--full-page)
  tron headless <url>   One-shot: --snapshot | --screenshot <p> | --extract <mode>
  tron run <script>     Run a JS/TS script using @tronbrowser/sdk (--headless/--trace)
  tron analyze [goal]   Analyze/fill a form or page (--data, --execute, --json)
  tron mcp              Run a local MCP server over stdio (--headless)
  tron trace start|stop Record commands into a .trontrace bundle
  tron replay <bundle>  Replay a recorded trace against the session
  tron upgrade          Update to the latest release
  tron remove           Uninstall TronBrowser (keeps your profile data)
  tron version          Print the installed version
  tron help             Show this help

Tor routing hides your IP and reaches .onion — it is NOT Tor-Browser-grade
anonymity. If your safety depends on it, use the real Tor Browser.

Set TRONBROWSER_AUTO_UPGRADE=0 to skip the once-daily background upgrade check.
USAGE
}

maybe_auto_upgrade() {
  case "${TRONBROWSER_AUTO_UPGRADE:-1}" in
    0|false|False|FALSE|no|No|NO) return 0 ;;
  esac
  command -v curl >/dev/null 2>&1 || return 0
  [ -d "$APP_DIR" ] || return 0

  now="$(date +%s 2>/dev/null || echo 0)"
  last="$(cat "$AUTO_UPGRADE_STAMP" 2>/dev/null || echo 0)"
  case "$now:$last" in
    0:*) return 0 ;;
  esac
  case "$last" in
    ''|*[!0-9]*) last=0 ;;
  esac
  [ "$((now - last))" -lt 86400 ] && return 0

  printf '%s\n' "$now" > "$AUTO_UPGRADE_STAMP" 2>/dev/null || return 0
  (
    TRONBROWSER_AUTO_UPGRADE=0 sh -c "curl -fsSL '$INSTALL_URL' | sh -s -- upgrade"
  ) >/dev/null 2>&1 &
}

launch() {
  [ -x "$CURRENT" ] || { echo "TronBrowser is not installed. Run: curl -fsSL $INSTALL_URL | sh" >&2; exit 1; }
  maybe_auto_upgrade
  exec "$CURRENT" "$@"
}

# Path to the managed-session engine, which lives next to the versioned shim.
session_bin() {
  _ld="$(dirname "$(readlink -f "$CURRENT" 2>/dev/null || echo "$CURRENT")")"
  echo "$_ld/tron-session"
}

# Node automation runtime entry for `tron snapshot|click|fill|type` (M3.2).
automate_entry() {
  _ld="$(dirname "$(readlink -f "$CURRENT" 2>/dev/null || echo "$CURRENT")")"
  echo "$_ld/automate/automate-bin.js"
}

# Route a CDP automation subcommand to the Node runtime, or explain what's missing.
# TRON_SESSION_BIN lets `tron headless` launch/close its own one-shot session.
run_automation() {
  ENTRY="$(automate_entry)"
  command -v node >/dev/null 2>&1 || { echo "tron $1 needs Node.js (>=22) on PATH." >&2; exit 1; }
  [ -f "$ENTRY" ] || { echo "This TronBrowser build lacks the automation runtime. Run: tron upgrade" >&2; exit 1; }
  exec env TRON_SESSION_BIN="$(session_bin)" node "$ENTRY" "$@"
}

case "${1:-}" in
  open)
    shift
    [ "$#" -gt 0 ] || { echo "usage: tron open <url>" >&2; exit 2; }
    # Prefer a running managed session (open URL as a tab there); otherwise fall
    # back to the classic behavior of opening the URL in a normal window.
    SESSION="$(session_bin)"
    if [ -x "$SESSION" ]; then
      _rc=0
      "$SESSION" open "$@" || _rc=$?
      [ "$_rc" = 0 ] && exit 0
      [ "$_rc" = 3 ] || exit "$_rc"   # 3 = no managed session → legacy launch
    fi
    launch "$@" ;;
  browser)
    # Managed automation sessions (launch/status/tabs/use/current/close).
    shift
    SESSION="$(session_bin)"
    [ -x "$SESSION" ] || { echo "This TronBrowser build has no managed-session support (missing tron-session). Run: tron upgrade" >&2; exit 1; }
    exec "$SESSION" browser "$@" ;;
  snapshot|click|fill|type|extract|screenshot|pdf|trace|replay)
    # CDP automation on the managed session's current page (PRD M3.2/M3.3/M3.7).
    run_automation "$@" ;;
  analyze)
    # AI-assisted unknown-interface analysis / form fill (PRD M3.5). Runs via
    # tron-node.mjs so agent-runtime's @tronbrowser/* imports resolve.
    _ld="$(dirname "$(readlink -f "$CURRENT" 2>/dev/null || echo "$CURRENT")")"
    ENTRY="$_ld/analyze/analyze-bin.js"
    command -v node >/dev/null 2>&1 || { echo "tron analyze needs Node.js (>=22) on PATH." >&2; exit 1; }
    [ -f "$ENTRY" ] || { echo "This TronBrowser build lacks the analyze runtime. Run: tron upgrade" >&2; exit 1; }
    exec node "$_ld/tron-node.mjs" "$ENTRY" "$@" ;;
  headless)
    # One-shot: launch a headless ephemeral session, navigate, act, tear down.
    run_automation "$@" ;;
  mcp)
    # Local Model Context Protocol server over stdio (PRD M3.6).
    shift
    _ld="$(dirname "$(readlink -f "$CURRENT" 2>/dev/null || echo "$CURRENT")")"
    ENTRY="$_ld/sdk/mcp-bin.js"
    command -v node >/dev/null 2>&1 || { echo "tron mcp needs Node.js (>=22) on PATH." >&2; exit 1; }
    [ -f "$ENTRY" ] || { echo "This TronBrowser build lacks the MCP server. Run: tron upgrade" >&2; exit 1; }
    exec env TRON_SESSION_BIN="$(session_bin)" node "$_ld/tron-node.mjs" "$ENTRY" "$@" ;;
  run)
    # Execute a JS/TS automation script that imports @tronbrowser/sdk (PRD M3.4).
    shift
    [ "$#" -gt 0 ] || { echo "usage: tron run <script.js|.ts> [--headless] [--profile <name>] [--trace <dir>]" >&2; exit 2; }
    _ld="$(dirname "$(readlink -f "$CURRENT" 2>/dev/null || echo "$CURRENT")")"
    RUNNER="$_ld/tron-run.mjs"
    command -v node >/dev/null 2>&1 || { echo "tron run needs Node.js (>=24) on PATH." >&2; exit 1; }
    [ -f "$RUNNER" ] || { echo "This TronBrowser build lacks the SDK runtime. Run: tron upgrade" >&2; exit 1; }
    exec env TRON_SESSION_BIN="$(session_bin)" node "$RUNNER" "$@" ;;
  restart)
    # Force-quit any running TronBrowser, then launch fresh. Chromium forwards a
    # new launch to an already-running instance (which keeps the OLD extension
    # loaded), so a hard restart is the only way a new extension actually loads.
    pkill -9 -f 'class=TronBrowser' 2>/dev/null || true
    pkill -9 -f 'user-data-dir=.*tronbrowser' 2>/dev/null || true
    sleep 1
    launch ;;
  tor)
    # Start a standalone Tor daemon (no browser) on 127.0.0.1:9071 for the
    # in-browser Tor toggle in the AI sidebar. Ctrl-C to stop. Auto-installs Tor
    # (any platform) if missing. (The `--tor` flag, handled by the launcher,
    # instead opens a dedicated Tor session.)
    resolve_tor() {
      ldir="$(dirname "$(readlink -f "$CURRENT" 2>/dev/null || echo "$CURRENT")")"
      if   [ -x "$ldir/tor-bin/tor" ];     then echo "$ldir/tor-bin/tor"
      elif [ -x "$APP_DIR/tor-bin/tor" ];  then echo "$APP_DIR/tor-bin/tor"
      else command -v tor 2>/dev/null || true; fi
    }
    TORBIN="$(resolve_tor)"
    if [ -z "$TORBIN" ]; then
      echo "Tor isn't installed — setting it up…"
      sh -c "curl -fsSL '$INSTALL_URL' | sh -s -- ensure-tor" || true
      TORBIN="$(resolve_tor)"
    fi
    [ -n "$TORBIN" ] || { echo "Could not install Tor automatically. Install 'tor' manually (e.g. 'sudo apt install tor' / 'brew install tor'), then run: tron tor" >&2; exit 1; }
    # The auto-installed Tor Expert Bundle ships its libs next to the binary with
    # no $ORIGIN rpath, so point the library path at its dir.
    case "$TORBIN" in
      "$APP_DIR"/*)
        _tordir="$(dirname "$TORBIN")"
        LD_LIBRARY_PATH="$_tordir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        DYLD_LIBRARY_PATH="$_tordir${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
        export LD_LIBRARY_PATH DYLD_LIBRARY_PATH ;;
    esac
    TOR_DATA="${TRONBROWSER_DATA:-$HOME/.tronbrowser}/tor"
    mkdir -p "$TOR_DATA"
    echo "Starting Tor on 127.0.0.1:9071 (Ctrl-C to stop). Now flip the 🧅 Tor toggle in the TronBrowser AI sidebar."
    exec "$TORBIN" --SocksPort 127.0.0.1:9071 --DataDirectory "$TOR_DATA" ;;
  upgrade|update)
    exec sh -c "curl -fsSL '$INSTALL_URL' | sh -s -- upgrade" ;;
  remove|uninstall)
    rm -rf "$APP_DIR"
    rm -f "$PREFIX/bin/tron" "$PREFIX/bin/tronbrowser" "$PREFIX/share/applications/tronbrowser.desktop"
    echo "Removed TronBrowser. (Profile data kept; delete ~/.tronbrowser and ~/TronBrowser to wipe it.)" ;;
  version|--version|-v)
    cat "$VERSION_FILE" 2>/dev/null || echo "not installed" ;;
  help|--help|-h)
    usage ;;
  *)
    # Bare `tron` launches; `tron <url> [url...]` opens URLs (passthrough).
    launch "$@" ;;
esac
TRON
  chmod +x "$TRON_CLI"
  ln -sf "$TRON_CLI" "$ALIAS_CLI"
}

# (macOS, no Homebrew) Download the OFFICIAL notarized Ungoogled Chromium build
# straight from the ungoogled-chromium-macos releases and drop it in
# ~/Applications — no brew, no sudo, nothing manual for the user. Writes a trust
# marker the launcher reads, so it runs this KNOWN-ungoogled build without the
# brew-cask proof it otherwise requires. Best-effort. $1 = launcher dir (marker).
download_ungoogled_macos() { # launcher_dir
  ldir="$1"
  case "$(uname -m)" in
    arm64|aarch64) uc_arch="arm64" ;;
    x86_64|amd64)  uc_arch="x86-64" ;;
    *) return 1 ;;
  esac
  ucrepo="ungoogled-software/ungoogled-chromium-macos"
  fetch "https://api.github.com/repos/$ucrepo/releases/latest" /tmp/tb_uc.json || return 1
  # Pick the .dmg asset for our arch (assets look like *_arm64-macos.dmg).
  url="$(sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*'"$uc_arch"'-macos\.dmg\)".*/\1/p' /tmp/tb_uc.json | head -n1)"
  [ -n "$url" ] || return 1

  tmp="$(mktemp -d)"; mnt="$tmp/mnt"; mkdir -p "$mnt"
  info "Downloading Ungoogled Chromium ($uc_arch) — no Homebrew needed…"
  fetch "$url" "$tmp/uc.dmg" || { rm -rf "$tmp"; return 1; }
  hdiutil attach -nobrowse -quiet "$tmp/uc.dmg" -mountpoint "$mnt" 2>/dev/null || { rm -rf "$tmp"; return 1; }

  srcapp="$(find "$mnt" -maxdepth 1 -name '*.app' 2>/dev/null | head -n1)"
  dest="$HOME/Applications/Ungoogled Chromium.app"
  ok=0
  if [ -n "$srcapp" ]; then
    mkdir -p "$HOME/Applications"; rm -rf "$dest"
    cp -R "$srcapp" "$dest" 2>/dev/null && [ -d "$dest" ] && ok=1
  fi
  hdiutil detach -quiet "$mnt" 2>/dev/null || true
  rm -rf "$tmp"
  [ "$ok" = "1" ] || return 1

  # Notarized, but clear the quarantine bit so it opens without a Gatekeeper nag.
  xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
  # Trust marker: tells the launcher THIS app is a verified ungoogled build.
  [ -n "$ldir" ] && printf '%s\n' "$dest" > "$ldir/.ungoogled-macos" 2>/dev/null || true
  info "Installed Ungoogled Chromium to $dest"
  return 0
}

# TronBrowser runs Ungoogled Chromium ONLY (never regular Chrome/Chromium), so
# we install it as part of setup. Skip with TB_NO_BROWSER_INSTALL=1.
ensure_browser() {
  [ "${TB_NO_BROWSER_INSTALL:-0}" = "1" ] && return 0

  if [ "$(uname -s)" = "Darwin" ]; then
    # Where our launcher lives (holds the trust marker for the no-brew path).
    _ldir="$(find "$APP_DIR" -maxdepth 3 -type f -name tronbrowser 2>/dev/null | head -n1)"
    _ldir="${_ldir:+$(dirname "$_ldir")}"

    # Already have a build WE installed & verified (marker points at a live app)?
    if [ -n "$_ldir" ] && [ -f "$_ldir/.ungoogled-macos" ]; then
      _m="$(cat "$_ldir/.ungoogled-macos" 2>/dev/null)"
      [ -n "$_m" ] && [ -d "$_m" ] && return 0
    fi

    # The launcher needs the Chromium.app actually on disk AND proof it's the
    # ungoogled build (the Homebrew cask, or our own marker). `brew list --cask`
    # alone LIES — it reports the cask "installed" even after the .app was deleted
    # out from under brew — so we also require the .app at a path the launcher checks.
    app=""
    for a in \
      "/Applications/Ungoogled Chromium.app" \
      "/Applications/Chromium.app" \
      "$HOME/Applications/Ungoogled Chromium.app" \
      "$HOME/Applications/Chromium.app"; do
      [ -d "$a" ] && { app="$a"; break; }
    done

    # Homebrew usually ISN'T on PATH in the non-login shell that `tron upgrade`
    # spawns (Apple Silicon: /opt/homebrew, Intel: /usr/local), so probe the known
    # locations directly instead of trusting PATH — otherwise we'd never install.
    brew=""
    for b in brew /opt/homebrew/bin/brew /usr/local/bin/brew; do
      command -v "$b" >/dev/null 2>&1 && { brew="$b"; break; }
    done

    if [ -n "$brew" ]; then
      if [ -n "$app" ] && "$brew" list --cask ungoogled-chromium >/dev/null 2>&1; then return 0; fi
      info "Installing Ungoogled Chromium (brew cask)…"
      # --force REPLACES any pre-existing regular Chromium.app rather than erroring,
      # and REINSTALLS when brew's metadata is stale but the .app is gone.
      "$brew" install --cask ungoogled-chromium --force && return 0
      warn "brew cask install failed — falling back to a direct download…"
    fi

    # No Homebrew (or it failed): grab the official notarized build ourselves.
    # No brew, no sudo, nothing for the user to run by hand.
    if download_ungoogled_macos "$_ldir"; then return 0; fi

    warn "Couldn't auto-install Ungoogled Chromium (check your network)."
    return 0
  fi

  # Linux: an ungoogled-chromium binary, else Flatpak Ungoogled Chromium (Flathub).
  for c in ungoogled-chromium ungoogled-chromium-stable; do
    command -v "$c" >/dev/null 2>&1 && return 0
  done
  if command -v flatpak >/dev/null 2>&1; then
    flatpak info io.github.ungoogled_software.ungoogled_chromium >/dev/null 2>&1 && return 0
    info "Installing Ungoogled Chromium via Flatpak…"
    flatpak install -y flathub io.github.ungoogled_software.ungoogled_chromium \
      || warn "Flatpak install failed — run it yourself: flatpak install -y flathub io.github.ungoogled_software.ungoogled_chromium"
  else
    warn "No de-googled browser and no Flatpak found. Install Ungoogled Chromium:"
    say  "    flatpak install -y flathub io.github.ungoogled_software.ungoogled_chromium"
    say  "  (or your distro's 'ungoogled-chromium' package — NOT regular 'chromium')"
  fi
}

# (macOS) Brand the app icon: replace Ungoogled Chromium's icon with ours so the
# dock/Cmd-Tab shows TronBrowser while you browse. Built on-device from the
# bundled PNG via sips+iconutil. Chromium's own auto-update resets it — re-run
# `tron upgrade` to re-apply. Skip with TB_NO_ICON=1. $1 = path to tronbrowser.png
brand_macos_icon() {
  [ "$(uname -s)" = "Darwin" ] || return 0
  [ "${TB_NO_ICON:-0}" = "1" ] && return 0
  command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1 || return 0
  local png="$1"; [ -f "$png" ] || return 0
  local app="/Applications/Chromium.app"; [ -d "$app" ] || app="$HOME/Applications/Chromium.app"
  [ -d "$app" ] || return 0

  local iconfile; iconfile="$(defaults read "$app/Contents/Info" CFBundleIconFile 2>/dev/null || echo app)"
  case "$iconfile" in *.icns) ;; *) iconfile="$iconfile.icns" ;; esac
  [ -f "$app/Contents/Resources/$iconfile" ] || iconfile="app.icns"

  local set icns; set="$(mktemp -d)/icon.iconset"; mkdir -p "$set"; icns="$(mktemp).icns"
  _g() { sips -z "$2" "$2" "$png" --out "$set/$1" >/dev/null 2>&1; }
  _g icon_16x16.png 16;   _g icon_16x16@2x.png 32
  _g icon_32x32.png 32;   _g icon_32x32@2x.png 64
  _g icon_128x128.png 128;_g icon_128x128@2x.png 256
  _g icon_256x256.png 256;_g icon_256x256@2x.png 512
  _g icon_512x512.png 512;_g icon_512x512@2x.png 1024
  if iconutil -c icns "$set" -o "$icns" 2>/dev/null && cp -f "$icns" "$app/Contents/Resources/$iconfile" 2>/dev/null; then
    touch "$app" 2>/dev/null
    killall Dock 2>/dev/null || true
    info "Branded $app with the TronBrowser icon (resets on Chromium update; re-run 'tron upgrade')."
  else
    warn "Couldn't write the app icon (permissions?). The browser still works."
  fi
}

# Stop any running TronBrowser before we replace its files. A window left open
# across an upgrade keeps handles on the old app dir and throws ERR_FILE_NOT_FOUND
# until it's restarted. We match TronBrowser's UNIQUE launch signature
# (--class=TronBrowser, set by the launcher on every platform) so the user's other
# Chromium/Chrome windows are never touched. Best-effort; skip with TB_NO_KILL=1.
stop_running() {
  [ "${TB_NO_KILL:-0}" = "1" ] && return 0
  sig='class=TronBrowser'
  if command -v pgrep >/dev/null 2>&1; then
    pids="$(pgrep -f "$sig" 2>/dev/null || true)"
  else
    pids="$(ps ax 2>/dev/null | grep -F "$sig" | grep -v grep | awk '{print $1}')"
  fi
  [ -n "${pids:-}" ] || return 0
  info "Stopping running TronBrowser…"
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  # Wait up to ~5s for a clean exit, then force-kill stragglers.
  n=0
  while [ "$n" -lt 5 ]; do
    alive=0
    for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive=1; done
    [ "$alive" = "0" ] && return 0
    sleep 1; n=$((n + 1))
  done
  for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
}

# curl/wget a URL to stdout (for listing the Tor archive).
fetch_stdout() { # url
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"
  elif command -v wget >/dev/null 2>&1; then wget -qO- "$1"
  else return 1; fi
}

# Download the Tor Project's "expert bundle" (a standalone tor daemon + its libs)
# into $1. No package manager, no sudo, works on any platform. Best-effort.
download_tor_expert_bundle() { # dest_dir
  dst="$1"
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os" in
    Linux)  teb_os=linux ;;
    Darwin) teb_os=macos ;;
    *) return 1 ;;
  esac
  case "$arch" in
    x86_64|amd64)  teb_arch=x86_64 ;;
    aarch64|arm64) teb_arch=aarch64 ;;
    i686|i386)     teb_arch=i686 ;;
    *) return 1 ;;
  esac
  base="https://archive.torproject.org/tor-package-archive/torbrowser"
  ver="${TRONBROWSER_TOR_VERSION:-}"
  if [ -z "$ver" ]; then
    # Highest version directory in the archive listing (e.g. 14.0.1).
    ver="$(fetch_stdout "$base/" 2>/dev/null | sed -n 's/.*href="\([0-9][0-9.]*\)\/".*/\1/p' | sort -V | tail -n1)"
  fi
  [ -n "$ver" ] || return 1
  url="$base/$ver/tor-expert-bundle-${teb_os}-${teb_arch}-${ver}.tar.gz"
  tmp="$(mktemp -d)"
  info "Downloading Tor $ver ($teb_os-$teb_arch)…"
  if fetch "$url" "$tmp/teb.tgz" 2>/dev/null && tar -xzf "$tmp/teb.tgz" -C "$tmp" 2>/dev/null && [ -x "$tmp/tor/tor" ]; then
    mkdir -p "$dst"
    cp -R "$tmp/tor/." "$dst/" 2>/dev/null
    chmod +x "$dst/tor" 2>/dev/null || true
    rm -rf "$tmp"
    [ -x "$dst/tor" ] && return 0
  fi
  rm -rf "$tmp"; return 1
}

# Make a `tor` daemon available for the in-browser 🧅 Tor toggle. We install OUR
# OWN standalone tor (the Tor Expert Bundle) and run it on our OWN port (9071),
# never touching any system tor. We prefer the bundle because the system `tor`
# (/usr/sbin/tor) is AppArmor-confined to /var/lib/tor on Debian/Ubuntu and can't
# be spawned with a custom DataDirectory — it just exits. The package manager is
# only a last-resort fallback. Skip with TB_NO_TOR_INSTALL=1.
ensure_tor() {
  [ "${TB_NO_TOR_INSTALL:-0}" = "1" ] && return 0
  # Install next to the launcher shim so its dir ($DIR/tor-bin) resolves it — the
  # release tarball extracts the shim into a tronbrowser/ subdir.
  tordest="$APP_DIR/tor-bin"
  _ldir="$(find "$APP_DIR" -maxdepth 3 -type f -name tronbrowser 2>/dev/null | head -n1)"
  [ -n "$_ldir" ] && tordest="$(dirname "$_ldir")/tor-bin"
  [ -x "$tordest/tor" ] && return 0   # our own tor already installed

  info "Setting up Tor (for the in-browser Tor toggle)…"
  # Primary: our own standalone tor (no AppArmor, fully under our control).
  if download_tor_expert_bundle "$tordest"; then
    info "Installed Tor to $tordest"
    return 0
  fi
  # Fallback: system package manager (used via the helper's reuse path).
  if command -v tor >/dev/null 2>&1; then return 0; fi
  if command -v brew >/dev/null 2>&1; then
    brew install tor >/dev/null 2>&1 || true
    command -v tor >/dev/null 2>&1 && return 0
  fi
  uid="$(id -u 2>/dev/null || echo 0)"
  SUDO=""
  if [ "$uid" -ne 0 ] && command -v sudo >/dev/null 2>&1 && { [ -t 1 ] || [ -t 2 ]; }; then SUDO="sudo"; fi
  if [ "$uid" -eq 0 ] || [ -n "$SUDO" ]; then
    if   command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -y >/dev/null 2>&1; $SUDO apt-get install -y tor >/dev/null 2>&1 || true
    elif command -v dnf     >/dev/null 2>&1; then $SUDO dnf install -y tor >/dev/null 2>&1 || true
    elif command -v yum     >/dev/null 2>&1; then $SUDO yum install -y tor >/dev/null 2>&1 || true
    elif command -v pacman  >/dev/null 2>&1; then $SUDO pacman -Sy --noconfirm tor >/dev/null 2>&1 || true
    elif command -v zypper  >/dev/null 2>&1; then $SUDO zypper --non-interactive install tor >/dev/null 2>&1 || true
    elif command -v apk     >/dev/null 2>&1; then $SUDO apk add tor >/dev/null 2>&1 || true
    fi
    command -v tor >/dev/null 2>&1 && return 0
  fi
  warn "Couldn't install Tor automatically. The 🧅 Tor toggle needs 'tor' — install it (e.g. 'sudo apt install tor' / 'brew install tor')."
  return 1
}

do_install() {
  need uname
  asset="$(detect_asset)"
  tag="$(latest_tag)"
  [ -n "$tag" ] || err "could not resolve the latest release of $REPO"
  url="https://github.com/$REPO/releases/download/$tag/$asset"

  info "Installing TronBrowser $tag ($asset)"
  tmp="$(mktemp -d)"
  fetch "$url" "$tmp/$asset" || err "download failed: $url"

  stop_running   # don't replace files under a live instance (ERR_FILE_NOT_FOUND)
  rm -rf "$APP_DIR"; mkdir -p "$APP_DIR" "$PREFIX/bin"
  case "$asset" in
    *.tar.gz) tar -xzf "$tmp/$asset" -C "$APP_DIR" ;;
    *.zip)    need unzip; unzip -q "$tmp/$asset" -d "$APP_DIR" ;;
  esac
  rm -rf "$tmp"

  bin="$(find "$APP_DIR" -maxdepth 3 -type f -name 'tronbrowser' 2>/dev/null | head -n1)"
  [ -n "$bin" ] || bin="$(find "$APP_DIR" -maxdepth 3 -type f -name 'TronBrowser' 2>/dev/null | head -n1)"
  [ -n "$bin" ] || err "browser binary not found in archive"
  chmod +x "$bin"
  ln -sf "$bin" "$CURRENT"
  echo "$tag" > "$VERSION_FILE"

  write_cli

  # Desktop app-menu entry (KDE/GNOME) so TronBrowser shows up as an app.
  # Prefer the PNG app icon (KDE renders SVG app icons inconsistently); fall back to SVG.
  icon="$(dirname "$bin")/tronbrowser.png"; [ -f "$icon" ] || icon="$(dirname "$bin")/tronbrowser.svg"
  apps_dir="$PREFIX/share/applications"
  mkdir -p "$apps_dir"
  cat > "$apps_dir/tronbrowser.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=TronBrowser
GenericName=Web Browser
Comment=Privacy-first, AI-native browser (Ungoogled Chromium fork)
Exec=$TRON_CLI %U
Icon=$icon
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=TronBrowser
StartupNotify=true
DESKTOP
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps_dir" 2>/dev/null || true

  ensure_browser
  ensure_tor   # so the in-browser 🧅 Tor toggle works out of the box
  brand_macos_icon "$(dirname "$bin")/tronbrowser.png"

  info "Installed TronBrowser $tag to $APP_DIR"
  say  "    launch:  tron   (or find 'TronBrowser' in your app menu)"
  say  "    manage:  tron upgrade | tron remove | tron version"
  case ":$PATH:" in
    *":$PREFIX/bin:"*) : ;;
    *) warn "$PREFIX/bin is not on PATH — add it so 'tron' is available." ;;
  esac
}

do_upgrade() {
  if [ ! -f "$VERSION_FILE" ]; then
    warn "TronBrowser not installed; installing fresh."
    do_install
    return
  fi
  current="$(cat "$VERSION_FILE")"
  latest="$(latest_tag)"
  [ -n "$latest" ] || err "could not resolve the latest release of $REPO"
  if [ "$current" = "$latest" ] && [ "${TB_FORCE:-0}" != "1" ]; then
    info "TronBrowser is already up to date ($current)."
    ensure_browser   # still make sure Ungoogled Chromium is installed
    ensure_tor       # and that Tor is available for the toggle
    brand_macos_icon "$(find "$APP_DIR" -maxdepth 3 -name tronbrowser.png 2>/dev/null | head -n1)"  # re-apply icon (Chromium updates reset it)
    info "Re-install anyway with: TB_FORCE=1 tron upgrade"
    return
  fi
  info "Updating $current -> $latest"
  do_install
}

do_remove() {
  info "Removing TronBrowser"
  rm -rf "$APP_DIR"
  rm -f "$TRON_CLI" "$ALIAS_CLI" "$PREFIX/share/applications/tronbrowser.desktop"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" 2>/dev/null || true
  say "Removed. (Profile/bookmarks/history kept; delete ~/.tronbrowser and ~/TronBrowser to wipe data.)"
}

do_version() {
  if [ -f "$VERSION_FILE" ]; then cat "$VERSION_FILE"; else say "not installed"; fi
}

usage() {
  cat <<EOF
TronBrowser installer

Usage: curl -fsSL $INSTALL_URL | sh [-s -- <command>]

Commands:
  install    Download and install the latest TronBrowser (default)
  upgrade    Update an existing install to the latest release
  remove     Uninstall TronBrowser (keeps your profile data)
  version    Print the installed version
  help       Show this help

After install, prefer the 'tron' CLI: tron upgrade | tron remove | tron version

Env:
  TRONBROWSER_PREFIX   install prefix (default: \$HOME/.local)
  TRONBROWSER_REPO     GitHub repo (default: $REPO)
EOF
}

cmd="${1:-install}"
case "$cmd" in
  install) do_install ;;
  upgrade|update) do_upgrade ;;
  remove|uninstall) do_remove ;;
  ensure-tor) ensure_tor ;;
  version|--version|-v) do_version ;;
  help|--help|-h) usage ;;
  *) err "unknown command: $cmd (try 'help')" ;;
esac

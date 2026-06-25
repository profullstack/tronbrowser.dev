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
INSTALL_URL="https://tronbrowser.dev/install.sh"

usage() {
  cat <<USAGE
tron — TronBrowser CLI

Usage:
  tron <url> [url...]   Open URL(s) in TronBrowser (agent-friendly)
  tron open <url>       Same as above, explicit
  tron                  Launch TronBrowser
  tron upgrade          Update to the latest release
  tron remove           Uninstall TronBrowser (keeps your profile data)
  tron version          Print the installed version
  tron help             Show this help
USAGE
}

launch() {
  [ -x "$CURRENT" ] || { echo "TronBrowser is not installed. Run: curl -fsSL $INSTALL_URL | sh" >&2; exit 1; }
  exec "$CURRENT" "$@"
}

case "${1:-}" in
  open)
    shift
    [ "$#" -gt 0 ] || { echo "usage: tron open <url>" >&2; exit 2; }
    launch "$@" ;;
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

# TronBrowser is de-googled, so it runs Ungoogled Chromium. Make sure a
# de-googled engine exists; offer to install the Flatpak Ungoogled Chromium.
# Skip with TB_NO_BROWSER_INSTALL=1.
ensure_browser() {
  for c in ungoogled-chromium ungoogled-chromium-stable; do
    command -v "$c" >/dev/null 2>&1 && return 0
  done
  if command -v flatpak >/dev/null 2>&1 && flatpak info io.github.ungoogled_software.ungoogled_chromium >/dev/null 2>&1; then
    return 0
  fi
  if [ "${TB_NO_BROWSER_INSTALL:-0}" = "1" ]; then return 0; fi

  info "TronBrowser is de-googled and runs Ungoogled Chromium."
  if command -v flatpak >/dev/null 2>&1; then
    info "Installing Ungoogled Chromium via Flatpak (skip with TB_NO_BROWSER_INSTALL=1)…"
    flatpak install -y flathub io.github.ungoogled_software.ungoogled_chromium 2>/dev/null \
      || warn "Flatpak install failed — install Ungoogled Chromium manually."
  else
    warn "No de-googled browser found. Install Ungoogled Chromium for the full experience:"
    say  "    flatpak install -y flathub io.github.ungoogled_software.ungoogled_chromium"
    say  "  (regular Chromium/Chrome still phones Google; the snap can't be isolated.)"
  fi
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
  icon="$(dirname "$bin")/tronbrowser.svg"
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
  version|--version|-v) do_version ;;
  help|--help|-h) usage ;;
  *) err "unknown command: $cmd (try 'help')" ;;
esac

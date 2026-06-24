#!/bin/sh
# TronBrowser installer.
#   curl -fsSL https://tronbrowser.dev/install.sh | sh
#   curl -fsSL https://tronbrowser.dev/install.sh | sh -s -- upgrade
#   curl -fsSL https://tronbrowser.dev/install.sh | sh -s -- remove
#
# Commands: install (default) | upgrade | remove | version | help
# Env: TRONBROWSER_PREFIX (default $HOME/.local), TRONBROWSER_REPO
set -eu

REPO="${TRONBROWSER_REPO:-profullstack/tronbrowser.dev}"
PREFIX="${TRONBROWSER_PREFIX:-$HOME/.local}"
APP_DIR="$PREFIX/lib/tronbrowser"
BIN_LINK="$PREFIX/bin/tronbrowser"
VERSION_FILE="$APP_DIR/VERSION"

say()  { printf '%s\n' "$*"; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || err "missing required tool: $1"; }

detect_asset() {
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os" in
    Linux)
      case "$arch" in
        x86_64|amd64) echo "tronbrowser-linux-x64.tar.gz" ;;
        *) err "unsupported Linux arch: $arch (x86_64 only for now)" ;;
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
  ln -sf "$bin" "$BIN_LINK"
  echo "$tag" > "$VERSION_FILE"

  info "Installed to $APP_DIR"
  say  "    binary: $BIN_LINK"
  case ":$PATH:" in
    *":$PREFIX/bin:"*) : ;;
    *) warn "$PREFIX/bin is not on PATH — add it to use 'tronbrowser' directly." ;;
  esac
  say "Run: tronbrowser"
}

do_upgrade() {
  if [ -f "$VERSION_FILE" ]; then info "Current: $(cat "$VERSION_FILE")"; else warn "TronBrowser not installed; installing fresh."; fi
  do_install
}

do_remove() {
  info "Removing TronBrowser"
  rm -rf "$APP_DIR"
  [ -L "$BIN_LINK" ] && rm -f "$BIN_LINK"
  say "Removed. (User profile/bookmarks/history are kept; delete ~/.tronbrowser to wipe data.)"
}

do_version() {
  if [ -f "$VERSION_FILE" ]; then cat "$VERSION_FILE"; else say "not installed"; fi
}

usage() {
  cat <<EOF
TronBrowser installer

Usage: install.sh [command]

Commands:
  install    Download and install the latest TronBrowser (default)
  upgrade    Update an existing install to the latest release
  remove     Uninstall TronBrowser (keeps your profile data)
  version    Print the installed version
  help       Show this help

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

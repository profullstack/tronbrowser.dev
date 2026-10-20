#!/bin/sh
# End to end on Linux and macOS: register w3bs:// the way the launcher does, ask
# the OS to open a W3BS URI (xdg-open / open, the same path a link from another
# app or the address bar takes), and check the engine was handed the w3bs.org
# resolver URL. The engine is a stub that records its argv, and HOME and the XDG
# dirs are scratch, so nothing on the machine running this is touched except,
# on macOS, LaunchServices learning about the scratch applet.
set -eu

REPO="$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)"
W="$(mktemp -d)"
REAL_HOME="$HOME"
export HOME="$W/home"
export XDG_DATA_HOME="$HOME/.local/share" XDG_CONFIG_HOME="$HOME/.config"
mkdir -p "$W/bin" "$XDG_DATA_HOME/applications" "$XDG_CONFIG_HOME"
cp "$REPO/apps/desktop/launcher/tronbrowser" "$REPO/apps/desktop/launcher/tron-w3bs-register" "$W/bin/"
ARGV="$W/argv"
URI='w3bs://prompt/w3bs/research@1'
WANT='https://w3bs.org/browse?q=w3bs%3A%2F%2Fprompt%2Fw3bs%2Fresearch%401'
# LaunchServices will not route a URL to an app in a temporary directory, so on
# macOS the applet goes where real installs put it, under a test-only name.
# Same bundle id as the real one: run this on a disposable machine (CI).
APP="$REAL_HOME/Applications/TronBrowser Links (test).app"

# Named ungoogled-chromium so the launcher's de-googled check stays quiet.
cat > "$W/bin/ungoogled-chromium" <<EOF
#!/bin/sh
if [ "\${1:-}" = "--version" ]; then echo "Chromium 131.0.0.0"; exit 0; fi
for a in "\$@"; do printf '%s\n' "\$a"; done > "$ARGV.tmp" && mv "$ARGV.tmp" "$ARGV"
EOF
# What the OS runs. LaunchServices and xdg-open start it with their own bare
# environment, so the stub engine and scratch profile are set here.
cat > "$W/bin/tron" <<EOF
#!/bin/sh
export HOME="$HOME" TRONBROWSER_BROWSER="$W/bin/ungoogled-chromium" TRONBROWSER_DATA="$W/profile"
export TRONBROWSER_W3BS_HANDLER_TARGET="$W/bin/tron" TRONBROWSER_W3BS_APP="$APP"
exec sh "$W/bin/tronbrowser" "\$@"
EOF
chmod +x "$W/bin/"*

fail() { echo "FAIL: $*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin)
    TRONBROWSER_W3BS_APP="$APP" sh "$W/bin/tron-w3bs-register" "$W/bin/tron"
    PLIST="$APP/Contents/Info.plist"
    [ -f "$PLIST" ] || fail "no handler app at $APP"
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$PLIST")" = w3bs ] \
      || fail "handler app does not declare w3bs"
    codesign --verify "$APP" || fail "handler app signature is broken"
    # LaunchServices learns about the app asynchronously.
    i=0
    until open "$URI" 2>/dev/null; do
      i=$((i + 1))
      if [ "$i" -ge 20 ]; then
        /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -dump \
          | grep -i -B3 -A3 'w3bs\|tronbrowser.links' >&2 || true
        open "$URI" || true
        fail "LaunchServices has no handler for w3bs"
      fi
      sleep 1
    done
    ;;
  *)
    command -v xdg-open >/dev/null 2>&1 || fail "xdg-open is not installed"
    cat > "$XDG_DATA_HOME/applications/tronbrowser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=TronBrowser
Exec=$W/bin/tron %U
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;x-scheme-handler/w3bs;
EOF
    # Someone else's handler is left alone (xdg-mime only reports a default
    # whose desktop entry exists)...
    printf '[Desktop Entry]\nType=Application\nName=Other\nExec=true %%U\nMimeType=x-scheme-handler/w3bs;\n' \
      > "$XDG_DATA_HOME/applications/other.desktop"
    xdg-mime default other.desktop x-scheme-handler/w3bs
    sh "$W/bin/tron-w3bs-register" "$W/bin/tron"
    [ "$(xdg-mime query default x-scheme-handler/w3bs)" = other.desktop ] \
      || fail "replaced another app's w3bs handler"
    # ...and with none set, TronBrowser claims the scheme.
    rm -f "$XDG_CONFIG_HOME/mimeapps.list" "$XDG_DATA_HOME/applications/other.desktop"
    sh "$W/bin/tron-w3bs-register" "$W/bin/tron"
    [ "$(xdg-mime query default x-scheme-handler/w3bs)" = tronbrowser.desktop ] \
      || fail "tronbrowser.desktop is not the w3bs handler"
    # As on a GNOME desktop: xdg-open hands the URI to `gio open`, which looks
    # the handler up in mimeapps.list. Generic mode is not used because
    # xdg-utils 1.1.x (Ubuntu 24.04) misreads any scheme with a digit, like
    # w3bs, as a file path. DISPLAY only has to be set; nothing connects to it.
    command -v gio >/dev/null 2>&1 || fail "gio is not installed"
    DISPLAY="${DISPLAY:-:99}" XDG_CURRENT_DESKTOP=GNOME xdg-open "$URI"
    ;;
esac

i=0
while [ ! -s "$ARGV" ] && [ "$i" -lt 60 ]; do sleep 1; i=$((i + 1)); done
[ -s "$ARGV" ] || fail "the engine was never started for $URI"
grep -qxF "$WANT" "$ARGV" || { cat "$ARGV" >&2; fail "the engine was not handed $WANT"; }
echo "ok: $URI -> $WANT"
if [ -d "$APP" ]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$APP" 2>/dev/null || true
  rm -rf "$APP"
fi
rm -rf "$W"

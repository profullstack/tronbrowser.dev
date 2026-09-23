"""Opt-in, disposable GitHub Windows runner only; never a developer PC.

Exercises the real cmd launcher, extension, registry root install, and browser.
Only the exact root absent before this test may be removed during cleanup.
"""
import http.server
import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time

HERE = Path(__file__).resolve().parent
LAUNCHER = HERE.parent / "launcher"
SPEC = importlib.util.spec_from_file_location("tron_windows", LAUNCHER / "tron-windows.py")
windows = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(windows)


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=120, **kwargs)
    print(result.stdout, flush=True)
    if result.returncode:
        raise RuntimeError("Command failed: %s\n%s" % (args, result.stderr))
    return result


def remove_test_root(cert, fingerprint):
    # Exact SHA-256 pin is checked again before the CurrentUser-only removal.
    command = r'''
$ErrorActionPreference = 'Stop'
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($env:TRON_CA_FILE)
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $hash = ([BitConverter]::ToString($sha.ComputeHash($cert.RawData))).Replace('-', '') }
finally { $sha.Dispose() }
if ($hash -cne $env:TRON_CA_SHA256) { throw 'Cleanup fingerprint mismatch' }
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
try {
  $store.Open('ReadWrite')
  $matches = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $cert.Thumbprint, $false)
  foreach ($match in $matches) {
    if ([Convert]::ToBase64String($match.RawData) -cne [Convert]::ToBase64String($cert.RawData)) { throw 'Cleanup certificate bytes mismatch' }
    $store.Remove($match)
  }
} finally { $store.Close(); $cert.Dispose() }
'''
    env = os.environ.copy()
    env.pop("PSModulePath", None)
    env.update(TRON_CA_FILE=str(cert), TRON_CA_SHA256=fingerprint)
    powershell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    run([str(powershell), "-NoProfile", "-NonInteractive", "-Command", command], env=env)


def command_line(launcher, tail=""):
    return 'cmd.exe /d /s /c ""%s" %s"' % (launcher, tail)


def stop_owned_helper(pidfile, bundle):
    if not pidfile.is_file():
        return
    pid = int(pidfile.read_text())
    if pid <= 0:
        raise RuntimeError("Invalid owned helper PID")
    env = os.environ.copy()
    env.pop("PSModulePath", None)
    env.update(TRON_OWNED_PID=str(pid), TRON_HELPER_SCRIPT=str(bundle / "tron-tor-helper"))
    powershell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    run([str(powershell), "-NoProfile", "-NonInteractive", "-Command", r'''
$ErrorActionPreference = 'Stop'
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$env:TRON_OWNED_PID"
if ($null -eq $p) { exit 0 }
if ($p.Name -notmatch '^python([0-9.]+)?\.exe$' -or $p.CommandLine.IndexOf($env:TRON_HELPER_SCRIPT, [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'Refusing to stop a process outside our unique test bundle' }
& "$env:SystemRoot\System32\taskkill.exe" /PID $p.ProcessId /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Owned helper cleanup failed' }
'''], env=env)


def consent_to_test_root(cmd, env, thumbprint, evidence):
    """Click the native Windows warning ONLY for the already-verified test root.

    This UI automation stays inside the guarded disposable-runner harness.
    Product code still requires both typed consent and Windows' own approval.
    """
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.EnumChildWindows.argtypes = [wintypes.HWND, callback_type, wintypes.LPARAM]
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetDlgItem.restype = wintypes.HWND
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = wintypes.LPARAM
    stop = threading.Event()
    events = []
    clicked = set()
    observed = {}

    def text(hwnd):
        buffer = ctypes.create_unicode_buffer(user32.GetWindowTextLengthW(hwnd) + 1)
        user32.GetWindowTextW(hwnd, buffer, len(buffer))
        return buffer.value

    @callback_type
    def inspect(hwnd, _):
        if "security warning" not in text(hwnd).lower():
            return True
        labels = [text(hwnd)]

        @callback_type
        def child(child_hwnd, _):
            labels.append(text(child_hwnd))
            return True

        user32.EnumChildWindows(hwnd, child, 0)
        combined = " ".join(labels)
        observed[str(hwnd)] = combined
        normalized = re.sub(r"[^0-9A-F]", "", combined.upper())
        if "Moshpit Root CA" in combined and thumbprint.upper() in normalized:
            yes = user32.GetDlgItem(hwnd, 6)  # IDYES, never an arbitrary dialog button.
            if yes and hwnd not in clicked:
                clicked.add(hwnd)
                events.append({"thumbprint": thumbprint, "nativeWarningAccepted": True})
                user32.SendMessageW(yes, 0x00F5, 0, 0)  # BM_CLICK
        return True

    def watch():
        while not stop.wait(0.2):
            user32.EnumWindows(inspect, 0)

    thread = threading.Thread(target=watch, daemon=True)
    thread.start()
    try:
        run(command_line(cmd, "--setup-pit-https"), env=env, input="TRUST\n")
        if not events:
            raise RuntimeError("No verified native root-consent event was recorded")
    finally:
        stop.set()
        thread.join(timeout=3)
        (evidence / "native-consent.json").write_text(json.dumps({"accepted": events, "observedWarnings": observed}), encoding="utf8")


def main():
    if not (sys.platform == "win32" and os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and os.environ.get("TRON_PIT_DISPOSABLE_CA_TEST") == "1"):
        raise RuntimeError("This intrusive acceptance test requires an opted-in disposable GitHub Windows runner")
    evidence = Path(os.environ["PIT_EVIDENCE"])
    evidence.mkdir(parents=True, exist_ok=True)
    browser = Path(os.environ["PIT_BROWSER"])
    if not browser.is_file():
        raise RuntimeError("Pinned Ungoogled Chromium executable is missing")
    for port in (9061, 9081):
        if not windows.port_available(port):
            raise RuntimeError("Refusing to touch an existing helper on port %d" % port)
    with tempfile.TemporaryDirectory(prefix="tron-pit-acceptance-") as temp:
        root = Path(temp)
        bundle = root / "bundle space !"
        bundle.mkdir()
        for name in ("tronbrowser.cmd", "tron-tor-helper", "tron-windows.py"):
            shutil.copy2(LAUNCHER / name, bundle / name)
        shutil.copytree(HERE.parent / "extensions/ai-sidebar", bundle / "extensions/ai-sidebar")
        for test in (bundle / "extensions").rglob("*.test.js"):
            test.unlink()
        profile = root / "profile space !"
        helper_log = profile / "tor-helper.log"
        pidfile = root / "owned-helper.pid"
        env = os.environ.copy()
        env.update(TRONBROWSER_BROWSER=str(browser), TRONBROWSER_DATA=str(profile),
                   TRON_TOR_PIDFILE=str(pidfile), PYTHONUTF8="1")
        cmd = bundle / "tronbrowser.cmd"
        der, pin = windows.download_root()
        cert = root / "registry.cer"
        cert.write_bytes(der)
        initial = windows.certificate_action(cert, pin, "inspect")
        if initial["alreadyTrusted"]:
            raise RuntimeError("Disposable runner unexpectedly already trusts this CA; will not alter it")

        # An unrelated self-signed local origin must fail before AND after setup.
        run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
             "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1",
             "-keyout", str(root / "bad.key"), "-out", str(root / "bad.crt")])
        class QuietHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Untrusted fixture")

            def log_message(self, *_):
                pass

        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(root / "bad.crt", root / "bad.key")
        class BoundedTlsServer(http.server.ThreadingHTTPServer):
            def get_request(self):
                sock, address = super().get_request()
                sock.settimeout(3)
                try:
                    return tls.wrap_socket(sock, server_side=True), address
                except Exception:
                    sock.close()
                    raise

        server = BoundedTlsServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run(command_line(cmd, "--setup-pit-https"), env=env, input="CANCEL\n")
            assert not windows.certificate_action(cert, pin, "inspect")["alreadyTrusted"]
            print("PASS: cancelling real setup leaves trust unchanged", flush=True)
            for phase in ("before-trust", "after-trust", "after-trust-fresh", "after-removal"):
                if phase == "after-trust":
                    consent_to_test_root(cmd, env, initial["thumbprint"], evidence)
                    assert windows.certificate_action(cert, pin, "inspect")["alreadyTrusted"]
                    print("PASS: explicit real setup imports the pinned root", flush=True)
                    already = run(command_line(cmd, "--setup-pit-https"), env=env, input="")
                    assert "already trusted; no changes made" in already.stdout
                if phase == "after-removal":
                    run(command_line(cmd, "--remove-pit-https"), env=env, input="CANCEL\n")
                    assert windows.certificate_action(cert, pin, "inspect")["alreadyTrusted"]
                    run(command_line(cmd, "--remove-pit-https"), env=env, input="REMOVE\n")
                    assert not windows.certificate_action(cert, pin, "inspect")["alreadyTrusted"]
                    print("PASS: supported offline removal revokes the pinned root", flush=True)
                if phase in ("after-trust-fresh", "after-removal"):
                    profile = root / phase
                    env["TRONBROWSER_DATA"] = str(profile)
                active_port = profile / "DevToolsActivePort"
                active_port.unlink(missing_ok=True)
                with (evidence / (phase + "-launcher.log")).open("w", encoding="utf8") as log:
                    child = subprocess.Popen(command_line(cmd, "--headless=new --remote-debugging-port=0 about:blank"),
                                             env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
                    try:
                        deadline = time.monotonic() + 45
                        while not active_port.is_file():
                            if child.poll() is not None or time.monotonic() > deadline:
                                raise RuntimeError("Browser did not expose DevTools; see launcher log")
                            time.sleep(0.2)
                        run(["node", str(HERE / "windows-pit-browser.mjs"), str(profile), phase,
                             str(evidence), "https://127.0.0.1:%d/" % server.server_port], env=env)
                    finally:
                        if child.poll() is None:
                            try:
                                child.wait(timeout=10)
                            except subprocess.TimeoutExpired:
                                subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], capture_output=True)
                                child.wait(timeout=10)
            print("PASS: Windows browser acceptance complete", flush=True)
        finally:
            # Emergency cleanup must run even if a process/PID cleanup fails.
            try:
                remove_test_root(cert, pin)
                assert not windows.certificate_action(cert, pin, "inspect")["alreadyTrusted"]
                (evidence / "cleanup.json").write_text(json.dumps({"removedTestRoot": True, "sha256": pin}), encoding="utf8")
                print("PASS: exact test root removed from disposable runner", flush=True)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)
                if helper_log.is_file():
                    shutil.copy2(helper_log, evidence / "tor-helper.log")
                stop_owned_helper(pidfile, bundle)


if __name__ == "__main__":
    main()

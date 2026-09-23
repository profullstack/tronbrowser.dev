"""Opt-in, disposable GitHub Windows runner only; never a developer PC.

Exercises the real cmd launcher, extension, registry root install, and browser.
Only the exact root absent before this test may be removed during cleanup.
"""
import http.server
import importlib.util
import json
import os
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
  foreach ($match in $matches) { $store.Remove($match) }
} finally { $store.Close(); $cert.Dispose() }
'''
    env = os.environ.copy()
    env.pop("PSModulePath", None)
    env.update(TRON_CA_FILE=str(cert), TRON_CA_SHA256=fingerprint)
    powershell = Path(env["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    run([str(powershell), "-NoProfile", "-NonInteractive", "-Command", command], env=env)


def command_line(launcher, tail=""):
    return 'cmd.exe /d /s /c ""%s" %s"' % (launcher, tail)


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

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(root / "bad.crt", root / "bad.key")
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run(command_line(cmd, "--setup-pit-https"), env=env, input="CANCEL\n")
            assert not windows.certificate_action(cert, pin, "inspect")["alreadyTrusted"]
            print("PASS: cancelling real setup leaves trust unchanged", flush=True)
            for phase in ("before-trust", "after-trust"):
                if phase == "after-trust":
                    run(command_line(cmd, "--setup-pit-https"), env=env, input="TRUST\n")
                    assert windows.certificate_action(cert, pin, "inspect")["alreadyTrusted"]
                    print("PASS: explicit real setup imports the pinned root", flush=True)
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
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
            # This file was written only by the helper spawned in our isolated
            # bundle; never take ownership of a pre-existing machine PID.
            if pidfile.is_file():
                pid = int(pidfile.read_text())
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
            log = profile / "tor-helper.log"
            if log.is_file():
                shutil.copy2(log, evidence / "tor-helper.log")
            remove_test_root(cert, pin)
            assert not windows.certificate_action(cert, pin, "inspect")["alreadyTrusted"]
            (evidence / "cleanup.json").write_text(json.dumps({"removedTestRoot": True, "sha256": pin}), encoding="utf8")
            print("PASS: exact test root removed from disposable runner", flush=True)


if __name__ == "__main__":
    main()

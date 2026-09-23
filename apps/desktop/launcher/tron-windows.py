#!/usr/bin/env python3
"""Windows network-helper startup and explicitly requested Pit HTTPS setup."""
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
REGISTRY = "https://pit.moshcode.sh"
# Rotation is a reviewed release change, never trust whatever a server offers.
ROOT_SHA256 = "4A5766EC8C1F10F875C98965FBE8DC361A32C72BC3959516EA7B8161001E1557"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Redirect refused: " + req.full_url)


class HelperUnavailable(RuntimeError):
    pass


def port_available(port):
    # Some Windows stacks silently drop SYNs for closed loopback ports. Binding
    # with exclusive ownership distinguishes that case from an occupied port.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        if sys.platform == "win32":
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            probe.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def read_url(url, *, local=False, timeout=10, limit=65536):
    handlers = [NoRedirect()]
    if local:
        handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    with opener.open(url, timeout=timeout) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Response too large")
        return data


def helper_state(port):
    try:
        # Windows can take about a second to report a refused loopback socket.
        raw = read_url("http://127.0.0.1:%d/pit/status" % port, local=True, timeout=2)
    except urllib.error.URLError as exc:
        # Only a refused connection means it is safe to try starting a helper.
        if isinstance(exc.reason, ConnectionRefusedError):
            return None
        raise HelperUnavailable("Helper port is occupied or unresponsive") from exc
    except (TimeoutError, OSError) as exc:
        raise HelperUnavailable("Helper port is occupied or unresponsive") from exc
    try:
        state = json.loads(raw)
        if (not isinstance(state, dict) or state.get("helper") != "tronbrowser-network"
                or type(state.get("running")) is not bool
                or type(state.get("port")) is not int
                or type(state.get("pid")) is not int
                or not isinstance(state.get("version"), str)):
            raise ValueError("Unrecognized helper")
        return state
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Unrecognized or older service on the helper port; not replacing it") from exc


def start_helper(directory=HERE, data=None, timeout=6):
    directory = Path(directory)
    helper = directory / "tron-tor-helper"
    if not helper.is_file():
        raise RuntimeError("Release is missing tron-tor-helper; reinstall the complete Windows ZIP")
    config = runpy.run_path(str(helper))
    port, version = config["PORT"], config["HELPER_VERSION"]
    existing = None if port_available(port) else helper_state(port)
    if existing is not None:
        if existing["version"] != version:
            raise RuntimeError("Older helper is running. Restart Windows after upgrading TronBrowser")
        return existing
    data = Path(data or os.environ.get("TRONBROWSER_DATA") or Path.home() / ".tronbrowser")
    data.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(TRON_TOR_BIN_DIR=str(directory), TRON_TOR_DATA=str(data / "tor"),
               PYTHONUTF8="1", PYTHONUNBUFFERED="1")
    options = {"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS} if sys.platform == "win32" else {"start_new_session": True}
    log_path = data / "tor-helper.log"
    if log_path.exists() and log_path.stat().st_size > 5 * 1024 * 1024:
        log_path.replace(data / "tor-helper.previous.log")
    with log_path.open("ab") as log:
        child = subprocess.Popen([sys.executable, str(helper)], stdin=subprocess.DEVNULL,
                                 stdout=log, stderr=subprocess.STDOUT, env=env, **options)
    deadline = time.monotonic() + timeout
    try:
        while time.monotonic() < deadline:
            try:
                state = helper_state(port)
            except HelperUnavailable:
                # Only retry transport failures while our own child starts.
                state = None
            if state is not None:
                if state["version"] != version:
                    raise RuntimeError("A different helper version owns the port")
                return state
            if child.poll() is not None:
                raise RuntimeError("Helper exited before becoming ready")
            time.sleep(0.1)
        raise RuntimeError("Helper startup timed out")
    except Exception:
        # Terminate only the process we just created, never a PID read from disk.
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=5)
        raise


# No interpolated commands, policy changes, machine store, or TLS exceptions.
# Certificate validation is repeated immediately before adding to the store.
CERTIFICATE_COMMAND = r'''
$ErrorActionPreference = 'Stop'
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($env:TRON_CA_FILE)
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $fingerprint = ([BitConverter]::ToString($sha.ComputeHash($cert.RawData))).Replace('-', '') }
finally { $sha.Dispose() }
if ($fingerprint -cne $env:TRON_CA_SHA256) { throw 'Certificate fingerprint mismatch' }
$constraints = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' })
if ($constraints.Count -ne 1) { throw 'Missing or duplicate CA constraints' }
$basic = New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension
$basic.CopyFrom($constraints[0])
if (-not $basic.CertificateAuthority) { throw 'Not a CA certificate' }
$usages = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.15' })
if ($usages.Count -ne 1) { throw 'Missing CA key usage' }
$usage = New-Object System.Security.Cryptography.X509Certificates.X509KeyUsageExtension
$usage.CopyFrom($usages[0])
if (-not ($usage.KeyUsages -band [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign)) { throw 'CA cannot sign certificates' }
$now = [DateTime]::UtcNow
if ($now -lt $cert.NotBefore.ToUniversalTime() -or $now -gt $cert.NotAfter.ToUniversalTime()) { throw 'Certificate is not currently valid' }
if ($cert.Subject -ne $cert.Issuer) { throw 'Not a root certificate' }
if ($cert.HasPrivateKey) { throw 'Unexpected private key' }
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
try {
  $flags = [System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly
  if ($env:TRON_CA_MODE -eq 'install') { $flags = [System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite }
  $store.Open($flags)
  $existing = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $cert.Thumbprint, $false)
  $already = $existing.Count -gt 0
  if ($env:TRON_CA_MODE -eq 'install' -and -not $already) {
    $store.Add($cert)
    $confirmed = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $cert.Thumbprint, $false)
    if ($confirmed.Count -eq 0) { throw 'Certificate was not added to CurrentUser Root' }
  }
  @{fingerprint=$fingerprint; thumbprint=$cert.Thumbprint; alreadyTrusted=$already; subject=$cert.Subject} | ConvertTo-Json -Compress
} finally { $store.Close(); $cert.Dispose() }
'''


def certificate_action(path, fingerprint, mode):
    if sys.platform != "win32":
        raise RuntimeError("Certificate setup is Windows-only")
    if mode not in ("inspect", "install"):
        raise ValueError("Invalid certificate action")
    system_root = os.environ.get("SystemRoot")
    if not system_root:
        raise RuntimeError("Windows SystemRoot is missing; certificate setup cannot continue")
    powershell = Path(system_root) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    env = os.environ.copy()
    # Let Windows PowerShell construct its own module path, not inherit pwsh 7's.
    env.pop("PSModulePath", None)
    env.update(TRON_CA_FILE=str(path), TRON_CA_SHA256=fingerprint, TRON_CA_MODE=mode)
    result = subprocess.run([str(powershell), "-NoProfile", "-NonInteractive", "-Command", CERTIFICATE_COMMAND],
                            env=env, capture_output=True, text=True, timeout=90)
    if result.returncode != 0:
        raise RuntimeError("Windows certificate validation/import failed (device policy may block it): " + result.stderr.strip())
    return json.loads(result.stdout)


def download_root():
    metadata = json.loads(read_url(REGISTRY + "/api/moshpit/ca"))
    if not isinstance(metadata, dict) or metadata.get("enabled") is not True:
        raise ValueError("Registry CA is not enabled")
    root = metadata.get("root")
    wanted = root.get("fingerprint_sha256", "") if isinstance(root, dict) else ""
    if not isinstance(wanted, str):
        raise ValueError("Invalid CA fingerprint")
    wanted = wanted.replace(":", "").upper()
    if not re.fullmatch(r"[0-9A-F]{64}", wanted):
        raise ValueError("Invalid CA fingerprint")
    if wanted != ROOT_SHA256:
        raise ValueError("Registry CA changed; a reviewed TronBrowser update is required")
    pem = read_url(REGISTRY + "/api/moshpit/ca.crt").decode("ascii").strip()
    if not re.fullmatch(r"-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----", pem):
        raise ValueError("Expected exactly one PEM certificate")
    der = ssl.PEM_cert_to_DER_cert(pem)
    if hashlib.sha256(der).hexdigest().upper() != wanted:
        raise ValueError("Registry CA fingerprint mismatch")
    return der, wanted


def setup_https():
    if sys.platform != "win32":
        raise RuntimeError("Certificate setup is Windows-only")
    der, fingerprint = download_root()
    with tempfile.TemporaryDirectory(prefix="tron-pit-ca-") as temp:
        path = Path(temp) / "root.cer"
        path.write_bytes(der)
        info = certificate_action(path, fingerprint, "inspect")
        print("Registry: " + REGISTRY)
        print("CA SHA-256: " + fingerprint)
        print("Windows thumbprint: " + info["thumbprint"])
        if info["alreadyTrusted"]:
            print("This exact CA is already trusted; no changes made.")
            return
        print("This adds a persistent root CA to your Windows CURRENT USER trusted roots.")
        print("It can authenticate sites in ALL apps using that store, not just TronBrowser.")
        print("This CA is NOT restricted to Moshpit names. Trust its operator only if you")
        print("accept that authority; turning Pit off does not remove the certificate.")
        print("No DNS or machine-wide settings will change. Do not do this on a managed")
        print("work computer without your administrator's approval. Cancel if unsure.")
        if input("Type TRUST to continue (anything else cancels): ").strip() != "TRUST":
            print("Cancelled; no certificate was installed.")
            return
        certificate_action(path, fingerprint, "install")
        print("Root CA installed. Restart TronBrowser, then turn Pit on.")
        print("To undo: open certmgr.msc > Trusted Root Certification Authorities >")
        print("Certificates, and remove ONLY the certificate with this thumbprint:")
        print(info["thumbprint"])


def main():
    try:
        if sys.argv[1:] == ["setup-https"]:
            setup_https()
        elif sys.argv[1:] == ["start"]:
            state = start_helper()
            print("TronBrowser network helper ready (PID %d). Pit stays off until enabled." % state["pid"])
        else:
            raise ValueError("Usage: tron-windows.py start|setup-https")
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, EOFError) as exc:
        print("TronBrowser: %s" % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

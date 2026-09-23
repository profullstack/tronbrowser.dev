"""Stdlib-only tests. No public network, DNS changes, or certificate imports."""
import contextlib
import hashlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import runpy
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error

LAUNCHER = Path(__file__).resolve().parents[1] / "launcher"
SPEC = importlib.util.spec_from_file_location("tron_windows", LAUNCHER / "tron-windows.py")
windows = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(windows)


def helper_module():
    return runpy.run_path(str(LAUNCHER / "tron-tor-helper"))


def unused_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def state(**overrides):
    return dict(helper="tronbrowser-network", version="3.4.4", running=False,
                port=9081, pid=123, **overrides)


class StartupTests(unittest.TestCase):
    def setUp(self):
        probe = mock.patch.object(windows, "port_available", return_value=False)
        probe.start()
        self.addCleanup(probe.stop)

    def test_refused_port_is_only_absence_case(self):
        with mock.patch.object(windows, "read_url", side_effect=urllib.error.URLError(ConnectionRefusedError())):
            self.assertIsNone(windows.helper_state(1234))
        for error in (urllib.error.URLError(TimeoutError()), TimeoutError(), OSError("busy")):
            with self.subTest(error=error), mock.patch.object(windows, "read_url", side_effect=error):
                with self.assertRaises(RuntimeError):
                    windows.helper_state(1234)

    def test_invalid_or_old_responder_not_replaced(self):
        for response in ({}, [], {"version": "old"}, {**state(), "pid": True}, {**state(), "version": None}):
            with self.subTest(response=response), mock.patch.object(windows, "read_url", return_value=json.dumps(response).encode()):
                with self.assertRaises(RuntimeError):
                    windows.helper_state(1234)

    def test_reuses_matching_helper_without_spawn(self):
        with mock.patch.object(windows, "helper_state", return_value=state()), mock.patch.object(windows.subprocess, "Popen") as spawn:
            self.assertEqual(windows.start_helper(LAUNCHER)["pid"], 123)
            spawn.assert_not_called()

    def test_does_not_kill_stale_helper(self):
        with mock.patch.object(windows, "helper_state", return_value={**state(), "version": "old"}), mock.patch.object(windows.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(RuntimeError, "Older helper"):
                windows.start_helper(LAUNCHER)
            spawn.assert_not_called()

    def test_missing_bundle_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(RuntimeError, "missing tron-tor-helper"):
                windows.start_helper(temp)

    def test_failed_child_is_reaped(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(windows, "helper_state", return_value=None), mock.patch.object(windows.subprocess, "Popen") as spawn:
            spawn.return_value.poll.return_value = None
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                windows.start_helper(LAUNCHER, data=temp, timeout=0)
            spawn.return_value.terminate.assert_called_once()
            spawn.return_value.wait.assert_called_once()
            self.assertEqual(spawn.call_args.kwargs["env"]["TRON_TOR_BIN_DIR"], str(LAUNCHER))

    def test_detached_windows_flags(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(windows, "helper_state", side_effect=[None, state()]), mock.patch.object(windows.sys, "platform", "win32"), mock.patch.object(windows.subprocess, "CREATE_NO_WINDOW", 0x08000000, create=True), mock.patch.object(windows.subprocess, "DETACHED_PROCESS", 8, create=True), mock.patch.object(windows.subprocess, "Popen") as spawn:
            windows.start_helper(LAUNCHER, data=temp)
            self.assertEqual(spawn.call_args.kwargs["creationflags"], 0x08000008)
            self.assertNotIn("shell", spawn.call_args.kwargs)

    def test_own_startup_retries_transport_failures(self):
        responses = [None, windows.HelperUnavailable("timeout"), windows.HelperUnavailable("reset"), state()]
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(windows, "helper_state", side_effect=responses), mock.patch.object(windows.subprocess, "Popen") as spawn:
            spawn.return_value.poll.return_value = None
            self.assertEqual(windows.start_helper(LAUNCHER, data=temp)["pid"], 123)
            spawn.return_value.terminate.assert_not_called()

    def test_occupied_unresponsive_port_never_spawns(self):
        with mock.patch.object(windows, "helper_state", side_effect=windows.HelperUnavailable("timeout")), mock.patch.object(windows.subprocess, "Popen") as spawn:
            with self.assertRaises(windows.HelperUnavailable):
                windows.start_helper(LAUNCHER)
            spawn.assert_not_called()

    def test_bad_responder_during_own_startup_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(windows, "helper_state", side_effect=[None, RuntimeError("Unrecognized helper")]), mock.patch.object(windows.subprocess, "Popen") as spawn:
            spawn.return_value.poll.return_value = None
            with self.assertRaisesRegex(RuntimeError, "Unrecognized helper"):
                windows.start_helper(LAUNCHER, data=temp)
            spawn.return_value.terminate.assert_called_once()


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.helper = helper_module()
        self.server = self.helper["HelperServer"](("127.0.0.1", 0), self.helper["Handler"])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, path, method="GET", headers=None):
        with contextlib.closing(http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)) as client:
            client.request(method, path, headers=headers or {})
            response = client.getresponse()
            return response.status, dict(response.getheaders()), json.loads(response.read())

    def test_readiness_does_not_activate_network_services(self):
        status, headers, body = self.request("/pit/status")
        self.assertEqual(status, 200)
        self.assertFalse(body["running"])
        self.assertEqual(body["helper"], "tronbrowser-network")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_web_origin_cannot_control_helper(self):
        for origin in ("https://attacker.invalid", "null", "chrome-extension://invalid"):
            for method in ("GET", "POST"):
                with self.subTest(origin=origin, method=method):
                    status, headers, _ = self.request("/pit/start", method, {"Origin": origin})
                    self.assertEqual(status, 403)
                    self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_dns_rebinding_host_rejected(self):
        self.assertEqual(self.request("/pit/status", headers={"Host": "attacker.invalid"})[0], 403)

    def test_get_cannot_start_or_stop_services(self):
        for path in ("/start", "/stop", "/pit/start", "/pit/stop", "/future-mutation"):
            self.assertEqual(self.request(path)[0], 405)

    def test_web_preflight_cannot_grant_access(self):
        status, headers, _ = self.request("/pit/start", "OPTIONS", {
            "Origin": "https://attacker.invalid", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertNotIn("Access-Control-Allow-Private-Network", headers)

    def test_extension_origin_and_post_still_work(self):
        origin = "chrome-extension://" + "a" * 32
        status, headers, body = self.request("/pit/stop", "POST", {"Origin": origin})
        self.assertEqual(status, 200)
        self.assertTrue(body["stopped"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], origin)

    def test_proxy_settings_cannot_redirect_loopback_probe(self):
        with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "http_proxy": "http://127.0.0.1:1", "NO_PROXY": "", "no_proxy": ""}):
            self.assertEqual(windows.helper_state(self.server.server_port)["helper"], "tronbrowser-network")


class RootSetupTests(unittest.TestCase):
    def test_missing_windows_environment_fails_before_powershell(self):
        with mock.patch.object(windows.sys, "platform", "win32"), mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(windows.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "SystemRoot is missing"):
                windows.certificate_action(Path("root.cer"), windows.ROOT_SHA256, "inspect")
            run.assert_not_called()

    def test_committed_public_ca_matches_release_pin(self):
        pem = (LAUNCHER.parent / "test/fixtures/moshpit-root-ca.crt").read_text()
        der = ssl.PEM_cert_to_DER_cert(pem)
        self.assertEqual(hashlib.sha256(der).hexdigest().upper(), windows.ROOT_SHA256)

    @unittest.skipUnless(sys.platform == "win32", "Needs native Windows certificate APIs")
    def test_windows_inspects_ca_without_modifying_trust_store(self):
        powershell = str(Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe")

        def snapshot():
            env = os.environ.copy()
            env.pop("PSModulePath", None)
            result = subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-Command",
                                    "$s = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser'); "
                                    "try { $s.Open('ReadOnly'); $s.Certificates | Sort-Object Thumbprint | ForEach-Object { $_.Thumbprint } } finally { $s.Close() }"],
                                    env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout

        before = snapshot()
        with tempfile.TemporaryDirectory() as temp:
            pem = (LAUNCHER.parent / "test/fixtures/moshpit-root-ca.crt").read_text()
            cert = Path(temp) / "CA space !.cer"
            cert.write_bytes(ssl.PEM_cert_to_DER_cert(pem))
            info = windows.certificate_action(cert, windows.ROOT_SHA256, "inspect")
            self.assertEqual(info["fingerprint"], windows.ROOT_SHA256)
            self.assertIn("Moshpit Root CA", info["subject"])
            with self.assertRaisesRegex(RuntimeError, "fingerprint mismatch"):
                windows.certificate_action(cert, "0" * 64, "inspect")
        self.assertEqual(snapshot(), before)

    def test_download_requires_release_pin_and_metadata_match(self):
        der = b"fixture DER bytes: download validates bytes, Windows validates X509"
        pin = hashlib.sha256(der).hexdigest().upper()
        metadata = json.dumps({"enabled": True, "root": {"fingerprint_sha256": pin}}).encode()
        pem = ssl.DER_cert_to_PEM_cert(der).encode()
        with mock.patch.object(windows, "ROOT_SHA256", pin), mock.patch.object(windows, "read_url", side_effect=[metadata, pem]):
            self.assertEqual(windows.download_root(), (der, pin))
        with mock.patch.object(windows, "read_url", return_value=metadata) as fetch:
            with self.assertRaisesRegex(ValueError, "reviewed TronBrowser update"):
                windows.download_root()
            self.assertEqual(fetch.call_count, 1)

    def test_download_rejects_wrong_bytes_and_multiple_certs(self):
        pin = windows.ROOT_SHA256
        metadata = json.dumps({"enabled": True, "root": {"fingerprint_sha256": pin}}).encode()
        pem = ssl.DER_cert_to_PEM_cert(b"wrong").encode()
        for cert in (pem, pem + pem):
            with mock.patch.object(windows, "read_url", side_effect=[metadata, cert]):
                with self.assertRaises(ValueError):
                    windows.download_root()

    def test_invalid_metadata_never_downloads_certificate(self):
        for metadata in ([], {}, {"enabled": "true"}, {"enabled": True, "root": {"fingerprint_sha256": []}}):
            with mock.patch.object(windows, "read_url", return_value=json.dumps(metadata).encode()) as fetch:
                with self.assertRaises(ValueError):
                    windows.download_root()
                self.assertEqual(fetch.call_count, 1)

    def test_redirects_are_refused(self):
        request = windows.urllib.request.Request(windows.REGISTRY)
        with self.assertRaisesRegex(ValueError, "Redirect refused"):
            windows.NoRedirect().redirect_request(request, None, 302, "", {}, "http://untrusted.invalid")

    def test_cancel_never_imports_and_temp_file_removed(self):
        info = {"thumbprint": "A" * 40, "alreadyTrusted": False}
        with mock.patch.object(windows.sys, "platform", "win32"), mock.patch.object(windows, "download_root", return_value=(b"der", windows.ROOT_SHA256)), mock.patch.object(windows, "certificate_action", return_value=info) as action, mock.patch("builtins.input", return_value="no"), contextlib.redirect_stdout(io.StringIO()) as output:
            windows.setup_https()
            self.assertEqual(action.call_count, 1)
            self.assertEqual(action.call_args.args[2], "inspect")
            self.assertFalse(action.call_args.args[0].exists())
            self.assertIn("ALL apps", output.getvalue())
            self.assertIn("NOT restricted", output.getvalue())

    def test_already_trusted_never_prompts_or_imports(self):
        info = {"thumbprint": "A" * 40, "alreadyTrusted": True}
        with mock.patch.object(windows.sys, "platform", "win32"), mock.patch.object(windows, "download_root", return_value=(b"der", windows.ROOT_SHA256)), mock.patch.object(windows, "certificate_action", return_value=info) as action, mock.patch("builtins.input") as prompt, contextlib.redirect_stdout(io.StringIO()):
            windows.setup_https()
            prompt.assert_not_called()
            self.assertEqual(action.call_count, 1)

    def test_explicit_consent_imports_exact_inspected_bytes(self):
        info = {"thumbprint": "A" * 40, "alreadyTrusted": False}
        with mock.patch.object(windows.sys, "platform", "win32"), mock.patch.object(windows, "download_root", return_value=(b"der", windows.ROOT_SHA256)), mock.patch.object(windows, "certificate_action", return_value=info) as action, mock.patch("builtins.input", return_value="TRUST"), contextlib.redirect_stdout(io.StringIO()):
            windows.setup_https()
            self.assertEqual([call.args[2] for call in action.call_args_list], ["inspect", "install"])
            self.assertEqual(action.call_args_list[0].args[:2], action.call_args_list[1].args[:2])


class RuntimeTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("openssl"), "OpenSSL fixture generator is required")
    def test_socks_relays_verified_tls_and_does_not_hide_certificate_errors(self):
        with tempfile.TemporaryDirectory() as temp:
            cert, key = Path(temp) / "cert.pem", Path(temp) / "key.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                            "-keyout", str(key), "-out", str(cert), "-days", "1",
                            "-subj", "/CN=fixture.invalid", "-addext", "subjectAltName=DNS:fixture.invalid"],
                           check=True, capture_output=True, timeout=15)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            listener.settimeout(3)
            port = listener.getsockname()[1]
            helper = helper_module()
            globals_ = helper["_pit_serve"].__globals__
            socks = helper["PitSocks"](0)
            socks_port = socks.sock.getsockname()[1]
            errors = []

            def serve():
                for _ in range(2):
                    try:
                        raw, _addr = listener.accept()
                        with raw:
                            try:
                                with context.wrap_socket(raw, server_side=True) as tls:
                                    tls.recv(1024)
                                    tls.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                            except ssl.SSLError:
                                pass  # the second client deliberately does not trust our fixture
                    except Exception as exc:
                        errors.append(exc)

            server = threading.Thread(target=serve, daemon=True)
            with mock.patch.dict(globals_, {"pit_resolve": lambda name: ["127.0.0.1"]}):
                socks.start()
                server.start()
                try:
                    for trusted in (True, False):
                        with socket.create_connection(("127.0.0.1", socks_port), timeout=3) as client:
                            client.sendall(b"\x05\x01\x00")
                            self.assertEqual(helper["_recv_exact"](client, 2), b"\x05\x00")
                            host = b"fixture.invalid"
                            client.sendall(b"\x05\x01\x00\x03" + bytes([len(host)]) + host + struct.pack(">H", port))
                            self.assertEqual(helper["_recv_exact"](client, 10)[1], 0)
                            tls_context = ssl.create_default_context(cafile=str(cert) if trusted else None)
                            if trusted:
                                with tls_context.wrap_socket(client, server_hostname="fixture.invalid") as tls:
                                    tls.sendall(b"GET / HTTP/1.1\r\nHost: fixture.invalid\r\n\r\n")
                                    self.assertIn(b"200 OK", tls.recv(4096))
                            else:
                                with self.assertRaises(ssl.SSLCertVerificationError):
                                    tls_context.wrap_socket(client, server_hostname="fixture.invalid")
                finally:
                    socks.stop()
                    listener.close()
                    server.join(timeout=5)
                self.assertFalse(errors)

    def test_real_helper_start_reuse_and_stop_without_external_network(self):
        with tempfile.TemporaryDirectory(prefix="tron pit space ! ") as temp:
            control, socks = unused_port(), unused_port()
            processes = []
            popen = subprocess.Popen

            def record(*args, **kwargs):
                child = popen(*args, **kwargs)
                processes.append(child)
                return child

            env = {"TRON_TOR_HELPER_PORT": str(control), "TRON_PIT_SOCKS_PORT": str(socks),
                   "TRON_TOR_SOCKS_PORT": str(unused_port()), "TRON_PIT_DOH_URL": "http://127.0.0.1:1/dns-query"}
            try:
                with mock.patch.dict(os.environ, env), mock.patch.object(windows.subprocess, "Popen", side_effect=record):
                    first = windows.start_helper(LAUNCHER, data=temp)
                    second = windows.start_helper(LAUNCHER, data=temp)
                    self.assertEqual(first["pid"], second["pid"])
                    self.assertEqual(len(processes), 1)
                    self.assertFalse(first["running"])
                    for _ in range(2):
                        with contextlib.closing(http.client.HTTPConnection("127.0.0.1", control, timeout=4)) as client:
                            client.request("POST", "/pit/start")
                            started = json.loads(client.getresponse().read())
                            self.assertTrue(started["started"])
                            self.assertFalse(started["check"]["ok"])
                            client.request("POST", "/pit/stop")
                            self.assertTrue(json.loads(client.getresponse().read())["stopped"])
                        with self.assertRaises(OSError):
                            socket.create_connection(("127.0.0.1", socks), timeout=0.3)
            finally:
                for child in processes:
                    child.terminate()
                    child.wait(timeout=5)

    def test_windows_exclusive_socket_binding(self):
        helper = helper_module()
        with mock.patch.object(sys, "platform", "win32"), mock.patch.object(socket, "SO_EXCLUSIVEADDRUSE", -5, create=True), mock.patch.object(socket, "socket") as sock:
            helper["PitSocks"](1234)
            sock.return_value.setsockopt.assert_called_once_with(socket.SOL_SOCKET, -5, 1)

    def test_both_packagers_ship_windows_entrypoints(self):
        root = LAUNCHER.parents[2]
        shell = (root / "apps/desktop/scripts/build-release.sh").read_text()
        workflow = (root / ".github/workflows/release.yml").read_text()
        for filename in ("tron-tor-helper", "tron-windows.py", "tronbrowser.cmd"):
            self.assertIn(filename, shell)
            self.assertIn(filename, workflow)

    @unittest.skipUnless(sys.platform == "win32", "Needs the native cmd.exe parser")
    def test_cmd_launches_helper_and_preserves_paths_and_arguments(self):
        with tempfile.TemporaryDirectory(prefix="tron pit space ! ") as temp:
            directory = Path(temp)
            for filename in ("tron-windows.py", "tron-tor-helper", "tronbrowser.cmd"):
                shutil.copyfile(LAUNCHER / filename, directory / filename)
            for name in ("ai-sidebar", "another extension !"):
                extension = directory / "extensions" / name
                extension.mkdir(parents=True)
                (extension / "manifest.json").write_text("{}")
            recorder = directory / "record.py"
            recorder.write_text("import json,os,sys\nfrom pathlib import Path\nPath(os.environ['ARGV_OUT']).write_text(json.dumps(sys.argv[1:]))\n")
            browser = directory / "browser.cmd"
            browser.write_text('@echo off\n"%TEST_PYTHON%" "%TEST_RECORDER%" %*\nexit /b %errorlevel%\n')
            output = directory / "args.json"
            pidfile = directory / "helper.pid"
            control = unused_port()
            env = {**os.environ, "TRONBROWSER_BROWSER": str(browser), "TRONBROWSER_DATA": str(directory / "profile"),
                   "TRON_TOR_HELPER_PORT": str(control), "TRON_TOR_PIDFILE": str(pidfile), "TRON_TOR_SOCKS_PORT": str(unused_port()),
                   "TEST_PYTHON": sys.executable, "TEST_RECORDER": str(recorder), "ARGV_OUT": str(output)}
            try:
                # cmd.exe does not use CRT argv quoting; pass /s /c intact.
                command = '"%s" /d /s /c ""%s" "https://example.invalid/path?a=1&b=2""' % (os.environ["COMSPEC"], directory / "tronbrowser.cmd")
                result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=25)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue(output.exists(), result.stdout + result.stderr)
                args = json.loads(output.read_text())
                self.assertIn("--user-data-dir=" + str(directory / "profile"), args)
                self.assertIn("https://example.invalid/path?a=1&b=2", args)
                extensions = next(arg for arg in args if arg.startswith("--load-extension="))
                self.assertIn("another extension !", extensions)
                self.assertIn("ai-sidebar", extensions)
                self.assertEqual(windows.helper_state(control)["pid"], int(pidfile.read_text()))
            finally:
                if pidfile.exists():
                    # This PID belongs to our isolated test subprocess and directory.
                    subprocess.run(["taskkill", "/PID", pidfile.read_text().strip(), "/F"], capture_output=True, timeout=5)


if __name__ == "__main__":
    unittest.main()

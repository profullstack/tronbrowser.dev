// Extension security scanner — the publish gate. Ports the heuristic engine
// from ugig.net's skill scanner (BuiltInScanner + CompositeScanner + optional
// SecureClaw enrichment) and tunes the GATE for browser extensions.
//
// Why tuned: the raw skill ruleset flags things every extension legitimately
// does (fetch, globalThis, atob/btoa, base64, hex escapes — ubiquitous in
// bundled crypto like @noble). So we surface high/medium as *advisory* and
// only BLOCK on `critical` (pipe-to-shell, `rm -rf /`, `.ssh/`, bundled native
// binaries) plus a couple of extension-specific criticals. A listing goes
// green (publishable) iff there are no critical findings.
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { crxToZip } from './crx.js';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ScanStatus = 'clean' | 'suspicious' | 'malicious';

export interface ScanFinding {
  rule: string;
  severity: Severity;
  detail: string;
  file?: string;
}

export interface ExtensionScanResult {
  status: ScanStatus;
  /** true = safe to publish (no critical findings) */
  green: boolean;
  fileHash: string;
  findings: ScanFinding[];
  countsBySeverity: Record<Severity, number>;
  scannerVersion: string;
}

export const SCANNER_VERSION = 'tron-ext-scanner-0.1.0';

const DANGEROUS_PATTERNS: { pattern: RegExp; rule: string; severity: Severity; detail: string }[] = [
  // ── Critical (BLOCK) ──
  { pattern: /curl\s+.*\|\s*(ba)?sh/i, rule: 'pipe-to-shell', severity: 'critical', detail: 'Pipe-to-shell (curl) in bundled code' },
  { pattern: /wget\s+.*\|\s*(ba)?sh/i, rule: 'wget-pipe-to-shell', severity: 'critical', detail: 'Pipe-to-shell (wget) in bundled code' },
  { pattern: /rm\s+-rf\s+\//i, rule: 'destructive-rm', severity: 'critical', detail: 'Destructive `rm -rf /` in bundled code' },
  { pattern: /\.ssh\/(id_|authorized_keys|known_hosts)/i, rule: 'ssh-key-access', severity: 'critical', detail: 'SSH key path reference' },
  // ── High (advisory) ──
  { pattern: /\beval\s*\(/, rule: 'eval', severity: 'high', detail: 'Use of eval()' },
  { pattern: /new\s+Function\s*\(/, rule: 'function-constructor', severity: 'high', detail: 'Function constructor (dynamic code)' },
  { pattern: /chrome\.debugger|browser\.debugger/i, rule: 'debugger-api', severity: 'high', detail: 'Uses the debugger API' },
  { pattern: /nativeMessaging/i, rule: 'native-messaging', severity: 'high', detail: 'Native messaging (talks to a native host)' },
  // ── Medium (advisory) ──
  { pattern: /chrome\.cookies|browser\.cookies/i, rule: 'cookies-api', severity: 'medium', detail: 'Reads/writes cookies' },
  { pattern: /document\.cookie/i, rule: 'document-cookie', severity: 'medium', detail: 'Accesses document.cookie' },
  { pattern: /webRequest|declarativeNetRequest/i, rule: 'network-interception', severity: 'medium', detail: 'Intercepts network requests' },
];

// Native binaries have no business inside an MV3 extension bundle.
const BLOCKED_EXT = new Set(['.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.ps1', '.sh', '.com', '.scr', '.node']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.html', '.htm', '.css', '.txt', '.md', '.wasm']);

function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

/** Scan the already-unzipped files of an extension bundle. */
export function scanFiles(files: Record<string, Uint8Array>): Omit<ExtensionScanResult, 'fileHash'> {
  const findings: ScanFinding[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    const ext = extname(name);
    if (BLOCKED_EXT.has(ext)) {
      findings.push({ rule: 'bundled-binary', severity: 'critical', detail: `Native binary in bundle (${ext})`, file: name });
      continue;
    }
    // Scan text-like files (skip huge assets); .wasm flagged as advisory, not read.
    if (ext === '.wasm') {
      findings.push({ rule: 'wasm-module', severity: 'medium', detail: 'Bundled WebAssembly module', file: name });
      continue;
    }
    if (!TEXT_EXT.has(ext) || bytes.length > 8 * 1024 * 1024) continue;
    const content = strFromU8(bytes);
    for (const { pattern, rule, severity, detail } of DANGEROUS_PATTERNS) {
      if (pattern.test(content)) findings.push({ rule, severity, detail, file: name });
    }
  }
  return summarize(findings);
}

/** Extra findings derived from the manifest's requested permissions. */
export function scanPermissions(permissions: string[]): ScanFinding[] {
  const out: ScanFinding[] = [];
  const set = new Set(permissions);
  if (set.has('<all_urls>') || permissions.some((p) => p === '*://*/*' || p === 'http://*/*' || p === 'https://*/*')) {
    out.push({ rule: 'broad-host-access', severity: 'high', detail: 'Requests access to all sites (<all_urls>)' });
  }
  for (const p of ['debugger', 'nativeMessaging', 'proxy', 'management']) {
    if (set.has(p)) out.push({ rule: `perm-${p}`, severity: 'high', detail: `Requests the "${p}" permission` });
  }
  for (const p of ['cookies', 'history', 'webRequest', 'declarativeNetRequest', 'tabs', 'scripting', 'downloads', 'clipboardRead']) {
    if (set.has(p)) out.push({ rule: `perm-${p}`, severity: 'medium', detail: `Requests the "${p}" permission` });
  }
  return out;
}

function summarize(findings: ScanFinding[]): Omit<ExtensionScanResult, 'fileHash'> {
  const counts: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) counts[f.severity]++;
  const status: ScanStatus = counts.critical > 0 ? 'malicious' : counts.high > 0 ? 'suspicious' : 'clean';
  return {
    status,
    green: counts.critical === 0, // publishable iff nothing critical
    findings,
    countsBySeverity: counts,
    scannerVersion: SCANNER_VERSION,
  };
}

/** Scan a full .crx buffer: unzip, scan code + permissions, verdict. */
export function scanCrx(buf: Uint8Array, permissions: string[] = []): ExtensionScanResult {
  const fileHash = createHash('sha256').update(buf).digest('hex');
  const files = unzipSync(crxToZip(buf), { filter: (f) => !f.name.endsWith('/') });
  const base = scanFiles(files);
  const permFindings = scanPermissions(permissions);
  const merged = [...base.findings, ...permFindings];
  return { ...summarize(merged), fileHash };
}

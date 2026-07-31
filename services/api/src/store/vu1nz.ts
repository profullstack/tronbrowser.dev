// vu1nz.com security scan integration. Non-gating: kicked off fire-and-forget
// after a version is submitted, results written back to extension_scans and
// shown as a badge. vu1nz is a separate (Python) service; we talk to it over
// HTTP at VU1NZ_API_URL. If it's not configured the scan is recorded as
// 'skipped' so listings still work without a scanner wired.
//
// The same scan also runs as a GitHub Action check on the git-registry PR path
// (see .github/workflows/extension-scan.yml) for submissions made via PR.
import { createScan, updateScan, type ExtensionVersion } from './db.js';

interface Vu1nzResult {
  score?: number;      // 0-100, higher = safer
  severity?: string;   // clean | low | medium | high | critical
  findings?: unknown;
}

function severityFromScore(score: number): string {
  if (score >= 90) return 'clean';
  if (score >= 75) return 'low';
  if (score >= 50) return 'medium';
  if (score >= 25) return 'high';
  return 'critical';
}

async function callVu1nz(version: ExtensionVersion): Promise<Vu1nzResult> {
  const api = process.env.VU1NZ_API_URL;
  if (!api) throw new Error('skipped');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.VU1NZ_API_KEY) headers.authorization = `Bearer ${process.env.VU1NZ_API_KEY}`;

  const res = await fetch(`${api.replace(/\/$/, '')}/scan/extension`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      target: 'browser-extension',
      manifest: JSON.parse(version.manifest_json),
      permissions: version.permissions_json ? JSON.parse(version.permissions_json) : [],
      bundle_url: version.bundle_url,
      crx_url: version.crx_url,
    }),
  });
  if (!res.ok) throw new Error(`vu1nz ${res.status}: ${await res.text()}`);
  return (await res.json()) as Vu1nzResult;
}

/**
 * Create a scan row and run it in the background. Never throws to the caller —
 * publish must not depend on the scanner being up.
 */
export async function enqueueScan(extensionId: string, version: ExtensionVersion): Promise<string> {
  const scanId = await createScan(extensionId, version.id);

  // Intentionally not awaited by the request handler.
  void (async () => {
    if (!process.env.VU1NZ_API_URL) {
      await updateScan(scanId, { status: 'skipped' });
      return;
    }
    try {
      await updateScan(scanId, { status: 'running' });
      const r = await callVu1nz(version);
      const score = typeof r.score === 'number' ? Math.round(r.score) : null;
      await updateScan(scanId, {
        status: 'done',
        score,
        severity: r.severity ?? (score != null ? severityFromScore(score) : null),
        findingsJson: r.findings != null ? JSON.stringify(r.findings) : null,
      });
    } catch (e: any) {
      await updateScan(scanId, { status: 'error', error: String(e?.message ?? e) });
    }
  })();

  return scanId;
}

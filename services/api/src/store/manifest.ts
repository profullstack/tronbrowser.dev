// Manifest V3 validation. The store keeps Chromium's actual format intact —
// we only validate that an uploaded bundle IS a well-formed MV3 extension, we
// don't rewrite it. Pure (no I/O) so it's trivially unit-testable.

export interface ParsedManifest {
  manifest_version: number;
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  icons?: Record<string, string>;
  homepage_url?: string;
  [k: string]: unknown;
}

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: ParsedManifest | undefined;
  /** Slug derived from the manifest name (url-safe). */
  slug?: string | undefined;
  /** Union of `permissions` + `host_permissions` for display + scanning. */
  permissions: string[];
}

// Permissions that grant broad reach — surfaced as warnings so reviewers and
// the scan can weight them. Not blocking; MV3 is allowed to request these.
const SENSITIVE_PERMISSIONS = new Set([
  'debugger', 'proxy', 'webRequest', 'webRequestBlocking', 'declarativeNetRequest',
  'cookies', 'history', 'management', 'nativeMessaging', 'tabs', 'scripting',
  'downloads', 'clipboardRead', 'desktopCapture', 'privacy',
]);

const SEMVER_LIKE = /^\d+(\.\d+){0,3}$/; // Chromium allows 1-4 dot-separated integers

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64) || 'extension';
}

/** Parse + validate a manifest.json string or object against MV3 rules. */
export function validateManifest(input: string | unknown): ManifestValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const permissions: string[] = [];

  let m: any;
  if (typeof input === 'string') {
    try {
      m = JSON.parse(input);
    } catch (e: any) {
      return { ok: false, errors: [`manifest.json is not valid JSON: ${e.message}`], warnings, permissions };
    }
  } else {
    m = input;
  }

  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    return { ok: false, errors: ['manifest must be a JSON object'], warnings, permissions };
  }

  if (m.manifest_version !== 3) {
    errors.push(
      m.manifest_version == null
        ? 'manifest_version is required and must be 3'
        : `manifest_version must be 3 (got ${JSON.stringify(m.manifest_version)}) — the store is MV3-only`,
    );
  }
  if (typeof m.name !== 'string' || !m.name.trim()) {
    errors.push('name is required (non-empty string)');
  }
  if (typeof m.version !== 'string' || !SEMVER_LIKE.test(m.version)) {
    errors.push('version is required and must be 1-4 dot-separated integers (e.g. "1.0.0")');
  }

  // MV3 background must be a service worker, never a persistent page.
  if (m.background) {
    if (m.background.scripts || m.background.page || m.background.persistent) {
      errors.push('background must use a service_worker in MV3 (no background.scripts/page/persistent)');
    } else if (typeof m.background.service_worker !== 'string') {
      warnings.push('background present but has no service_worker entry');
    }
  }

  // MV2-only keys that signal a mis-converted extension.
  if (m.browser_action) errors.push('browser_action is MV2 — use "action" in MV3');
  if (m.page_action) errors.push('page_action is MV2 — use "action" in MV3');
  if (typeof m.web_accessible_resources !== 'undefined' && !Array.isArray(m.web_accessible_resources)) {
    errors.push('web_accessible_resources must be an array of {resources, matches} objects in MV3');
  }

  const perms = Array.isArray(m.permissions) ? m.permissions.filter((p: unknown) => typeof p === 'string') : [];
  const hostPerms = Array.isArray(m.host_permissions) ? m.host_permissions.filter((p: unknown) => typeof p === 'string') : [];
  permissions.push(...perms, ...hostPerms);

  for (const p of perms) {
    if (SENSITIVE_PERMISSIONS.has(p)) warnings.push(`requests sensitive permission: ${p}`);
  }
  if (hostPerms.includes('<all_urls>') || hostPerms.some((h: string) => h === '*://*/*')) {
    warnings.push('requests host access to all URLs (<all_urls>)');
  }

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings,
    permissions,
    manifest: ok ? (m as ParsedManifest) : undefined,
    slug: ok ? slugify(m.name) : undefined,
  };
}

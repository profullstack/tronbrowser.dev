// CRX auto-ingest: a .crx (Chromium extension package) is `Cr24` + a signed
// protobuf header + a ZIP. We parse it to auto-fill a listing from the
// extension's own manifest.json + icons — so publishers don't fill out forms.
//
// Pure parsing (fetch is separate + guarded) so it's unit-testable.
import { unzipSync, strFromU8 } from 'fflate';

export interface IngestedListing {
  name: string;
  summary: string | null;
  description: string | null;
  version: string;
  manifestVersion: number;
  /** union of permissions + host_permissions */
  permissions: string[];
  /** the raw manifest.json text (what the version record stores) */
  manifestJson: string;
  /** largest icon as a data: URI, or null if the crx has none */
  iconDataUri: string | null;
}

const CRX_MAGIC = 'Cr24';
const MAX_ICON_BYTES = 512 * 1024; // don't inline absurd icons as data URIs

/** Extract the embedded ZIP from a CRX2/CRX3 buffer. */
export function crxToZip(buf: Uint8Array): Uint8Array {
  if (buf.length < 16 || strFromU8(buf.slice(0, 4)) !== CRX_MAGIC) {
    throw new Error('not a .crx file (missing Cr24 magic)');
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = dv.getUint32(4, true);
  if (version === 2) {
    // CRX2: magic(4) ver(4) pubKeyLen(4) sigLen(4) then key+sig then zip.
    const pubKeyLen = dv.getUint32(8, true);
    const sigLen = dv.getUint32(12, true);
    return buf.slice(16 + pubKeyLen + sigLen);
  }
  if (version === 3) {
    // CRX3: magic(4) ver(4) headerLen(4) then header then zip.
    const headerLen = dv.getUint32(8, true);
    return buf.slice(12 + headerLen);
  }
  throw new Error(`unsupported CRX version ${version}`);
}

function iconToDataUri(path: string, bytes: Uint8Array): string | null {
  if (!bytes || bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null;
  const ext = path.toLowerCase().split('.').pop() || '';
  const mime =
    ext === 'png' ? 'image/png' :
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    ext === 'svg' ? 'image/svg+xml' :
    ext === 'webp' ? 'image/webp' :
    ext === 'gif' ? 'image/gif' : null;
  if (!mime) return null;
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${b64}`;
}

/** Pick the highest-resolution icon declared in the manifest. */
function pickIcon(manifest: any, files: Record<string, Uint8Array>): string | null {
  const icons: Record<string, string> = manifest.icons || {};
  const bySize = Object.keys(icons)
    .map((k) => [parseInt(k, 10) || 0, icons[k]] as const)
    .filter((e): e is readonly [number, string] => typeof e[1] === 'string')
    .sort((a, b) => b[0] - a[0]);
  for (const [, rel] of bySize) {
    const path = rel.replace(/^\.?\//, '');
    if (files[path]) {
      const uri = iconToDataUri(path, files[path]);
      if (uri) return uri;
    }
  }
  return null;
}

/** Parse a .crx buffer into an auto-filled listing draft. */
export function extractListingFromCrx(buf: Uint8Array): IngestedListing {
  const files = unzipSync(crxToZip(buf), { filter: (f) => !f.name.endsWith('/') });
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new Error('crx has no manifest.json');
  const manifestJson = strFromU8(manifestBytes);
  let manifest: any;
  try {
    manifest = JSON.parse(manifestJson);
  } catch (e: any) {
    throw new Error(`manifest.json is not valid JSON: ${e.message}`);
  }
  if (manifest.manifest_version !== 3) {
    throw new Error(`the store is MV3-only (crx manifest_version = ${manifest.manifest_version})`);
  }
  const permissions: string[] = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ].filter((p) => typeof p === 'string');

  const description: string | null = typeof manifest.description === 'string' ? manifest.description : null;
  return {
    name: String(manifest.name || '').trim(),
    summary: description ? description.slice(0, 140) : null,
    description,
    version: String(manifest.version || ''),
    manifestVersion: 3,
    permissions: [...new Set(permissions)],
    manifestJson,
    iconDataUri: pickIcon(manifest, files),
  };
}

/** Download a .crx over http(s) with guards. */
export async function fetchCrx(url: string, maxBytes = 25 * 1024 * 1024): Promise<Uint8Array> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('crxUrl must be a valid URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('crxUrl must be http(s)');
  }
  const res = await fetch(u, { redirect: 'follow' });
  if (!res.ok) throw new Error(`could not fetch crx (${res.status})`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) throw new Error('crx is too large');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('crx is too large');
  return buf;
}

/** Download a .crx and extract its listing. */
export async function ingestCrxUrl(url: string): Promise<IngestedListing> {
  return extractListingFromCrx(await fetchCrx(url));
}

// One-shot, run by hand at the seal-v2 cutover:
//   docker exec <app> bun /api/dist/store/prepack-legacy.js
//
// Downloads used to be packed on the fly with CRX_KEY_SECRET. The store no
// longer packs on download, so each listing whose key is still legacy gets its
// current release packed ONCE here and stored, keeping installs and updates
// working until the publisher sets a signing passphrase (which migrates the key
// and signs every later release while they are present). Prints counts only.
// Refuses when LEGACY_KEY_MIGRATION=off.
import { db } from '../db.js';
import { fetchArtifact, artifactToZip, stampUpdateUrl } from './crx.js';
import { latestSignedCrx, latestVersion, saveSignedCrx, unmigratedSigningKeyCount } from './db.js';
import { legacyDecryptPrivateKey, legacyMigrationEnabled, packCrx, isSealedKey } from './signing.js';

const APP_URL = process.env.APP_URL || 'https://tronbrowser.dev';

async function main(): Promise<void> {
  if (!legacyMigrationEnabled()) throw new Error('LEGACY_KEY_MIGRATION=off: nothing to do');
  const r = await db().execute({
    sql: 'SELECT k.extension_id, k.public_key_der, k.private_key_enc FROM extension_signing_keys k',
    args: [],
  });
  let packed = 0;
  let skipped = 0;
  for (const row of r.rows as unknown as { extension_id: string; public_key_der: string; private_key_enc: string }[]) {
    if (isSealedKey(row.private_key_enc)) { skipped++; continue; }
    const ver = await latestVersion(row.extension_id);
    const have = await latestSignedCrx(row.extension_id);
    if (!ver || have?.version_id === ver.id) { skipped++; continue; }
    const url = ver.crx_url || ver.bundle_url;
    if (!url) { skipped++; continue; }
    const zip = stampUpdateUrl(artifactToZip(await fetchArtifact(url)), `${APP_URL}/api/store/updates.xml?id=${row.extension_id}`);
    let pem: string | null = legacyDecryptPrivateKey(row.private_key_enc);
    const crx = packCrx(zip, pem, Buffer.from(row.public_key_der, 'base64'));
    pem = null;
    await saveSignedCrx({ versionId: ver.id, extensionId: row.extension_id, version: ver.version, crx });
    packed++;
  }
  console.log(JSON.stringify({ packed, skipped, unmigrated_keys: await unmigratedSigningKeyCount() }));
}

main().then(() => process.exit(0), (e) => { console.error(String(e?.message || e)); process.exit(1); });

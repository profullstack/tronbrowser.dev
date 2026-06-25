// files.profullstack.com integration — the AgentBBS Files area is the store's
// FOSS, self-hosted blob host (replaces the lost Supabase storage). Publishers
// upload .crx/.zip over SFTP; we host + serve them. This module:
//   - provisions a BBS member from the publisher's SSH public key (full-auto:
//     SSH to the BBS host and run `agentbbs provision-user`)
//   - optionally generates an ed25519 keypair for them (private key shown once)
//   - builds the public download URL and verifies an artifact is actually up
//
// Dependency-free: node:child_process + node:crypto + fetch. Needs the
// `openssh-client` package in the image (ssh, ssh-keygen) — see Dockerfile.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const PUBLIC_BASE = (process.env.FILES_PUBLIC_BASE || 'https://files.profullstack.com').replace(/\/$/, '');
export const SCP_TARGET = process.env.FILES_SCP_TARGET || 'files@files.profullstack.com';

/** Public HTTPS URL for a published artifact, mirroring the SFTP /public path. */
export function publicUrlFor(slug: string, file: string): string {
  return `${PUBLIC_BASE}/public/extensions/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`;
}

/** The exact scp line we show a publisher for a given slug. */
export function scpCommand(slug: string, file = 'dist.crx'): string {
  return `scp ${file} ${SCP_TARGET}:/public/extensions/${slug}/`;
}

export interface ProvisionResult {
  ok: boolean;
  name: string;
  fingerprint: string;
}

/**
 * Provision (or confirm) a BBS member from an SSH public key by SSHing to the
 * BBS host and running the agentbbs CLI. Configured via env:
 *   BBS_SSH_HOST, BBS_SSH_USER (operator), BBS_SSH_KEY (private key path),
 *   BBS_SSH_PORT (default 22), AGENTBBS_BIN (default "agentbbs").
 * Throws 'provisioning not configured' when unset so the caller can fall back to
 * manual instructions.
 */
export async function provisionPublisher(handle: string, pubkey: string): Promise<ProvisionResult> {
  const host = process.env.BBS_SSH_HOST;
  const user = process.env.BBS_SSH_USER;
  const keyPath = process.env.BBS_SSH_KEY;
  if (!host || !user || !keyPath) throw new Error('provisioning not configured');

  const port = process.env.BBS_SSH_PORT || '22';
  const bin = process.env.AGENTBBS_BIN || 'agentbbs';
  // Pass the pubkey as a single argv element (no shell) — execFile doesn't use a
  // shell, so the key text can't be interpreted. The remote command is run by
  // ssh; we quote the pubkey for the remote shell.
  const remote = `${bin} provision-user --name ${shellQuote(handle)} --pubkey ${shellQuote(pubkey)}`;
  const args = [
    '-i', keyPath,
    '-p', port,
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${user}@${host}`,
    remote,
  ];
  const { stdout } = await exec('ssh', args, { timeout: 20_000 });
  const out = JSON.parse(stdout.trim());
  if (!out.ok) throw new Error('provisioning failed');
  return { ok: true, name: out.name, fingerprint: out.fingerprint };
}

/** Generate an ed25519 keypair via ssh-keygen. Private key is returned, never stored. */
export async function generateKeypair(comment: string): Promise<{ publicKey: string; privateKey: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'tbkey-'));
  try {
    const keyFile = join(dir, 'id_ed25519');
    await exec('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', comment, '-f', keyFile], { timeout: 15_000 });
    return {
      privateKey: readFileSync(keyFile, 'utf8'),
      publicKey: readFileSync(`${keyFile}.pub`, 'utf8').trim(),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** HEAD-check that an uploaded artifact is actually reachable before going live. */
export async function artifactExists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

// Minimal POSIX single-quote escaping for the remote shell command string.
function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

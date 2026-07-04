/**
 * Injectable side-effects for the SDK (PRD M3.4). The public `tron.launch` uses
 * the real defaults below; tests inject fakes to exercise Browser/Page without a
 * real browser. Launch reuses the M3.1 `tron-session` engine (resolved via
 * TRON_SESSION_BIN, which `tron run` sets) so binary resolution isn't duplicated.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  CdpClient,
  cdpListUrl,
  descriptorPath,
  parseDescriptor,
  type CdpConnection,
  type CdpTarget,
  type SessionDescriptor,
} from '@tronbrowser/browser-core';

const execFileP = promisify(execFile);

export interface LaunchArgs {
  headless: boolean;
  profile?: string;
}

export interface SdkDeps {
  makeDataDir(): Promise<string>;
  removeDataDir(dir: string): Promise<void>;
  launchSession(dataDir: string, args: LaunchArgs): Promise<void>;
  closeSession(dataDir: string): Promise<void>;
  loadDescriptor(dataDir: string): Promise<SessionDescriptor>;
  fetchTargets(host: string, port: number): Promise<CdpTarget[]>;
  connect(wsUrl: string): Promise<CdpConnection>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
}

function sessionBin(): string {
  const bin = process.env.TRON_SESSION_BIN ?? process.env.TRONBROWSER_SESSION_BIN;
  if (!bin) {
    throw new Error(
      'The SDK needs the managed-session engine. Run scripts with `tron run`, or set TRON_SESSION_BIN.',
    );
  }
  return bin;
}

export const defaultDeps: SdkDeps = {
  makeDataDir: () => mkdtemp(join(tmpdir(), 'tron-sdk-')),
  removeDataDir: (dir) => rm(dir, { recursive: true, force: true }),
  async launchSession(dataDir, args) {
    const argv = ['browser', 'launch'];
    if (args.headless) argv.push('--headless');
    if (args.profile) argv.push('--profile', args.profile);
    await execFileP(sessionBin(), argv, { env: { ...process.env, TRONBROWSER_DATA: dataDir } });
  },
  async closeSession(dataDir) {
    await execFileP(sessionBin(), ['browser', 'close'], {
      env: { ...process.env, TRONBROWSER_DATA: dataDir },
    });
  },
  async loadDescriptor(dataDir) {
    return parseDescriptor(await readFile(descriptorPath(dataDir), 'utf8'));
  },
  async fetchTargets(host, port) {
    const res = await fetch(cdpListUrl({ host, port }));
    if (!res.ok) throw new Error(`DevTools /json/list returned ${res.status}`);
    return (await res.json()) as CdpTarget[];
  },
  connect: (wsUrl) => CdpClient.connect(wsUrl),
  writeBytes: (path, bytes) => writeFile(path, bytes),
};

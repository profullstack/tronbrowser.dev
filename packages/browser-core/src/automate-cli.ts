/**
 * `tron-automate` — Node entrypoint for the CDP-driven automation subcommands
 * the shell `tron` dispatcher delegates to (PRD M3.2):
 *
 *   tron snapshot [--json] [--include-hidden]
 *   tron click <ref>
 *   tron fill <ref> <value>
 *
 * It attaches to the M3.1-managed session via its descriptor + the page target's
 * webSocketDebuggerUrl. Dependencies (descriptor read, target fetch, CDP connect)
 * are injectable so the command layer is testable without a real browser.
 */
import { readFile } from 'node:fs/promises';
import { CdpClient, type CdpConnection } from './automation/cdp-client.js';
import { cdpListUrl } from './automation/cdp.js';
import {
  descriptorPath,
  parseDescriptor,
  resolveDataDir,
} from './automation/descriptor.js';
import {
  captureSnapshot,
  clickRef,
  enableRuntime,
  fillRef,
  formatSnapshotText,
  StaleRefError,
} from './automation/page.js';
import { resolvePageWsUrl } from './automation/page-target.js';
import type { SessionDescriptor, CdpTarget } from './automation/types.js';

/** Process exit codes shared with the shell dispatcher. */
export const EXIT = {
  ok: 0,
  usage: 2,
  noSession: 4,
  staleRef: 5,
  failed: 1,
} as const;

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  loadDescriptor(path: string): Promise<SessionDescriptor>;
  fetchTargets(listUrl: string): Promise<CdpTarget[]>;
  connect(wsUrl: string): Promise<CdpConnection>;
  out(text: string): void;
  err(text: string): void;
}

const defaultDeps: CliDeps = {
  env: process.env,
  async loadDescriptor(path) {
    return parseDescriptor(await readFile(path, 'utf8'));
  },
  async fetchTargets(listUrl) {
    const res = await fetch(listUrl);
    if (!res.ok) throw new Error(`DevTools /json/list returned ${res.status}`);
    return (await res.json()) as CdpTarget[];
  },
  connect: (wsUrl) => CdpClient.connect(wsUrl),
  out: (t) => process.stdout.write(t + '\n'),
  err: (t) => process.stderr.write(t + '\n'),
};

/** Attach to the current page of the managed session, or throw a coded error. */
async function attach(deps: CliDeps): Promise<CdpConnection> {
  const dataDir = resolveDataDir(deps.env);
  let descriptor: SessionDescriptor;
  try {
    descriptor = await deps.loadDescriptor(descriptorPath(dataDir));
  } catch {
    const e = new Error('No managed session. Run: tron browser launch') as Error & { exit?: number };
    e.exit = EXIT.noSession;
    throw e;
  }
  const targets = await deps.fetchTargets(
    cdpListUrl({ host: descriptor.host, port: descriptor.port }),
  );
  const wsUrl = resolvePageWsUrl(targets, descriptor.activeTabId);
  const conn = await deps.connect(wsUrl);
  await enableRuntime(conn);
  return conn;
}

export async function run(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...defaultDeps, ...overrides };
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help') {
    deps.out('usage: tron snapshot [--json] [--include-hidden] | click <ref> | fill <ref> <value>');
    return EXIT.ok;
  }

  let conn: CdpConnection | undefined;
  try {
    switch (command) {
      case 'snapshot': {
        const json = rest.includes('--json');
        const includeHidden = rest.includes('--include-hidden');
        conn = await attach(deps);
        const snap = await captureSnapshot(conn, includeHidden ? { includeHidden } : {});
        deps.out(json ? JSON.stringify(snap, null, 2) : formatSnapshotText(snap));
        return EXIT.ok;
      }
      case 'click': {
        const ref = rest[0];
        if (!ref) {
          deps.err('usage: tron click <ref>');
          return EXIT.usage;
        }
        conn = await attach(deps);
        const res = await clickRef(conn, ref);
        deps.out(`clicked ${res.ref}`);
        return EXIT.ok;
      }
      case 'fill': {
        const ref = rest[0];
        const value = rest[1];
        if (!ref || value === undefined) {
          deps.err('usage: tron fill <ref> <value>');
          return EXIT.usage;
        }
        conn = await attach(deps);
        const res = await fillRef(conn, ref, value);
        deps.out(`filled ${res.ref}`);
        return EXIT.ok;
      }
      default:
        deps.err(`unknown automation command: ${command}`);
        return EXIT.usage;
    }
  } catch (err) {
    if (err instanceof StaleRefError) {
      deps.err(err.message);
      return EXIT.staleRef;
    }
    const coded = err as Error & { exit?: number };
    deps.err(`tron: ${coded.message}`);
    return typeof coded.exit === 'number' ? coded.exit : EXIT.failed;
  } finally {
    conn?.close();
  }
}

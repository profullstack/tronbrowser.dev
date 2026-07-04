/**
 * `tron-automate` — Node entrypoint for the CDP-driven automation subcommands
 * the shell `tron` dispatcher delegates to (PRD M3.2 + M3.3):
 *
 *   tron snapshot [--json] [--include-hidden]
 *   tron click <ref> | fill <ref> <value>
 *   tron extract <text|links|forms|tables|main|selector> [--field n=sel[@attr]]
 *   tron screenshot <path> [--full-page] | tron pdf <path>
 *   tron headless <url> [--snapshot|--screenshot <path>|--pdf <path>|--extract <mode>] [--json]
 *
 * It attaches to the M3.1-managed session via its descriptor + the page target's
 * webSocketDebuggerUrl. Dependencies (descriptor read, target fetch, CDP connect,
 * one-shot session launch/close, byte writes) are injectable so the command layer
 * is testable without a real browser.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CdpClient, type CdpConnection } from './automation/cdp-client.js';
import { cdpListUrl } from './automation/cdp.js';
import { descriptorPath, parseDescriptor, resolveDataDir } from './automation/descriptor.js';
import { printPdf, screenshotPng } from './automation/capture.js';
import { extractExpression, parseFieldSpec, type FieldSpec } from './automation/extract-script.js';
import {
  captureSnapshot,
  clickRef,
  enableRuntime,
  extract,
  fillRef,
  formatSnapshotText,
  goto,
  StaleRefError,
} from './automation/page.js';
import { resolvePageWsUrl } from './automation/page-target.js';
import type { CdpTarget, SessionDescriptor } from './automation/types.js';

const execFileP = promisify(execFile);

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
  launchHeadless(dataDir: string): Promise<void>;
  closeSession(dataDir: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
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
  async launchHeadless(dataDir) {
    const bin = process.env.TRON_SESSION_BIN;
    if (!bin) throw new Error('headless needs the session engine (TRON_SESSION_BIN unset)');
    await execFileP(bin, ['browser', 'launch', '--headless'], {
      env: { ...process.env, TRONBROWSER_DATA: dataDir },
    });
  },
  async closeSession(dataDir) {
    const bin = process.env.TRON_SESSION_BIN;
    if (!bin) return;
    await execFileP(bin, ['browser', 'close'], {
      env: { ...process.env, TRONBROWSER_DATA: dataDir },
    });
  },
  writeBytes: (path, bytes) => writeFile(path, bytes),
  out: (t) => process.stdout.write(t + '\n'),
  err: (t) => process.stderr.write(t + '\n'),
};

/** Attach to the current page of a managed session, or throw a coded error. */
async function attach(deps: CliDeps, dataDir = resolveDataDir(deps.env)): Promise<CdpConnection> {
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
  const conn = await deps.connect(resolvePageWsUrl(targets, descriptor.activeTabId));
  await enableRuntime(conn);
  return conn;
}

/** Collect all `--field name=selector[@attr]` specs from an arg list. */
function collectFields(args: string[]): FieldSpec[] {
  const specs: FieldSpec[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--field' && args[i + 1] !== undefined) {
      specs.push(parseFieldSpec(args[i + 1]!));
      i += 1;
    } else if (a?.startsWith('--field=')) {
      specs.push(parseFieldSpec(a.slice('--field='.length)));
    }
  }
  return specs;
}

/** Value that follows a flag, e.g. valueAfter(args, '--screenshot'). */
function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

type HeadlessOp =
  | { kind: 'snapshot'; json: boolean }
  | { kind: 'extract'; target: string; fields: FieldSpec[] }
  | { kind: 'screenshot'; path: string; fullPage: boolean }
  | { kind: 'pdf'; path: string };

function parseHeadlessOp(args: string[]): HeadlessOp | { error: string } {
  if (args.includes('--screenshot')) {
    const path = valueAfter(args, '--screenshot');
    if (!path) return { error: '--screenshot needs a path' };
    return { kind: 'screenshot', path, fullPage: args.includes('--full-page') };
  }
  if (args.includes('--pdf')) {
    const path = valueAfter(args, '--pdf');
    if (!path) return { error: '--pdf needs a path' };
    return { kind: 'pdf', path };
  }
  if (args.includes('--extract')) {
    const target = valueAfter(args, '--extract');
    if (!target) return { error: '--extract needs a mode or selector' };
    return { kind: 'extract', target, fields: collectFields(args) };
  }
  return { kind: 'snapshot', json: args.includes('--json') };
}

async function runOp(deps: CliDeps, conn: CdpConnection, op: HeadlessOp): Promise<void> {
  switch (op.kind) {
    case 'snapshot': {
      const snap = await captureSnapshot(conn);
      deps.out(op.json ? JSON.stringify(snap, null, 2) : formatSnapshotText(snap));
      return;
    }
    case 'extract': {
      const data = await extract(conn, extractExpression(op.target, op.fields));
      deps.out(JSON.stringify(data, null, 2));
      return;
    }
    case 'screenshot': {
      await deps.writeBytes(op.path, await screenshotPng(conn, { fullPage: op.fullPage }));
      deps.out(`screenshot -> ${op.path}`);
      return;
    }
    case 'pdf': {
      await deps.writeBytes(op.path, await printPdf(conn));
      deps.out(`pdf -> ${op.path}`);
      return;
    }
  }
}

const USAGE =
  'usage: tron snapshot [--json] | click <ref> | fill <ref> <value> | ' +
  'extract <text|links|forms|tables|main|selector> [--field n=sel] | ' +
  'screenshot <path> [--full-page] | pdf <path> | ' +
  'headless <url> [--snapshot|--screenshot <path>|--pdf <path>|--extract <mode>] [--json]';

export async function run(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...defaultDeps, ...overrides };
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help') {
    deps.out(USAGE);
    return EXIT.ok;
  }

  let conn: CdpConnection | undefined;
  try {
    switch (command) {
      case 'snapshot': {
        conn = await attach(deps);
        const snap = await captureSnapshot(
          conn,
          rest.includes('--include-hidden') ? { includeHidden: true } : {},
        );
        deps.out(rest.includes('--json') ? JSON.stringify(snap, null, 2) : formatSnapshotText(snap));
        return EXIT.ok;
      }
      case 'click': {
        const ref = rest[0];
        if (!ref) {
          deps.err('usage: tron click <ref>');
          return EXIT.usage;
        }
        conn = await attach(deps);
        deps.out(`clicked ${(await clickRef(conn, ref)).ref}`);
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
        deps.out(`filled ${(await fillRef(conn, ref, value)).ref}`);
        return EXIT.ok;
      }
      case 'extract': {
        const target = rest.find((a) => !a.startsWith('--'));
        if (!target) {
          deps.err('usage: tron extract <text|links|forms|tables|main|selector> [--field n=sel] [--json]');
          return EXIT.usage;
        }
        conn = await attach(deps);
        const data = await extract(conn, extractExpression(target, collectFields(rest)));
        deps.out(JSON.stringify(data, null, 2));
        return EXIT.ok;
      }
      case 'screenshot': {
        const path = rest.find((a) => !a.startsWith('--'));
        if (!path) {
          deps.err('usage: tron screenshot <path> [--full-page]');
          return EXIT.usage;
        }
        conn = await attach(deps);
        await deps.writeBytes(path, await screenshotPng(conn, { fullPage: rest.includes('--full-page') }));
        deps.out(`screenshot -> ${path}`);
        return EXIT.ok;
      }
      case 'pdf': {
        const path = rest.find((a) => !a.startsWith('--'));
        if (!path) {
          deps.err('usage: tron pdf <path>');
          return EXIT.usage;
        }
        conn = await attach(deps);
        await deps.writeBytes(path, await printPdf(conn));
        deps.out(`pdf -> ${path}`);
        return EXIT.ok;
      }
      case 'headless': {
        const url = rest.find((a) => !a.startsWith('--'));
        if (!url) {
          deps.err('usage: tron headless <url> [--snapshot|--screenshot <path>|--pdf <path>|--extract <mode>] [--json]');
          return EXIT.usage;
        }
        const op = parseHeadlessOp(rest);
        if ('error' in op) {
          deps.err(`usage: ${op.error}`);
          return EXIT.usage;
        }
        const dataDir = await mkdtemp(join(tmpdir(), 'tron-headless-'));
        try {
          await deps.launchHeadless(dataDir);
          conn = await attach(deps, dataDir);
          await goto(conn, url);
          await runOp(deps, conn, op);
          return EXIT.ok;
        } finally {
          conn?.close();
          conn = undefined;
          await deps.closeSession(dataDir).catch(() => {});
          await rm(dataDir, { recursive: true, force: true }).catch(() => {});
        }
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

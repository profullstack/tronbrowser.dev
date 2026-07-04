/**
 * `tron analyze` — the AI-assisted unknown-interface command (PRD §11). Dry-run
 * by default; `--execute` runs a bounded, safety-gated fill loop. Attaches to the
 * managed session and drives it via CDP. Deps are injectable for testing.
 */
import { readFile } from 'node:fs/promises';
import {
  captureSnapshot,
  CdpClient,
  cdpListUrl,
  clickRef,
  descriptorPath,
  enableRuntime,
  extract,
  fillRef,
  parseDescriptor,
  resolveDataDir,
  resolvePageWsUrl,
  type CdpTarget,
  type SessionDescriptor,
} from '@tronbrowser/browser-core';
import { analyze, type AnalyzeBrowser, type AnalyzeOptions } from './analyze/analyze.js';
import { analyzeFormsExpression, type RawFormsResult } from './analyze/form-script.js';
import { formatAnalyzeText } from './analyze/format.js';
import type { Policy } from './analyze/types.js';

export const EXIT = { ok: 0, usage: 2, noSession: 4, notOk: 6, failed: 1 } as const;

const MODES = new Set(['form', 'plan', 'next', 'run']);
const POLICIES = new Set(['safe', 'auto', 'ask']);

export interface AnalyzeCliDeps {
  env: NodeJS.ProcessEnv;
  attach(dataDir: string): Promise<{ browser: AnalyzeBrowser; close(): void }>;
  readData(spec: string): Promise<unknown>;
  out(text: string): void;
  err(text: string): void;
}

async function fetchTargets(host: string, port: number): Promise<CdpTarget[]> {
  const res = await fetch(cdpListUrl({ host, port }));
  if (!res.ok) throw new Error(`DevTools /json/list returned ${res.status}`);
  return (await res.json()) as CdpTarget[];
}

const defaultDeps: AnalyzeCliDeps = {
  env: process.env,
  async attach(dataDir) {
    let descriptor: SessionDescriptor;
    try {
      descriptor = parseDescriptor(await readFile(descriptorPath(dataDir), 'utf8'));
    } catch {
      const e = new Error('No managed session. Run: tron browser launch') as Error & { exit?: number };
      e.exit = EXIT.noSession;
      throw e;
    }
    const targets = await fetchTargets(descriptor.host, descriptor.port);
    const conn = await CdpClient.connect(resolvePageWsUrl(targets, descriptor.activeTabId));
    await enableRuntime(conn);
    const browser: AnalyzeBrowser = {
      snapshot: () => captureSnapshot(conn),
      readForms: () => extract<RawFormsResult>(conn, analyzeFormsExpression()),
      fill: async (ref, value) => {
        await fillRef(conn, ref, value);
      },
      click: async (ref) => {
        await clickRef(conn, ref);
      },
    };
    return { browser, close: () => conn.close() };
  },
  async readData(spec) {
    if (spec === '-') return JSON.parse(await readStdin());
    const trimmed = spec.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
    return JSON.parse(await readFile(spec, 'utf8'));
  },
  out: (t) => process.stdout.write(t + '\n'),
  err: (t) => process.stderr.write(t + '\n'),
};

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function run(argv: string[], overrides: Partial<AnalyzeCliDeps> = {}): Promise<number> {
  const deps: AnalyzeCliDeps = { ...defaultDeps, ...overrides };
  const json = argv.includes('--json');

  // First positional is a goal, unless it's a bare mode keyword.
  const positional = argv.find((a) => !a.startsWith('--'));
  const goal = positional && !MODES.has(positional) ? positional : undefined;

  const options: AnalyzeOptions = {
    ...(goal ? { goal } : {}),
    execute: argv.includes('--execute') && !argv.includes('--dry-run'),
    noSubmit: argv.includes('--no-submit'),
    allowSubmit: argv.includes('--allow-submit'),
  };
  const policy = valueAfter(argv, '--policy');
  if (policy) {
    if (!POLICIES.has(policy)) {
      deps.err(`usage: --policy must be safe|auto|ask`);
      return EXIT.usage;
    }
    options.policy = policy as Policy;
  }
  const maxSteps = valueAfter(argv, '--max-steps');
  if (maxSteps) options.maxSteps = Number(maxSteps);

  const dataSpec = valueAfter(argv, '--data');
  if (dataSpec) {
    try {
      options.data = await deps.readData(dataSpec);
    } catch (err) {
      deps.err(`tron analyze: could not read --data: ${(err as Error).message}`);
      return EXIT.usage;
    }
  }

  let session: { browser: AnalyzeBrowser; close(): void } | undefined;
  try {
    session = await deps.attach(resolveDataDir(deps.env));
    const result = await analyze(session.browser, options);
    deps.out(json ? JSON.stringify(result, null, 2) : formatAnalyzeText(result));
    return result.ok ? EXIT.ok : EXIT.notOk;
  } catch (err) {
    const coded = err as Error & { exit?: number };
    deps.err(`tron: ${coded.message}`);
    return typeof coded.exit === 'number' ? coded.exit : EXIT.failed;
  } finally {
    session?.close();
  }
}

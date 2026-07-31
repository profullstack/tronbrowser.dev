/**
 * Page-level automation over a CDP connection (PRD M3.2): evaluate the snapshot
 * and ref-action scripts, parse their results, and surface a recoverable
 * STALE_REF error when a ref no longer resolves.
 */
import type { CdpConnection } from './cdp-client.js';
import {
  clickExpression,
  fillExpression,
  normalizeRef,
  type ActionResult,
} from './action-script.js';
import {
  snapshotExpression,
  type AgentSnapshot,
  type SnapshotElement,
  type SnapshotOptions,
} from './snapshot-script.js';

/** A ref no longer resolves in the page; the caller should re-snapshot. */
export class StaleRefError extends Error {
  readonly ref: string;
  readonly code = 'STALE_REF' as const;
  readonly recoverable = true;
  constructor(ref: string) {
    super(
      `Ref ${ref} not found on the page — it may be stale. Run \`tron snapshot\` and use a current ref.`,
    );
    this.name = 'StaleRefError';
    this.ref = ref;
  }
}

interface EvalResult {
  result?: { value?: unknown };
  exceptionDetails?: { exception?: { description?: string }; text?: string };
}

/** Evaluate an expression in the page and return its by-value result. */
async function evaluate<T>(conn: CdpConnection, expression: string): Promise<T> {
  const res = await conn.send<EvalResult>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    const detail =
      res.exceptionDetails.exception?.description ??
      res.exceptionDetails.text ??
      'evaluation failed';
    throw new Error(`Page evaluation failed: ${detail}`);
  }
  return res.result?.value as T;
}

/** Enable the CDP Runtime domain (idempotent) before evaluating. */
export async function enableRuntime(conn: CdpConnection): Promise<void> {
  await conn.send('Runtime.enable');
}

/** Navigate the page to `url` and wait for load (or `timeoutMs`). */
export async function goto(
  conn: CdpConnection,
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  await conn.send('Page.enable');
  const loaded = new Promise<void>((resolve) => conn.on('Page.loadEventFired', () => resolve()));
  await conn.send('Page.navigate', { url });
  await Promise.race([
    loaded,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** Run the extraction expression and return its deterministic JSON value. */
export async function extract<T = unknown>(conn: CdpConnection, expression: string): Promise<T> {
  return evaluate<T>(conn, expression);
}

/** Capture a structured, ref-tagged snapshot of the current page. */
export async function captureSnapshot(
  conn: CdpConnection,
  options: SnapshotOptions = {},
): Promise<AgentSnapshot> {
  return evaluate<AgentSnapshot>(conn, snapshotExpression(options));
}

/** Click the element referenced by `ref` (throws StaleRefError if gone). */
export async function clickRef(conn: CdpConnection, ref: string): Promise<ActionResult> {
  const result = await evaluate<ActionResult>(conn, clickExpression(ref));
  if (!result.ok && result.error === 'STALE_REF') throw new StaleRefError(`@${normalizeRef(ref)}`);
  return result;
}

/** Fill the element referenced by `ref` with `value` (throws StaleRefError if gone). */
export async function fillRef(
  conn: CdpConnection,
  ref: string,
  value: string,
): Promise<ActionResult> {
  const result = await evaluate<ActionResult>(conn, fillExpression(ref, value));
  if (!result.ok && result.error === 'STALE_REF') throw new StaleRefError(`@${normalizeRef(ref)}`);
  return result;
}

/** Render a snapshot as compact text (the default `tron snapshot` output). */
export function formatSnapshotText(snapshot: AgentSnapshot): string {
  const lines: string[] = [
    `Page: ${snapshot.title || '(untitled)'}`,
    `URL: ${snapshot.url}`,
    '',
  ];
  for (const el of snapshot.elements) {
    lines.push(formatElementLine(el));
  }
  if (snapshot.elements.length === 0) lines.push('(no interactive elements)');
  return lines.join('\n');
}

function formatElementLine(el: SnapshotElement): string {
  let line = `${el.ref} ${el.role} ${JSON.stringify(el.name)}`;
  if (el.value !== undefined && el.value !== '') line += ` = ${JSON.stringify(el.value)}`;
  if (el.href) line += ` -> ${el.href}`;
  return line;
}

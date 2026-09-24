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
  if (!result.ok) throw new Error(`Cannot fill @${normalizeRef(ref)}: ${result.message ?? result.error ?? 'failed'}`);
  return result;
}

/** Resolve a ref to a remote object id (throws StaleRefError if gone). */
async function refObjectId(conn: CdpConnection, ref: string): Promise<string> {
  const bare = normalizeRef(ref);
  const res = await conn.send<{ result?: { objectId?: string; subtype?: string } }>('Runtime.evaluate', {
    expression: `document.querySelector('[data-tron-ref=' + ${JSON.stringify(JSON.stringify(bare))} + ']')`,
    returnByValue: false,
  });
  const objectId = res.result?.subtype === 'null' ? undefined : res.result?.objectId;
  if (!objectId) throw new StaleRefError(`@${bare}`);
  return objectId;
}

/**
 * Set the files of an `<input type=file>` by ref. Forms usually hide the real
 * input behind an "Attach" button, which is why snapshots always list file
 * inputs. `DOM.setFileInputFiles` fires input/change like a real pick.
 */
export async function uploadRef(conn: CdpConnection, ref: string, files: string[]): Promise<ActionResult> {
  const objectId = await refObjectId(conn, ref);
  const isFile = await conn.send<{ result?: { value?: boolean } }>('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function () { return this instanceof HTMLInputElement && this.type === "file"; }',
    returnByValue: true,
  });
  if (!isFile.result?.value) throw new Error(`Ref @${normalizeRef(ref)} is not a file input`);
  await conn.send('DOM.setFileInputFiles', { objectId, files });
  return { ok: true, ref: `@${normalizeRef(ref)}` };
}

const KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

/** CDP key-event params for a key name (`Enter`, `ArrowDown`) or one character. */
export function keyEventParams(key: string): { key: string; code: string; keyCode: number; text?: string } {
  const known = KEYS[key];
  if (known) return known;
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const code = /[A-Z]/.test(upper) ? `Key${upper}` : /[0-9]/.test(key) ? `Digit${key}` : '';
    return { key, code, keyCode: upper.charCodeAt(0), text: key };
  }
  throw new Error(`Unknown key "${key}" (use Enter, Tab, Escape, Backspace, Space, Arrow*, or one character)`);
}

/**
 * Press a key on the focused element with trusted input events. A synthetic
 * `KeyboardEvent` is `isTrusted: false`, and comboboxes (react-select and
 * friends) ignore it, so Enter to pick an option did nothing.
 */
export async function pressKey(conn: CdpConnection, key: string): Promise<void> {
  const k = keyEventParams(key);
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
  await conn.send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text ? { text: k.text } : {}) });
  await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/** A trusted left click at viewport coordinates (move, press, release). */
export async function mouseClick(conn: CdpConnection, x: number, y: number): Promise<void> {
  await conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await conn.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await conn.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

const refQuery = (bare: string) => `document.querySelector('[data-tron-ref=' + ${JSON.stringify(JSON.stringify(bare))} + ']')`;

/**
 * Choose `value` in the control at `ref`. A native `<select>` matches an
 * option's value or visible text. Anything else is treated as a custom
 * combobox (ARIA listbox, react-select, ATS pickers): open it, type the value
 * to filter when it is a text input, then click the visible `[role=option]`
 * whose text matches.
 */
export async function selectRef(
  conn: CdpConnection,
  ref: string,
  value: string,
  options: { timeoutMs?: number } = {},
): Promise<ActionResult & { chosen?: string | undefined }> {
  const bare = normalizeRef(ref);
  const want = JSON.stringify(value.trim().toLowerCase());
  const native = await evaluate<{ ok: boolean; error?: string; chosen?: string; custom?: boolean }>(conn, `(() => {
  const el = ${refQuery(bare)};
  if (!el) return { ok: false, error: 'STALE_REF' };
  if (el.tagName !== 'SELECT') return { ok: false, custom: true };
  const want = ${want};
  const t = (o) => o.text.trim().toLowerCase();
  const opt = [...el.options].find((o) => o.value.toLowerCase() === want) || [...el.options].find((o) => t(o) === want) || [...el.options].find((o) => t(o).startsWith(want));
  if (!opt) return { ok: false, error: 'NO_OPTION' };
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, chosen: opt.text.trim() };
})()`);
  if (native.error === 'STALE_REF') throw new StaleRefError(`@${bare}`);
  if (native.ok) return { ok: true, ref: `@${bare}`, chosen: native.chosen };
  if (!native.custom) throw new Error(`No option matching "${value}" in @${bare}`);

  // Custom widgets (react-select and friends) open on a real mousedown and
  // filter on real key input; synthetic events leave the menu closed. So this
  // path uses trusted CDP input throughout.
  const box = await evaluate<{ x: number; y: number; typeable: boolean } | null>(conn, `(() => {
  const el = ${refQuery(bare)};
  if (!el) return null;
  // 'instant': with scroll-behavior:smooth (Greenhouse sets it) the default
  // animates, the rect is read mid-scroll, and the click lands off-screen.
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const typeable = el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type);
  return { x: r.left + Math.max(1, Math.min(r.width / 2, 12)), y: r.top + r.height / 2, typeable };
})()`);
  if (!box) throw new StaleRefError(`@${bare}`);
  if (box.y < 0 || box.x < 0) throw new Error(`@${bare} is outside the viewport; cannot open it`);
  await mouseClick(conn, box.x, box.y);
  if (box.typeable) {
    await evaluate(conn, `(() => { const el = ${refQuery(bare)}; if (el) { el.focus(); el.select && el.select(); } })()`);
    await conn.send('Input.insertText', { text: value });
  }
  const find = `(() => {
  const want = ${want};
  const text = (o) => (o.textContent || '').replace(/\\s+/g, ' ').trim();
  const opts = [...document.querySelectorAll('[role=option], [role=menuitemradio]')].filter((o) => { const r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const hit = opts.find((o) => text(o).toLowerCase() === want) || opts.find((o) => text(o).toLowerCase().startsWith(want)) || opts.find((o) => text(o).toLowerCase().includes(want));
  if (!hit) return { ok: false, seen: opts.slice(0, 12).map(text) };
  hit.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  const r = hit.getBoundingClientRect();
  return { ok: true, chosen: text(hit), x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;
  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  let last: { ok: boolean; chosen?: string; seen?: string[]; x?: number; y?: number } = { ok: false };
  for (;;) {
    last = await evaluate(conn, find);
    if (last.ok && last.x !== undefined && last.y !== undefined) {
      await mouseClick(conn, last.x, last.y);
      return { ok: true, ref: `@${bare}`, chosen: last.chosen };
    }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `No option matching "${value}" appeared for @${bare}` + (last.seen?.length ? ` (saw: ${last.seen.join(' | ')})` : ''),
  );
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
  if (el.required) line += ' [required]';
  if (el.value !== undefined && el.value !== '') line += ` = ${JSON.stringify(el.value)}`;
  if (el.href) line += ` -> ${el.href}`;
  return line;
}

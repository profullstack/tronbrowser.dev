/**
 * In-page scripts for ref-based actions (PRD M3.2): click, fill, type.
 *
 * Each resolves the ref via its `data-tron-ref` attribute (set by the last
 * snapshot). A missing element returns `{ok:false, error:'STALE_REF'}` so the
 * caller can raise a recoverable error telling the agent to re-snapshot, rather
 * than acting on the wrong node.
 */

/** A `data-tron-ref` value: strip a leading `@`, require the `e<number>` form. */
export function normalizeRef(ref: string): string {
  const trimmed = ref.trim();
  const bare = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (!/^e[0-9]+$/.test(bare)) {
    throw new Error(`Not a snapshot ref: "${ref}" (expected @e1, @e2, …)`);
  }
  return bare;
}

/** Shared prelude: resolve `ref` to an element or bail with STALE_REF. */
function resolvePrelude(ref: string): string {
  const bare = normalizeRef(ref);
  return `const el = document.querySelector('[data-tron-ref=' + ${JSON.stringify(
    JSON.stringify(bare),
  )} + ']');
  if (!el) return { ok: false, error: 'STALE_REF', ref: ${JSON.stringify('@' + bare)} };`;
}

/** Click the element referenced by `ref`. */
export function clickExpression(ref: string): string {
  return `(() => {
  ${resolvePrelude(ref)}
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.click();
  return { ok: true, ref: ${JSON.stringify('@' + normalizeRef(ref))} };
})()`;
}

/** Fill an input/textarea/contenteditable referenced by `ref` with `value`. */
export function fillExpression(ref: string, value: string): string {
  return `(() => {
  ${resolvePrelude(ref)}
  const value = ${JSON.stringify(value)};
  el.scrollIntoView({ block: 'center', inline: 'center' });
  if (el.isContentEditable) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, ref: ${JSON.stringify('@' + normalizeRef(ref))} };
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  el.focus();
  if (desc && desc.set) { desc.set.call(el, value); } else { el.value = value; }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, ref: ${JSON.stringify('@' + normalizeRef(ref))} };
})()`;
}

/** Result shape returned by the action scripts (via Runtime.evaluate). */
export interface ActionResult {
  ok: boolean;
  ref: string;
  error?: string;
}

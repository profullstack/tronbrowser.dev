/**
 * The in-page snapshot script (PRD M3.2) and its result types.
 *
 * `SNAPSHOT_JS` is evaluated in the page via CDP `Runtime.evaluate`. It tags each
 * surfaced element with a `data-tron-ref` attribute and returns a compact,
 * LLM-friendly list. Encoding the ref in the DOM (rather than a server-side node
 * map) is what lets a later `tron click @e3` — a separate process — resolve the
 * ref with a plain attribute selector, and makes a vanished element a clean
 * STALE_REF instead of a dangling handle.
 */

/** DOM attribute that carries a snapshot ref (e.g. `e3` for `@e3`). */
export const TRON_REF_ATTR = 'data-tron-ref';

export interface SnapshotElement {
  ref: string; // "@e3"
  role: string;
  name: string;
  tag: string;
  interactive: boolean;
  visible: boolean;
  value?: string;
  href?: string;
}

export interface AgentSnapshot {
  url: string;
  title: string;
  timestamp: string;
  elements: SnapshotElement[];
  focusedRef?: string;
}

export interface SnapshotOptions {
  includeHidden?: boolean;
}

/**
 * Build the in-page snapshot expression. Returns an IIFE string suitable for
 * `Runtime.evaluate` with `returnByValue: true`.
 */
export function snapshotExpression(options: SnapshotOptions = {}): string {
  const includeHidden = options.includeHidden === true;
  return `(() => {
  const ATTR = ${JSON.stringify(TRON_REF_ATTR)};
  const includeHidden = ${includeHidden ? 'true' : 'false'};
  const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, ' +
    '[role=button], [role=link], [role=checkbox], [role=radio], [role=tab], ' +
    '[role=menuitem], [role=switch], [role=textbox], [contenteditable=""], ' +
    '[contenteditable=true], summary, [tabindex]:not([tabindex="-1"])';
  const HEADING = 'h1, h2, h3, h4, h5, h6, [role=heading]';

  for (const el of document.querySelectorAll('[' + ATTR + ']')) el.removeAttribute(ATTR);

  const isVisible = (el) => {
    if (el.hasAttribute('hidden')) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
    if (parseFloat(st.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
      if (t === 'range') return 'slider';
      return 'textbox';
    }
    return 'generic';
  };

  const escapeId = (id) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\\\]/g, '\\\\$&'));
  const labelFor = (el) => {
    try {
      if (el.id) {
        const lab = document.querySelector('label[for="' + escapeId(el.id) + '"]');
        if (lab && lab.textContent) return lab.textContent.trim();
      }
    } catch (_) { /* bad id selector — fall through */ }
    const wrap = el.closest('label');
    if (wrap && wrap.textContent) return wrap.textContent.trim();
    return '';
  };

  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const parts = labelledby.split(/\\s+/).map((id) => {
        const n = document.getElementById(id);
        return n && n.textContent ? n.textContent.trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    const lab = labelFor(el);
    if (lab) return lab;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      const ph = el.getAttribute('placeholder');
      if (ph) return ph.trim();
      const nm = el.getAttribute('name');
      if (nm) return nm.trim();
    }
    if (tag === 'img') {
      const alt = el.getAttribute('alt');
      if (alt) return alt.trim();
    }
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text.slice(0, 120);
    const title = el.getAttribute('title');
    return title ? title.trim() : '';
  };

  const valueOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'password') return '\\u2022\\u2022\\u2022'; // never echo secrets
      if (t === 'checkbox' || t === 'radio') return el.checked ? 'checked' : 'unchecked';
      return el.value || '';
    }
    if (tag === 'textarea' || tag === 'select') return el.value || '';
    return undefined;
  };

  const seen = new Set();
  const nodes = [];
  const collect = (sel, interactive) => {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const visible = isVisible(el);
      if (!visible && !includeHidden) continue;
      nodes.push({ el, interactive, visible });
    }
  };
  collect(INTERACTIVE, true);
  collect(HEADING, false);

  // Document order keeps refs stable and readable.
  nodes.sort((a, b) => {
    const p = a.el.compareDocumentPosition(b.el);
    if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  const active = document.activeElement;
  let focusedRef;
  const elements = nodes.map((n, i) => {
    const ref = 'e' + (i + 1);
    n.el.setAttribute(ATTR, ref);
    if (n.el === active) focusedRef = '@' + ref;
    const out = {
      ref: '@' + ref,
      role: roleOf(n.el),
      name: nameOf(n.el),
      tag: n.el.tagName.toLowerCase(),
      interactive: n.interactive,
      visible: n.visible,
    };
    const v = valueOf(n.el);
    if (v !== undefined) out.value = v;
    if (n.el.tagName.toLowerCase() === 'a' && n.el.href) out.href = n.el.href;
    return out;
  });

  return {
    url: location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    elements,
    focusedRef,
  };
})()`;
}

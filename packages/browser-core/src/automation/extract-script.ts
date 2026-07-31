/**
 * Structured page extraction (PRD M3.3): built-in modes (text/links/forms/
 * tables/main) plus a custom CSS selector with `--field name=selector[@attr]`.
 *
 * `extractExpression` returns an IIFE evaluated in the page via CDP. Output is
 * deterministic JSON with stable field names; relative URLs (href/src) resolve
 * to absolute so callers never see page-relative links.
 */

/** Built-in extraction modes. */
export const EXTRACT_MODES = ['text', 'links', 'forms', 'tables', 'main'] as const;
export type ExtractMode = (typeof EXTRACT_MODES)[number];

export function isExtractMode(value: string): value is ExtractMode {
  return (EXTRACT_MODES as readonly string[]).includes(value);
}

/** A `--field name=selector` or `--field name=selector@attr` mapping. */
export interface FieldSpec {
  name: string;
  selector: string;
  attr?: string;
}

/** Parse one `name=selector[@attr]` field spec. */
export function parseFieldSpec(spec: string): FieldSpec {
  const eq = spec.indexOf('=');
  if (eq <= 0) throw new Error(`Bad --field (expected name=selector[@attr]): "${spec}"`);
  const name = spec.slice(0, eq).trim();
  let selectorPart = spec.slice(eq + 1).trim();
  let attr: string | undefined;
  const at = selectorPart.lastIndexOf('@');
  if (at >= 0) {
    attr = selectorPart.slice(at + 1).trim();
    selectorPart = selectorPart.slice(0, at).trim();
  }
  if (!name || !selectorPart) throw new Error(`Bad --field: "${spec}"`);
  return attr ? { name, selector: selectorPart, attr } : { name, selector: selectorPart };
}

/**
 * Build the in-page extraction expression.
 * `target` is a built-in mode, or a CSS selector when `fields` are provided
 * (or when it isn't a known mode).
 */
export function extractExpression(target: string, fields: FieldSpec[] = []): string {
  return `(() => {
  const abs = (el, attr) => {
    if (attr === 'href' || attr === 'src') { const v = el[attr]; if (typeof v === 'string' && v) return v; }
    return el.getAttribute(attr);
  };
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const labelFor = (el) => {
    try { if (el.id) { const l = document.querySelector('label[for="' + (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'); if (l) return clean(l.textContent); } } catch (_) {}
    const w = el.closest('label'); return w ? clean(w.textContent) : '';
  };

  const links = () => [...document.querySelectorAll('a[href]')].map((a) => ({ text: clean(a.textContent), href: a.href }));

  const forms = () => [...document.querySelectorAll('form')].map((f) => ({
    name: f.getAttribute('name') || f.id || null,
    action: f.action || null,
    method: (f.getAttribute('method') || 'get').toLowerCase(),
    fields: [...f.querySelectorAll('input, select, textarea')]
      .filter((el) => (el.getAttribute('type') || '') !== 'hidden')
      .map((el) => {
        const type = el.tagName.toLowerCase() === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : el.tagName.toLowerCase();
        const out = {
          name: el.getAttribute('name') || el.id || null,
          type,
          label: labelFor(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '',
          required: el.hasAttribute('required'),
        };
        if (type !== 'password') out.value = el.value || '';
        return out;
      }),
  }));

  const tables = () => [...document.querySelectorAll('table')].map((t) => {
    const headers = [...t.querySelectorAll('thead th, tr:first-child th')].map((th) => clean(th.textContent));
    const rows = [...t.querySelectorAll('tbody tr, tr')]
      .filter((tr) => tr.querySelector('td'))
      .map((tr) => [...tr.querySelectorAll('td')].map((td) => clean(td.textContent)));
    return { headers, rows };
  });

  const mainText = () => {
    const m = document.querySelector('main, article, [role=main]') || document.body;
    return { text: clean(m.textContent).slice(0, 20000) };
  };

  const target = ${JSON.stringify(target)};
  const fields = ${JSON.stringify(fields)};

  if (fields.length > 0) {
    return [...document.querySelectorAll(target)].map((el) => {
      const rec = {};
      for (const f of fields) {
        const node = el.querySelector(f.selector) || (el.matches(f.selector) ? el : null);
        if (!node) { rec[f.name] = null; continue; }
        rec[f.name] = f.attr ? abs(node, f.attr) : clean(node.textContent);
      }
      return rec;
    });
  }

  switch (target) {
    case 'text': return { text: clean(document.body ? document.body.textContent : '').slice(0, 20000) };
    case 'links': return links();
    case 'forms': return forms();
    case 'tables': return tables();
    case 'main': return mainText();
    default:
      // Bare selector: the text of each match.
      return [...document.querySelectorAll(target)].map((el) => clean(el.textContent));
  }
})()`;
}

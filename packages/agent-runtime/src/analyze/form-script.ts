/**
 * In-page form reader for analyze (PRD M3.5). Runs after a snapshot has tagged
 * elements with `data-tron-ref`, so each field/submit carries a stable ref. It
 * returns labels, input types, required flags, and submit controls — the raw
 * material the deterministic matcher/planner turn into a form map + plan.
 */

/** Raw field as read from the page. */
export interface RawField {
  ref: string;
  label: string;
  name: string;
  type: string;
  role: string;
  required: boolean;
}

/** Raw form as read from the page. */
export interface RawForm {
  name: string;
  submitRef?: string;
  submitLabel?: string;
  fields: RawField[];
}

export interface RawFormsResult {
  forms: RawForm[];
  challenge: boolean;
}

/** Build the expression evaluated via CDP Runtime.evaluate. */
export function analyzeFormsExpression(): string {
  return `(() => {
  const REF = 'data-tron-ref';
  const refOf = (el) => el.hasAttribute(REF) ? ('@' + el.getAttribute(REF)) : '';
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const labelFor = (el) => {
    try { if (el.id) { const l = document.querySelector('label[for="' + (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'); if (l) return clean(l.textContent); } } catch (_) {}
    const w = el.closest('label'); if (w) return clean(w.textContent);
    return '';
  };
  const nameOf = (el) => labelFor(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
  const typeOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    return (el.getAttribute('type') || 'text').toLowerCase();
  };
  const isRequired = (el) => el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
  const isField = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag !== 'input') return false;
    return !['hidden', 'submit', 'button', 'reset', 'image'].includes(typeOf(el));
  };
  const fieldOf = (el) => ({
    ref: refOf(el), label: nameOf(el), name: el.getAttribute('name') || '',
    type: typeOf(el), role: el.tagName.toLowerCase(), required: isRequired(el),
  });
  const submitOf = (form) => {
    const btn = form.querySelector('button[type=submit], input[type=submit], button:not([type])')
      || [...form.querySelectorAll('button, input[type=button]')].find((b) => /submit|send|save|continue|next|sign|register|subscribe|request/i.test(clean(b.textContent) + ' ' + (b.value || '')));
    return btn ? { submitRef: refOf(btn), submitLabel: clean(btn.textContent) || btn.value || 'Submit' } : {};
  };

  const forms = [...document.querySelectorAll('form')].map((f) => ({
    name: f.getAttribute('name') || f.getAttribute('aria-label') || f.id || 'form',
    ...submitOf(f),
    fields: [...f.querySelectorAll('input, textarea, select')].filter(isField).map(fieldOf),
  })).filter((f) => f.fields.length > 0);

  // Fields outside any <form> (common in SPAs) -> one synthetic form.
  if (forms.length === 0) {
    const loose = [...document.querySelectorAll('input, textarea, select')].filter((el) => isField(el) && !el.closest('form'));
    if (loose.length > 0) {
      const btn = [...document.querySelectorAll('button, input[type=submit]')].find((b) => /submit|send|save|continue|next|sign|register|subscribe|request/i.test(clean(b.textContent) + ' ' + (b.value || '')));
      forms.push({ name: 'page', submitRef: btn ? refOf(btn) : undefined, submitLabel: btn ? (clean(btn.textContent) || btn.value) : undefined, fields: loose.map(fieldOf) });
    }
  }

  const bodyText = (document.body ? document.body.textContent || '' : '').toLowerCase();
  const challenge = /captcha|recaptcha|hcaptcha|are you human/.test(bodyText) || !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha');

  return { forms, challenge };
})()`;
}

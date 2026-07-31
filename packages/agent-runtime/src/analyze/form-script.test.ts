// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeFormsExpression, type RawFormsResult } from './form-script.js';

function run(expr: string): RawFormsResult {
  return new Function('return ' + expr)() as RawFormsResult;
}

// The analyze form-reader relies on data-tron-ref being set (by a prior snapshot);
// tag elements here to simulate that.
function tagRefs(): void {
  let n = 0;
  for (const el of document.querySelectorAll('input, textarea, select, button')) {
    n += 1;
    el.setAttribute('data-tron-ref', `e${n}`);
  }
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('analyzeFormsExpression', () => {
  it('reads fields with refs, labels, types, required, and the submit control', () => {
    document.body.innerHTML = `
      <form name="contact">
        <label for="n">Name</label><input id="n" name="name" required />
        <label for="e">Email</label><input id="e" name="email" type="email" required />
        <textarea aria-label="Message"></textarea>
        <input type="hidden" name="csrf" />
        <button type="submit">Send</button>
      </form>`;
    tagRefs();
    const res = run(analyzeFormsExpression());
    expect(res.forms).toHaveLength(1);
    const form = res.forms[0];
    expect(form.name).toBe('contact');
    expect(form.submitLabel).toBe('Send');
    expect(form.fields.map((f) => f.label)).toEqual(['Name', 'Email', 'Message']); // hidden excluded
    const email = form.fields.find((f) => f.label === 'Email')!;
    expect(email.type).toBe('email');
    expect(email.required).toBe(true);
    expect(email.ref).toMatch(/^@e\d+$/);
    expect(form.submitRef).toMatch(/^@e\d+$/);
  });

  it('synthesizes a form for fields outside any <form>', () => {
    document.body.innerHTML = `
      <div>
        <label for="e">Email</label><input id="e" name="email" />
        <button>Subscribe</button>
      </div>`;
    tagRefs();
    const res = run(analyzeFormsExpression());
    expect(res.forms).toHaveLength(1);
    expect(res.forms[0].name).toBe('page');
    expect(res.forms[0].fields[0].label).toBe('Email');
  });

  it('detects a captcha challenge', () => {
    document.body.innerHTML = `<form><input name="x"/></form><div class="g-recaptcha"></div>`;
    tagRefs();
    expect(run(analyzeFormsExpression()).challenge).toBe(true);
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractExpression, isExtractMode, parseFieldSpec } from './extract-script.js';

function run<T>(expr: string): T {
  return new Function('return ' + expr)() as T;
}

beforeEach(() => {
  document.head.innerHTML = '<base href="https://example.com/dir/" />';
  document.body.innerHTML = '';
});

describe('parseFieldSpec', () => {
  it('parses name=selector', () => {
    expect(parseFieldSpec('title=.t')).toEqual({ name: 'title', selector: '.t' });
  });
  it('parses name=selector@attr', () => {
    expect(parseFieldSpec('url=a@href')).toEqual({ name: 'url', selector: 'a', attr: 'href' });
  });
  it('rejects a malformed spec', () => {
    expect(() => parseFieldSpec('nope')).toThrow(/name=selector/);
  });
});

describe('isExtractMode', () => {
  it('recognizes built-in modes', () => {
    expect(isExtractMode('links')).toBe(true);
    expect(isExtractMode('.card')).toBe(false);
  });
});

describe('extract links', () => {
  it('returns text + absolute href, resolving relatives', () => {
    document.body.innerHTML = `
      <a href="https://other.com/x">Abs</a>
      <a href="page">Rel</a>`;
    const links = run<Array<{ text: string; href: string }>>(extractExpression('links'));
    expect(links[0]).toEqual({ text: 'Abs', href: 'https://other.com/x' });
    // The relative href is resolved to an absolute URL (host is env-dependent).
    expect(links[1].href).toMatch(/^https?:\/\/.+\/page$/);
  });
});

describe('extract forms', () => {
  it('maps fields with labels, required, and omits password values', () => {
    document.body.innerHTML = `
      <form name="contact" action="/submit" method="post">
        <label for="e">Email</label><input id="e" name="email" type="email" required value="a@b.com" />
        <input name="pw" type="password" value="secret" />
        <input name="csrf" type="hidden" value="z" />
      </form>`;
    const forms = run<Array<Record<string, unknown>>>(extractExpression('forms'));
    expect(forms).toHaveLength(1);
    const f = forms[0] as { name: string; method: string; fields: Array<Record<string, unknown>> };
    expect(f.name).toBe('contact');
    expect(f.method).toBe('post');
    // hidden excluded; email + password only
    expect(f.fields.map((x) => x.name)).toEqual(['email', 'pw']);
    const email = f.fields[0];
    expect(email.label).toBe('Email');
    expect(email.required).toBe(true);
    expect(email.value).toBe('a@b.com');
    expect(f.fields[1]).not.toHaveProperty('value'); // password value omitted
  });
});

describe('extract tables', () => {
  it('returns headers and rows', () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Price</th></tr></thead>
        <tbody>
          <tr><td>Apple</td><td>$1</td></tr>
          <tr><td>Pear</td><td>$2</td></tr>
        </tbody>
      </table>`;
    const tables = run<Array<{ headers: string[]; rows: string[][] }>>(extractExpression('tables'));
    expect(tables[0].headers).toEqual(['Name', 'Price']);
    expect(tables[0].rows).toEqual([
      ['Apple', '$1'],
      ['Pear', '$2'],
    ]);
  });
});

describe('extract custom selector + fields', () => {
  it('maps each match to the requested fields with absolute urls', () => {
    document.body.innerHTML = `
      <div class="card"><span class="t">One</span><a href="a">A</a></div>
      <div class="card"><span class="t">Two</span><a href="b">B</a></div>`;
    const rows = run<Array<{ title: string; url: string }>>(
      extractExpression('.card', [
        { name: 'title', selector: '.t' },
        { name: 'url', selector: 'a', attr: 'href' },
      ]),
    );
    expect(rows.map((r) => r.title)).toEqual(['One', 'Two']);
    expect(rows[0].url).toMatch(/^https?:\/\/.+\/a$/);
  });
});

describe('extract text / main', () => {
  it('extracts main content text', () => {
    document.body.innerHTML = `<nav>skip</nav><main>Hello world</main>`;
    const res = run<{ text: string }>(extractExpression('main'));
    expect(res.text).toContain('Hello world');
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { snapshotExpression, type AgentSnapshot } from './snapshot-script.js';
import { clickExpression, fillExpression, type ActionResult } from './action-script.js';

// happy-dom does no layout, so getBoundingClientRect() is all zeros. The snapshot
// script uses a non-zero box as a visibility signal; give visible elements one so
// the display/hidden/visibility filters (which happy-dom does honor) are what's
// under test.
function run<T>(expr: string): T {
  return new Function('return ' + expr)() as T;
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0, toJSON() {} };
  } as typeof Element.prototype.getBoundingClientRect;
});

describe('snapshotExpression', () => {
  it('tags interactive + heading elements with refs in document order', () => {
    document.body.innerHTML = `
      <h1>Contact Us</h1>
      <form>
        <label for="name">Name</label><input id="name" type="text" />
        <label for="email">Email</label><input id="email" type="email" value="a@b.com" />
        <textarea aria-label="Message"></textarea>
        <a href="https://example.com/more">More information</a>
        <button>Submit</button>
        <input type="hidden" name="csrf" value="xyz" />
      </form>`;
    const snap = run<AgentSnapshot>(snapshotExpression());

    expect(snap.title).toBe(document.title);
    const byRole = Object.fromEntries(snap.elements.map((e) => [e.name, e]));
    expect(snap.elements.map((e) => e.ref)).toEqual(['@e1', '@e2', '@e3', '@e4', '@e5', '@e6']);
    expect(byRole['Contact Us'].role).toBe('heading');
    expect(byRole['Name'].role).toBe('textbox');
    expect(byRole['Email'].value).toBe('a@b.com');
    expect(byRole['Message'].role).toBe('textbox');
    expect(byRole['More information'].role).toBe('link');
    expect(byRole['More information'].href).toContain('example.com/more');
    expect(byRole['Submit'].role).toBe('button');
    // The hidden input has no layout role here and type=hidden is excluded.
    expect(snap.elements.some((e) => e.name === 'csrf')).toBe(false);
  });

  it('writes data-tron-ref attributes so later actions can resolve refs', () => {
    document.body.innerHTML = `<button>Go</button>`;
    run(snapshotExpression());
    expect(document.querySelector('[data-tron-ref="e1"]')?.textContent).toBe('Go');
  });

  it('redacts password values', () => {
    document.body.innerHTML = `<input type="password" name="pw" value="hunter2" />`;
    const snap = run<AgentSnapshot>(snapshotExpression());
    expect(snap.elements[0].value).not.toContain('hunter2');
  });

  it('excludes display:none and [hidden] elements by default', () => {
    document.body.innerHTML = `
      <button style="display:none">Nope</button>
      <button hidden>AlsoNope</button>
      <button>Yes</button>`;
    const snap = run<AgentSnapshot>(snapshotExpression());
    expect(snap.elements.map((e) => e.name)).toEqual(['Yes']);
  });

  it('includes hidden elements when asked', () => {
    document.body.innerHTML = `<button style="display:none">Nope</button>`;
    const snap = run<AgentSnapshot>(snapshotExpression({ includeHidden: true }));
    expect(snap.elements.map((e) => e.name)).toEqual(['Nope']);
    expect(snap.elements[0].visible).toBe(false);
  });

  it('reports the focused ref', () => {
    document.body.innerHTML = `<input id="a" /><input id="b" />`;
    (document.getElementById('b') as HTMLInputElement).focus();
    const snap = run<AgentSnapshot>(snapshotExpression());
    expect(snap.focusedRef).toBe('@e2');
  });
});

describe('action expressions', () => {
  it('clicks the referenced element', () => {
    document.body.innerHTML = `<button>Go</button>`;
    run(snapshotExpression());
    let clicked = false;
    document.querySelector('button')!.addEventListener('click', () => {
      clicked = true;
    });
    const res = run<ActionResult>(clickExpression('@e1'));
    expect(res.ok).toBe(true);
    expect(clicked).toBe(true);
  });

  it('fills an input and dispatches input/change', () => {
    document.body.innerHTML = `<input id="x" type="text" />`;
    run(snapshotExpression());
    const input = document.getElementById('x') as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    const res = run<ActionResult>(fillExpression('@e1', 'hello@example.com'));
    expect(res.ok).toBe(true);
    expect(input.value).toBe('hello@example.com');
    expect(events).toEqual(['input', 'change']);
  });

  it('returns STALE_REF when the ref no longer resolves', () => {
    document.body.innerHTML = `<button>Go</button>`;
    // No snapshot taken, so no data-tron-ref exists.
    const res = run<ActionResult>(clickExpression('@e9'));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('STALE_REF');
  });
});

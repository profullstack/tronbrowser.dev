import { describe, expect, it, vi } from 'vitest';
import { EXIT, run, type AnalyzeCliDeps } from './analyze-cli.js';
import type { AnalyzeBrowser } from './analyze/analyze.js';
import type { RawFormsResult } from './analyze/form-script.js';

const contactForm: RawFormsResult = {
  challenge: false,
  forms: [{ name: 'contact', submitRef: '@e4', submitLabel: 'Send', fields: [
    { ref: '@e1', label: 'Name', name: 'name', type: 'text', role: 'input', required: true },
    { ref: '@e2', label: 'Email', name: 'email', type: 'email', role: 'input', required: true },
  ] }],
};
const lead = { lead: { name: 'Jane', email: 'jane@example.com' } };

function browser(raw: RawFormsResult, hooks: Partial<AnalyzeBrowser> = {}): AnalyzeBrowser {
  return {
    snapshot: async () => ({ url: 'https://x/contact', title: 'Contact', timestamp: 't', elements: [] }),
    readForms: async () => raw,
    fill: hooks.fill ?? (async () => {}),
    click: hooks.click ?? (async () => {}),
  };
}

function harness(overrides: Partial<AnalyzeCliDeps> = {}, raw = contactForm) {
  const out: string[] = [];
  const err: string[] = [];
  const close = vi.fn();
  const deps: Partial<AnalyzeCliDeps> = {
    env: {},
    attach: async () => ({ browser: browser(raw), close }),
    readData: async () => lead,
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...overrides,
  };
  return { deps, out, err, close };
}

describe('analyze CLI', () => {
  it('prints a JSON plan and closes the session', async () => {
    const { deps, out, close } = harness();
    const code = await run(['Fill contact form', '--data', './lead.json', '--json'], deps);
    expect(code).toBe(EXIT.ok);
    const result = JSON.parse(out.join('\n'));
    expect(result.status).toBe('planned');
    expect(result.detectedForms[0].fields[1].valueFrom).toBe('lead.email');
    expect(close).toHaveBeenCalled();
  });

  it('treats a bare mode keyword as mode, not a goal', async () => {
    const { deps, out } = harness();
    await run(['form', '--json'], deps);
    expect(JSON.parse(out.join('\n')).goal).toBeUndefined();
  });

  it('exits notOk (6) when required data is missing', async () => {
    const { deps } = harness({ readData: async () => ({ lead: { name: 'Jane' } }) });
    expect(await run(['Fill', '--data', 'x', '--json'], deps)).toBe(EXIT.notOk);
  });

  it('exits noSession (4) when no managed session', async () => {
    const { deps, err } = harness({
      attach: async () => {
        const e = new Error('No managed session. Run: tron browser launch') as Error & { exit?: number };
        e.exit = EXIT.noSession;
        throw e;
      },
    });
    const code = await run(['form'], deps);
    expect(code).toBe(EXIT.noSession);
    expect(err.join('\n')).toContain('tron browser launch');
  });

  it('executes fills but not submit with --execute --no-submit', async () => {
    const fill = vi.fn(async () => {});
    const click = vi.fn(async () => {});
    const { deps } = harness({ attach: async () => ({ browser: browser(contactForm, { fill, click }), close: vi.fn() }) });
    const code = await run(['Fill', '--data', 'x', '--execute', '--no-submit', '--json'], deps);
    expect(code).toBe(EXIT.ok);
    expect(fill).toHaveBeenCalledTimes(2);
    expect(click).not.toHaveBeenCalled();
  });

  it('rejects an invalid --policy', async () => {
    const { deps } = harness();
    expect(await run(['form', '--policy', 'wild'], deps)).toBe(EXIT.usage);
  });
});

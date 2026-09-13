import { describe, expect, it } from 'vitest';
import type { AgentSnapshot } from '@tronbrowser/browser-core';
import { automateTools, fetchPage, markdownExpression, parseFetchArgs, wallReason, engineStatus } from './automate.js';
import { ObscuraClient, type ObscuraProcess } from './obscura.js';
import { McpBrowserSession, type McpPage } from './session.js';
import { createMcpServer } from './server.js';

const SNAP: AgentSnapshot = { url: 'https://x/', title: 'X', timestamp: 't', elements: [] };
const LONG = 'Rust is a multi-paradigm, general-purpose programming language that emphasizes performance, type safety, and concurrency. '.repeat(3);

/** A fake page: records calls, answers eval/extract from a table. */
function fakePage(answers: { markdown?: string; text?: string; links?: unknown; html?: string } = {}) {
  const calls: string[] = [];
  const page: McpPage = {
    id: 'p1',
    goto: async (u) => { calls.push('goto:' + u); },
    snapshot: async () => SNAP,
    click: async () => {},
    fill: async () => {},
    extract: async (m) => { calls.push('extract:' + m); return m === 'links' ? (answers.links ?? []) : { text: answers.text ?? 'chromium text ' + LONG }; },
    screenshot: async () => Buffer.from('PNG'),
    eval: (async (code: string) => {
      calls.push('eval');
      return code.includes('outerHTML') ? (answers.html ?? '<html>chromium</html>') : (answers.markdown ?? '# chromium\n\n' + LONG);
    }) as McpPage['eval'],
    url: async () => 'https://x/',
    title: async () => 'X',
    analyze: async () => ({ ok: true, mode: 'dry-run', status: 'planned', page: { url: 'x', title: 'X' } }),
    step: async () => ({ ok: true, mode: 'execute', status: 'acted', page: { url: 'x', title: 'X' } }),
    runTask: async () => ({ ok: true, mode: 'execute', status: 'complete', page: { url: 'x', title: 'X' } }),
  };
  const session = new McpBrowserSession(async () => ({ page, close: async () => {} }));
  return { page, session, calls };
}

/**
 * A fake Obscura process: a script maps tool name to a reply (text, an
 * isError, a thrown transport failure, or a delay). Speaks the same
 * newline-delimited JSON-RPC the real binary does.
 */
type Reply = { text: string } | { error: string } | { hang: true } | { exit: true };
function fakeObscura(script: Record<string, Reply>, opts: { bin?: string; timeoutMs?: number } = {}) {
  const calls: string[] = [];
  let exitCb: (() => void) | undefined;
  let killed = 0;
  const spawn = (): ObscuraProcess => {
    const queue: string[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    const push = (msg: unknown) => { queue.push(JSON.stringify(msg) + '\n'); wake?.(); };
    return {
      stdin: {
        write(chunk: string) {
          const msg = JSON.parse(chunk) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
          if (msg.method === 'initialize') return push({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'obscura' } } });
          if (msg.id === undefined) return;
          const name = msg.params?.name ?? '';
          calls.push(name + (msg.params?.arguments?.url ? ':' + msg.params.arguments.url : ''));
          const reply = script[name] ?? { text: 'ok' };
          if ('hang' in reply) return;
          if ('exit' in reply) { closed = true; wake?.(); exitCb?.(); return; }
          if ('error' in reply) return push({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: reply.error }], isError: true } });
          push({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: reply.text }] } });
        },
      },
      stdout: (async function* () {
        while (!closed) {
          if (queue.length) { yield queue.shift() as string; continue; }
          await new Promise<void>((r) => { wake = r; });
          wake = undefined;
        }
      })(),
      kill: () => { killed++; closed = true; wake?.(); },
      onExit: (cb) => { exitCb = cb; },
    };
  };
  const client = new ObscuraClient({ bin: opts.bin ?? '/fake/obscura', spawn, timeoutMs: opts.timeoutMs ?? 1000 });
  return { client, calls, killed: () => killed };
}

const args = (over: Record<string, unknown> = {}) => parseFetchArgs({ url: 'https://example.com/', ...over });

describe('parseFetchArgs', () => {
  it('defaults to markdown, auto, and the standing caps', () => {
    const a = args();
    expect(a).toMatchObject({ url: 'https://example.com/', format: 'markdown', engine: 'auto' });
    expect(a.maxChars).toBeGreaterThan(1000);
    expect(a.budgetMs).toBe(20_000);
  });
  it('rejects non-http URLs and unknown formats/engines', () => {
    expect(() => parseFetchArgs({ url: 'file:///etc/passwd' })).toThrow(/http/);
    expect(() => parseFetchArgs({ url: 'nope' })).toThrow(/Not a URL/);
    expect(() => args({ format: 'pdf' })).toThrow(/format/);
    expect(() => args({ engine: 'firefox' })).toThrow(/engine/);
    expect(() => parseFetchArgs({})).toThrow(/needs a url/);
  });
});

describe('wallReason', () => {
  it('flags bot walls and empty pages, passes real content', () => {
    expect(wallReason('Just a moment...\nChecking your browser', 'markdown')).toMatch(/bot wall/);
    expect(wallReason('Please enable JavaScript to continue', 'text')).toMatch(/bot wall/);
    expect(wallReason('   \n', 'markdown')).toMatch(/empty/);
    expect(wallReason(LONG, 'markdown')).toBeNull();
    // A links dump is short by nature; only walls disqualify it.
    expect(wallReason('{"text":"a","href":"https://x/"}', 'links')).toBeNull();
  });
});

describe('fetchPage routing', () => {
  it('uses Obscura when it answers with real content', async () => {
    const { client, calls } = fakeObscura({ browser_markdown: { text: '# Example\n\n' + LONG } });
    const { session, calls: pageCalls } = fakePage();
    const r = await fetchPage({ obscura: client, session }, args());
    expect(r.outcome.engine).toBe('obscura');
    expect(r.outcome.fellBack).toBeUndefined();
    expect(r.text).toContain('# Example');
    expect(calls).toEqual(['browser_navigate:https://example.com/', 'browser_markdown']);
    expect(pageCalls).toEqual([]); // Chromium never launched
    await client.close();
  });

  it('falls back to Chromium on a bot wall', async () => {
    const { client } = fakeObscura({ browser_markdown: { text: 'Just a moment... Checking your browser before accessing' } });
    const { session, calls } = fakePage();
    const r = await fetchPage({ obscura: client, session }, args());
    expect(r.outcome.engine).toBe('chromium');
    expect(r.outcome.fellBack).toMatch(/bot wall/);
    expect(calls[0]).toBe('goto:https://example.com/');
    expect(r.text).toContain('# chromium');
    await client.close();
  });

  it('falls back to Chromium when Obscura reports a tool error', async () => {
    const { client } = fakeObscura({ browser_navigate: { error: 'navigation failed: 403' } });
    const { session } = fakePage();
    const r = await fetchPage({ obscura: client, session }, args());
    expect(r.outcome.engine).toBe('chromium');
    expect(r.outcome.fellBack).toContain('403');
    await client.close();
  });

  it('falls back to Chromium when Obscura times out, and restarts the engine', async () => {
    const { client, killed } = fakeObscura({ browser_navigate: { hang: true } }, { timeoutMs: 50 });
    const { session } = fakePage();
    const r = await fetchPage({ obscura: client, session }, args({ timeout_s: 0.05 }));
    expect(r.outcome.engine).toBe('chromium');
    expect(r.outcome.fellBack).toMatch(/timed out/);
    expect(killed()).toBe(1);
    expect(client.running()).toBe(false);
  });

  it('falls back to Chromium when Obscura is not installed', async () => {
    const client = new ObscuraClient({ bin: undefined, spawn: () => { throw new Error('never'); } });
    expect(client.available()).toBe(false);
    const { session } = fakePage();
    const r = await fetchPage({ obscura: client, session }, args());
    expect(r.outcome.engine).toBe('chromium');
    expect(r.outcome.fellBack).toMatch(/not installed/);
  });

  it('engine=obscura never falls back, engine=chromium never asks Obscura', async () => {
    const { client, calls } = fakeObscura({ browser_navigate: { error: 'boom' } });
    const { session, calls: pageCalls } = fakePage();
    await expect(fetchPage({ obscura: client, session }, args({ engine: 'obscura' }))).rejects.toThrow(/boom/);
    expect(pageCalls).toEqual([]);
    const r = await fetchPage({ obscura: client, session }, args({ engine: 'chromium' }));
    expect(r.outcome.engine).toBe('chromium');
    expect(calls.filter((c) => c.startsWith('browser_navigate'))).toHaveLength(1);
    await client.close();
  });

  it('engine=obscura returns a wall verbatim instead of second-guessing', async () => {
    const { client } = fakeObscura({ browser_markdown: { text: 'Access denied' } });
    const { session } = fakePage();
    const r = await fetchPage({ obscura: client, session }, args({ engine: 'obscura' }));
    expect(r.outcome.engine).toBe('obscura');
    expect(r.text).toBe('Access denied');
    await client.close();
  });

  it('maps every format onto the right Obscura tool and Chromium path', async () => {
    const { client, calls } = fakeObscura({
      browser_snapshot: { text: LONG },
      browser_links: { text: '{"text":"a","href":"https://x/"}' },
      browser_evaluate: { text: '<html>' + LONG + '</html>' },
    });
    const { session, calls: pageCalls } = fakePage({ links: [{ text: 'b', href: 'https://y/' }] });
    for (const format of ['text', 'links', 'html'] as const) {
      const r = await fetchPage({ obscura: client, session }, args({ format }));
      expect(r.outcome.engine).toBe('obscura');
    }
    expect(calls.filter((c) => !c.startsWith('browser_navigate'))).toEqual(['browser_snapshot', 'browser_links', 'browser_evaluate']);
    for (const format of ['text', 'links', 'html'] as const) {
      const r = await fetchPage({ obscura: client, session }, args({ format, engine: 'chromium' }));
      expect(r.outcome.engine).toBe('chromium');
      if (format === 'links') expect(r.text).toBe('{"text":"b","href":"https://y/"}');
      if (format === 'html') expect(r.text).toBe('<html>chromium</html>');
      if (format === 'text') expect(r.text).toContain('chromium text');
    }
    expect(pageCalls).toContain('extract:main');
    expect(pageCalls).toContain('extract:links');
    await client.close();
  });

  it('truncates to max_chars and reports the cut', async () => {
    const { client } = fakeObscura({ browser_markdown: { text: 'x'.repeat(5000) } });
    const { session } = fakePage();
    const r = await fetchPage({ obscura: client, session }, args({ max_chars: 1000 }));
    expect(r.text.startsWith('x'.repeat(1000))).toBe(true);
    expect(r.text).toContain('[truncated]');
    expect(r.outcome.chars).toBe(r.text.length);
    await client.close();
  });
});

describe('automate tools over MCP', () => {
  it('registers fetch_page and engine_status next to the browser tools', async () => {
    const { client } = fakeObscura({ browser_markdown: { text: LONG } });
    const { session } = fakePage();
    const server = createMcpServer(session, undefined, automateTools({ obscura: client, session }));
    const list = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = (list!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['fetch_page', 'engine_status', 'browser_open', 'browser_snapshot']));

    const r = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fetch_page', arguments: { url: 'https://example.com/' } } });
    const content = (r!.result as { content: Array<{ text: string }> }).content;
    expect(content[0]!.text).toBe(LONG);
    expect(JSON.parse(content[1]!.text)).toMatchObject({ engine: 'obscura', format: 'markdown', url: 'https://example.com/' });

    const bad = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fetch_page', arguments: { url: 'ftp://x' } } });
    expect((bad!.result as { isError: boolean }).isError).toBe(true);
    await client.close();
  });

  it('engine_status reports both engines', async () => {
    const { client } = fakeObscura({});
    const { session } = fakePage();
    const before = await engineStatus({ obscura: client, session });
    expect(before.obscura.available).toBe(true);
    expect(before.obscura.running).toBe(false);
    expect(before.chromium.session).toBe('idle');
    await session.getPage();
    await client.call('browser_navigate', { url: 'https://x/' });
    const after = await engineStatus({ obscura: client, session });
    expect(after.obscura.running).toBe(true);
    expect(after.chromium.session).toBe('open');
    await client.close();
  });
});

describe('markdownExpression', () => {
  it('is a self-contained expression that yields a string', () => {
    const src = markdownExpression();
    expect(src.startsWith('(() => {')).toBe(true);
    expect(src.trimEnd().endsWith('})()')).toBe(true);
    // It must parse as JavaScript; a syntax slip here breaks every Chromium markdown fetch.
    expect(() => new Function('return ' + src)).not.toThrow();
  });
});

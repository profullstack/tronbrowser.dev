/**
 * `tron automate` tools (PRD M3.8): one `fetch_page` that picks the engine.
 *
 * Obscura first, because it renders a light page in tens of milliseconds for
 * ~30 MB; the managed Chromium session second, because it is 3-10x faster than
 * Obscura on JS-heavy pages and is the only one that passes a real login or an
 * interactive bot wall. The router falls back when Obscura is missing, errors,
 * times out, or hands back a page that is plainly a wall or empty. `engine`
 * pins either one when the caller knows better.
 */
import type { McpContent, McpTool } from './protocol.js';
import type { McpBrowserSession, McpPage } from './session.js';
import { resultText, type ObscuraClient } from './obscura.js';

export const FETCH_FORMATS = ['markdown', 'text', 'links', 'html'] as const;
export type FetchFormat = (typeof FETCH_FORMATS)[number];
export const ENGINES = ['auto', 'obscura', 'chromium'] as const;
export type Engine = (typeof ENGINES)[number];

export const DEFAULT_MAX_CHARS = 200_000;
/** How long Obscura gets before Chromium takes over. */
export const DEFAULT_OBSCURA_BUDGET_S = 20;
/** A rendered page with less text than this is treated as empty or blocked. */
export const THIN_PAGE_CHARS = 80;

/** Phrases a bot wall or a JS-required shell shows instead of the page. */
const WALL_PATTERNS = [
  /just a moment/i,
  /enable javascript/i,
  /javascript is (required|disabled)/i,
  /access denied/i,
  /attention required/i,
  /are you a (human|robot)/i,
  /verify you are human/i,
  /checking your browser/i,
  /captcha/i,
  /request blocked/i,
  /unusual traffic/i,
];

export interface FetchArgs {
  url: string;
  format: FetchFormat;
  engine: Engine;
  maxChars: number;
  budgetMs: number;
}

export interface FetchOutcome {
  engine: 'obscura' | 'chromium';
  url: string;
  format: FetchFormat;
  ms: number;
  chars: number;
  /** Why the fallback ran, when it did. */
  fellBack?: string;
}

export interface AutomateDeps {
  obscura: ObscuraClient | undefined;
  session: McpBrowserSession;
  now?: () => number;
}

/** Why an Obscura answer is not good enough, or null when it is. */
export function wallReason(text: string, format: FetchFormat): string | null {
  const head = text.slice(0, 1500);
  for (const pattern of WALL_PATTERNS) {
    if (pattern.test(head)) return `looks like a bot wall (${pattern.source})`;
  }
  if (format !== 'links' && text.replace(/\s+/g, ' ').trim().length < THIN_PAGE_CHARS) return 'page came back empty';
  return null;
}

export function parseFetchArgs(a: Record<string, unknown>): FetchArgs {
  const url = typeof a.url === 'string' ? a.url.trim() : '';
  if (!url) throw new Error('fetch_page needs a url');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`Only http(s) URLs: ${url}`);
  const format = (FETCH_FORMATS as readonly string[]).includes(String(a.format ?? 'markdown'))
    ? (String(a.format ?? 'markdown') as FetchFormat)
    : (() => {
        throw new Error(`format must be one of ${FETCH_FORMATS.join('|')}`);
      })();
  const engine = (ENGINES as readonly string[]).includes(String(a.engine ?? 'auto'))
    ? (String(a.engine ?? 'auto') as Engine)
    : (() => {
        throw new Error(`engine must be one of ${ENGINES.join('|')}`);
      })();
  const maxChars = typeof a.max_chars === 'number' && a.max_chars > 0 ? Math.floor(a.max_chars) : DEFAULT_MAX_CHARS;
  const timeoutS = typeof a.timeout_s === 'number' && a.timeout_s > 0 ? Math.min(a.timeout_s, 120) : DEFAULT_OBSCURA_BUDGET_S;
  return { url: parsed.toString(), format, engine, maxChars, budgetMs: Math.round(timeoutS * 1000) };
}

/**
 * In-page Markdown from the main content. Chromium has no markdown dump, so
 * the fallback walks the DOM itself: headings, paragraphs, lists, links,
 * emphasis, code, quotes and simple tables, skipping chrome (nav, footer,
 * scripts) the way Obscura's browser_markdown does.
 */
export function markdownExpression(): string {
  return `(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','IFRAME','NAV','FOOTER','ASIDE','FORM','BUTTON','INPUT','SELECT','TEXTAREA','CANVAS','VIDEO','AUDIO']);
  const BLOCK = new Set(['P','DIV','SECTION','ARTICLE','MAIN','HEADER','UL','OL','LI','TABLE','TR','BLOCKQUOTE','PRE','H1','H2','H3','H4','H5','H6','BR','HR','DL','DT','DD','FIGURE','FIGCAPTION','DETAILS','SUMMARY']);
  const esc = (s) => s.replace(/\\s+/g, ' ');
  const walk = (node, ctx) => {
    if (node.nodeType === 3) return esc(node.nodeValue || '');
    if (node.nodeType !== 1) return '';
    const el = node, tag = el.tagName;
    if (SKIP.has(tag)) return '';
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return '';
    const kids = (c) => [...el.childNodes].map((n) => walk(n, c)).join('');
    switch (tag) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
        return '\\n\\n' + '#'.repeat(+tag[1]) + ' ' + kids(ctx).trim() + '\\n\\n';
      case 'P': return '\\n\\n' + kids(ctx).trim() + '\\n\\n';
      case 'BR': return '\\n';
      case 'HR': return '\\n\\n---\\n\\n';
      case 'STRONG': case 'B': { const t = kids(ctx).trim(); return t ? '**' + t + '**' : ''; }
      case 'EM': case 'I': { const t = kids(ctx).trim(); return t ? '*' + t + '*' : ''; }
      case 'CODE': return ctx.pre ? el.textContent : '\`' + (el.textContent || '').trim() + '\`';
      case 'PRE': return '\\n\\n\`\`\`\\n' + (el.textContent || '').replace(/\\n$/, '') + '\\n\`\`\`\\n\\n';
      case 'A': { const t = kids(ctx).trim(); const h = el.href; return t ? (h && /^https?:/.test(h) ? '[' + t + '](' + h + ')' : t) : ''; }
      case 'IMG': { const alt = (el.getAttribute('alt') || '').trim(); return alt ? '![' + alt + '](' + el.src + ')' : ''; }
      case 'UL': case 'OL': {
        let i = 0;
        const items = [...el.children].filter((c) => c.tagName === 'LI').map((li) => {
          const body = walk(li, { ...ctx, list: true }).trim().replace(/\\n{2,}/g, '\\n').replace(/\\n/g, '\\n  ');
          return (tag === 'OL' ? (++i) + '. ' : '- ') + body;
        });
        return '\\n\\n' + items.join('\\n') + '\\n\\n';
      }
      case 'LI': return kids(ctx);
      case 'BLOCKQUOTE': return '\\n\\n' + kids(ctx).trim().split('\\n').map((l) => '> ' + l).join('\\n') + '\\n\\n';
      case 'TABLE': {
        const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => esc(c.textContent || '').trim()));
        if (!rows.length) return '';
        const w = Math.max(...rows.map((r) => r.length));
        const line = (r) => '| ' + Array.from({ length: w }, (_, i) => r[i] || '').join(' | ') + ' |';
        return '\\n\\n' + [line(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\\n') + '\\n\\n';
      }
      default: return BLOCK.has(tag) ? '\\n' + kids(ctx) + '\\n' : kids(ctx);
    }
  };
  const root = document.querySelector('main, article, [role="main"]') || document.body;
  const title = (document.title || '').trim();
  const body = walk(root, { pre: false }).replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  return (title ? '# ' + title + '\\n\\n' : '') + body;
})()`;
}

async function viaObscura(obscura: ObscuraClient, args: FetchArgs): Promise<string> {
  const nav = await obscura.call('browser_navigate', { url: args.url, waitUntil: 'load' }, args.budgetMs);
  if (nav.isError) throw new Error(resultText(nav) || 'navigate failed');
  let result;
  switch (args.format) {
    case 'markdown':
      result = await obscura.call('browser_markdown', { max_chars: args.maxChars }, args.budgetMs);
      break;
    case 'text':
      result = await obscura.call('browser_snapshot', { max_chars: args.maxChars }, args.budgetMs);
      break;
    case 'links':
      result = await obscura.call('browser_links', { limit: 1000 }, args.budgetMs);
      break;
    case 'html':
      result = await obscura.call('browser_evaluate', { expression: 'document.documentElement.outerHTML' }, args.budgetMs);
      break;
  }
  if (result.isError) throw new Error(resultText(result) || `${args.format} failed`);
  return resultText(result);
}

async function viaChromium(page: McpPage, args: FetchArgs): Promise<string> {
  await page.goto(args.url);
  switch (args.format) {
    case 'markdown':
      return String((await page.eval<string>(markdownExpression())) ?? '');
    case 'text': {
      const out = (await page.extract('main')) as { text?: string } | string;
      return typeof out === 'string' ? out : (out?.text ?? '');
    }
    case 'links': {
      const links = (await page.extract('links')) as Array<{ text: string; href: string }>;
      return (Array.isArray(links) ? links : []).map((l) => JSON.stringify(l)).join('\n');
    }
    case 'html':
      return String((await page.eval<string>('document.documentElement.outerHTML')) ?? '');
  }
}

/** Run one fetch through the router. Exposed for `tron automate fetch`. */
export async function fetchPage(deps: AutomateDeps, args: FetchArgs): Promise<{ text: string; outcome: FetchOutcome }> {
  const now = deps.now ?? (() => performance.now());
  const start = now();
  const finish = (engine: 'obscura' | 'chromium', text: string, fellBack?: string) => {
    const cut = text.length > args.maxChars ? text.slice(0, args.maxChars) + '\n…[truncated]' : text;
    return {
      text: cut,
      outcome: {
        engine,
        url: args.url,
        format: args.format,
        ms: Math.round(now() - start),
        chars: cut.length,
        ...(fellBack ? { fellBack } : {}),
      },
    };
  };

  let fellBack: string | undefined;
  if (args.engine !== 'chromium') {
    const obscura = deps.obscura;
    if (!obscura?.available()) {
      fellBack = 'obscura is not installed';
    } else {
      try {
        const text = await viaObscura(obscura, args);
        const reason = args.engine === 'auto' ? wallReason(text, args.format) : null;
        if (!reason) return finish('obscura', text);
        fellBack = `obscura: ${reason}`;
      } catch (err) {
        fellBack = `obscura: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    if (args.engine === 'obscura') throw new Error(fellBack);
  }

  const page = await deps.session.getPage();
  const text = await viaChromium(page, args);
  return finish('chromium', text, fellBack);
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  ...(required.length ? { required } : {}),
});

export function automateTools(deps: AutomateDeps): McpTool[] {
  return [
    {
      name: 'fetch_page',
      description:
        'Fetch a public web page as markdown, text, links or html. Renders with Obscura (fast, light) and falls back to the managed Chromium session for JS-heavy pages, bot walls and logins. Set engine to pin one.',
      inputSchema: obj(
        {
          url: { type: 'string', description: 'http(s) URL to fetch' },
          format: { type: 'string', enum: [...FETCH_FORMATS], description: 'Output format (default markdown)' },
          engine: { type: 'string', enum: [...ENGINES], description: 'auto (default): Obscura then Chromium; or pin obscura|chromium' },
          max_chars: { type: 'number', description: `Cut the output to this many characters (default ${DEFAULT_MAX_CHARS})` },
          timeout_s: { type: 'number', description: `Seconds Obscura gets before Chromium takes over (default ${DEFAULT_OBSCURA_BUDGET_S})` },
        },
        ['url'],
      ),
      handler: async (a): Promise<McpContent[]> => {
        const { text, outcome } = await fetchPage(deps, parseFetchArgs(a));
        return [
          { type: 'text', text },
          { type: 'text', text: JSON.stringify(outcome) },
        ];
      },
    },
    {
      name: 'engine_status',
      description: 'Report which engines tron automate can use: Obscura (binary, version) and the managed Chromium session.',
      inputSchema: obj({}),
      handler: async (): Promise<McpContent[]> => [{ type: 'text', text: JSON.stringify(await engineStatus(deps), null, 2) }],
    },
  ];
}

export interface EngineStatus {
  obscura: { available: boolean; bin?: string; version?: string; running: boolean };
  chromium: { session: 'open' | 'idle' };
}

export async function engineStatus(deps: AutomateDeps): Promise<EngineStatus> {
  const obscura = deps.obscura;
  const available = obscura?.available() ?? false;
  const version = available ? await obscura?.version() : undefined;
  return {
    obscura: {
      available,
      ...(obscura?.bin ? { bin: obscura.bin } : {}),
      ...(version ? { version } : {}),
      running: obscura?.running() ?? false,
    },
    chromium: { session: deps.session.isOpen() ? 'open' : 'idle' },
  };
}

/**
 * /api/dns — signed-in DNS verifier for the email-auth + web records the AEO
 * audit's DNS Analyzer flagged (SPF, DMARC, CAA, TLS-RPT, MTA-STS, DKIM, and
 * the Railway A/AAAA). Resolves server-side via Node's resolver so the browser
 * doesn't depend on a public DoH endpoint. Read-only: DNS lookups only, no
 * outbound HTTP, so an arbitrary `domain` can't be turned into an SSRF.
 */
import { Hono } from 'hono';
import { Resolver } from 'node:dns/promises';

export interface DnsDeps {
  currentUser: (c: any) => Promise<{ id: string } | null>;
}

type Status = 'pass' | 'warn' | 'fail';
interface Check { status: Status; msg: string; observed: string; }

// Use public resolvers explicitly so results don't depend on the container's
// upstream resolver (which may cache the container's own zone differently).
function resolver(): Resolver {
  const r = new Resolver({ timeout: 5000, tries: 2 });
  r.setServers(['8.8.8.8', '1.1.1.1']);
  return r;
}

async function txt(r: Resolver, name: string): Promise<string[]> {
  try { return (await r.resolveTxt(name)).map((chunks) => chunks.join('')); }
  catch { return []; }
}
async function caa(r: Resolver, name: string): Promise<string[]> {
  try {
    const recs = await r.resolveCaa(name);
    return recs.map((rec) => {
      if (rec.issue != null) return `0 issue "${rec.issue}"`;
      if (rec.issuewild != null) return `0 issuewild "${rec.issuewild}"`;
      if (rec.iodef != null) return `0 iodef "${rec.iodef}"`;
      return JSON.stringify(rec);
    });
  } catch { return []; }
}
async function addr(r: Resolver, name: string, v6: boolean): Promise<string[]> {
  try { return v6 ? await r.resolve6(name) : await r.resolve4(name); }
  catch { return []; }
}

function checkRootSpf(txts: string[]): Check {
  const s = txts.find((t) => /^v=spf1/i.test(t));
  if (!s) return { status: 'fail', msg: 'No SPF record found', observed: '' };
  if (/-all\b/.test(s)) return { status: 'pass', msg: 'SPF present with hard -all', observed: s };
  if (/[~?]all\b/.test(s)) return { status: 'warn', msg: 'SPF present but soft-fails (~all/?all)', observed: s };
  return { status: 'warn', msg: 'SPF present but no -all', observed: s };
}
function checkSendSpf(txts: string[]): Check {
  const s = txts.find((t) => /^v=spf1/i.test(t));
  if (!s) return { status: 'fail', msg: 'No SPF on send subdomain', observed: '' };
  if (/-all\b/.test(s)) return { status: 'pass', msg: 'send SPF with -all', observed: s };
  if (/[~?]all\b/.test(s)) return { status: 'warn', msg: 'send SPF still soft (~all)', observed: s };
  return { status: 'warn', msg: 'send SPF present, no -all', observed: s };
}
function checkDmarc(txts: string[]): Check {
  const s = txts.find((t) => /^v=DMARC1/i.test(t));
  if (!s) return { status: 'fail', msg: 'No DMARC record found', observed: '' };
  const p = (s.match(/p=(\w+)/i) || [])[1] || '';
  const hasRua = /rua=/i.test(s);
  if (/^(quarantine|reject)$/i.test(p) && hasRua) return { status: 'pass', msg: `p=${p} with reporting`, observed: s };
  if (/^none$/i.test(p)) return { status: 'warn', msg: `p=none — no enforcement${hasRua ? '' : ', no rua'}`, observed: s };
  if (!hasRua) return { status: 'warn', msg: `p=${p} but no rua reporting`, observed: s };
  return { status: 'warn', msg: `DMARC present (p=${p})`, observed: s };
}
function checkCaaIssue(lines: string[]): Check {
  if (!lines.length) return { status: 'fail', msg: 'No CAA records', observed: '' };
  const obs = lines.join('\n');
  return /issue\b/i.test(obs)
    ? { status: 'pass', msg: 'CAA issue policy present', observed: obs }
    : { status: 'warn', msg: 'CAA present but no issue directive', observed: obs };
}
function checkCaaWild(lines: string[]): Check {
  if (!lines.length) return { status: 'fail', msg: 'No CAA records', observed: '' };
  const obs = lines.join('\n');
  return /issuewild/i.test(obs)
    ? { status: 'pass', msg: 'issuewild policy present', observed: obs }
    : { status: 'warn', msg: 'No issuewild directive yet', observed: obs };
}
function checkTlsrpt(txts: string[]): Check {
  const s = txts.find((t) => /^v=TLSRPTv1/i.test(t));
  return s ? { status: 'pass', msg: 'TLS-RPT present', observed: s }
           : { status: 'fail', msg: 'No TLS-RPT record', observed: '' };
}
function checkMtaSts(txts: string[]): Check {
  const s = txts.find((t) => /^v=STSv1/i.test(t));
  return s ? { status: 'pass', msg: 'MTA-STS TXT present', observed: s }
           : { status: 'fail', msg: 'No MTA-STS record', observed: '' };
}
function checkDkim(txts: string[]): Check {
  const s = txts.find((t) => /v=DKIM1/i.test(t) || /(^|;|\s)p=[A-Za-z0-9+/]{40,}/.test(t));
  return s ? { status: 'pass', msg: 'DKIM key published for this selector', observed: s.slice(0, 90) + (s.length > 90 ? '…' : '') }
           : { status: 'fail', msg: 'No DKIM key for that selector', observed: '' };
}
function checkA(ips: string[]): Check {
  return ips.length ? { status: 'pass', msg: 'Apex resolves', observed: ips.join(', ') }
                    : { status: 'fail', msg: 'No A record — apex does not resolve', observed: '' };
}
function checkAaaa(ips: string[]): Check {
  return ips.length ? { status: 'pass', msg: 'IPv6 present', observed: ips.join(', ') }
                    : { status: 'warn', msg: 'No AAAA / IPv6 (audit finding — optional)', observed: '' };
}

export function dnsRoutes(deps: DnsDeps): Hono {
  const app = new Hono();

  app.post('/verify', async (c) => {
    const user = await deps.currentUser(c);
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const domain = String(body.domain || '')
      .trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (!/^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(domain)) {
      return c.json({ error: 'invalid domain' }, 400);
    }
    const selector = (String(body.selector || 'resend').trim().replace(/[^a-z0-9._-]/gi, '')) || 'resend';

    const r = resolver();
    const [root, dmarc, sendSpf, caaRoot, tlsrpt, mtasts, dkim, a4, a6] = await Promise.all([
      txt(r, domain),
      txt(r, `_dmarc.${domain}`),
      txt(r, `send.${domain}`),
      caa(r, domain),
      txt(r, `_smtp._tls.${domain}`),
      txt(r, `_mta-sts.${domain}`),
      txt(r, `${selector}._domainkey.${domain}`),
      addr(r, domain, false),
      addr(r, domain, true),
    ]);

    const results = [
      { key: 'spf', title: 'Root SPF', host: '@', ...checkRootSpf(root) },
      { key: 'dmarc', title: 'DMARC policy', host: '_dmarc', ...checkDmarc(dmarc) },
      { key: 'sendspf', title: 'send subdomain SPF', host: 'send', ...checkSendSpf(sendSpf) },
      { key: 'caa_issue', title: 'CAA — issue', host: '@', ...checkCaaIssue(caaRoot) },
      { key: 'caa_wild', title: 'CAA — issuewild', host: '@', ...checkCaaWild(caaRoot) },
      { key: 'tlsrpt', title: 'TLS-RPT', host: '_smtp._tls', ...checkTlsrpt(tlsrpt) },
      { key: 'mtasts', title: 'MTA-STS', host: '_mta-sts', ...checkMtaSts(mtasts) },
      { key: 'dkim', title: `DKIM (${selector})`, host: `${selector}._domainkey`, ...checkDkim(dkim) },
      { key: 'a', title: 'Web apex — A (Railway)', host: '@', ...checkA(a4) },
      { key: 'aaaa', title: 'Web apex — AAAA / IPv6', host: '@', ...checkAaaa(a6) },
    ];
    const summary = { pass: 0, warn: 0, fail: 0 };
    for (const x of results) summary[x.status]++;

    return c.json({ domain, selector, results, summary });
  });

  return app;
}

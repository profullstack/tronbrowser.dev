// DNS setup & verify — signed-in ops tool. Renders copy-able record rows and
// calls the authenticated /api/dns/verify endpoint (server-side resolution).
// Keep as a plain script (site CSP is script-src 'self' — no inline JS).

// Client display spec. `key` matches a result key from /api/dns/verify.
// `copyable:false` marks verify-only rows (managed elsewhere, e.g. Railway).
const RECORDS = [
  { key: 'spf', title: 'Root SPF', host: '@', type: 'TXT',
    value: 'v=spf1 include:forwardemail.net -all',
    note: 'Stops spoofing of @DOMAIN. Add other senders (e.g. include:amazonses.com) before -all if you use them.' },
  { key: 'dmarc', title: 'DMARC policy', host: '_dmarc', type: 'TXT',
    value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@tronbrowser.dev; aspf=r; adkim=r;',
    note: 'The rua mailbox must exist. p=none means no enforcement.' },
  { key: 'sendspf', title: 'send subdomain SPF', host: 'send', type: 'TXT',
    value: 'v=spf1 include:amazonses.com -all',
    note: 'Currently uses ~all (softfail). Tighten to -all if it only sends via SES.' },
  { key: 'caa_issue', title: 'CAA — issue', host: '@', type: 'CAA',
    value: '0 issue "letsencrypt.org"',
    note: '⚠ Verify your host’s CA first — Railway must issue via Let’s Encrypt or this breaks cert renewal.' },
  { key: 'caa_wild', title: 'CAA — issuewild', host: '@', type: 'CAA',
    value: '0 issuewild ";"', note: 'Disallow wildcard certs.' },
  { key: 'tlsrpt', title: 'TLS-RPT', host: '_smtp._tls', type: 'TXT',
    value: 'v=TLSRPTv1; rua=mailto:tls-reports@tronbrowser.dev',
    note: 'Reports inbound TLS failures. Mailbox must exist.' },
  { key: 'mtasts', title: 'MTA-STS', host: '_mta-sts', type: 'TXT',
    value: 'v=STSv1; id=20260701000000',
    note: 'Also needs a policy file at https://mta-sts.DOMAIN/.well-known/mta-sts.txt.' },
  { key: 'dkim', title: 'DKIM (email sender)', host: '<selector>._domainkey', type: 'TXT',
    value: 'v=DKIM1; k=rsa; p=<public key from your sender>', copyable: false,
    note: 'Set the selector above — "resend" for Resend, or your ForwardEmail selector from app.forwardemail.net.' },
  { key: 'a', title: 'Web apex — A record (Railway)', host: '@', type: 'A',
    value: '(managed by Railway)', copyable: false,
    note: 'Verify-only; should already resolve since the site is live.' },
  { key: 'aaaa', title: 'Web apex — AAAA / IPv6', host: '@', type: 'AAAA',
    value: '(optional — add if Railway exposes IPv6)', copyable: false,
    note: 'Audit flagged no IPv6. Optional; add the AAAA target if Railway provides one.' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function row(k, v, copyable, cls) {
  const btn = copyable
    ? '<button class="copy" data-copy="' + esc(v).replace(/"/g, '&quot;') + '">copy</button>'
    : '<span></span>';
  return '<div class="row"><span class="k">' + k + '</span><span class="v ' + (cls || '') + '">' + esc(v) + '</span>' + btn + '</div>';
}

function render() {
  const wrap = document.getElementById('records');
  RECORDS.forEach((r) => {
    const canCopy = r.copyable !== false;
    const div = document.createElement('div');
    div.className = 'rec';
    div.innerHTML =
      '<div class="title">' + esc(r.title) + '</div>' +
      row('Host', r.host, canCopy && r.host.indexOf('<') < 0) +
      row('Type', r.type, canCopy) +
      row('Value', r.value, canCopy && r.value.indexOf('<') < 0, 'val') +
      (r.note ? '<p class="' + (r.note[0] === '⚠' ? 'warn-inline' : 'note') + '">' + esc(r.note) + '</p>' : '') +
      '<div class="result" id="res_' + r.key + '"></div>';
    wrap.appendChild(div);
  });
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button.copy');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.getAttribute('data-copy'));
    const t = b.textContent; b.textContent = 'copied'; b.classList.add('done');
    setTimeout(() => { b.textContent = t; b.classList.remove('done'); }, 1200);
  } catch (_) { /* clipboard unavailable */ }
});

async function verify() {
  const btn = document.getElementById('verify');
  const summary = document.getElementById('summary');
  const domain = document.getElementById('domain').value.trim();
  const selector = document.getElementById('selector').value.trim();
  if (!domain) return;
  btn.disabled = true;
  RECORDS.forEach((r) => {
    const el = document.getElementById('res_' + r.key);
    el.className = 'result show checking';
    el.innerHTML = '<span class="st">checking…</span>';
  });
  summary.textContent = '';
  try {
    const res = await fetch('/api/dns/verify', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain, selector }),
    });
    if (res.status === 401) { location.href = '/login'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    for (const out of data.results) {
      const el = document.getElementById('res_' + out.key);
      if (!el) continue;
      el.className = 'result show ' + out.status;
      el.innerHTML = '<span class="st">' + out.status + '</span>' + esc(out.msg) +
        (out.observed ? '<span class="obs">' + esc(out.observed) + '</span>' : '');
    }
    const s = data.summary;
    summary.textContent = s.pass + ' pass · ' + s.warn + ' warn · ' + s.fail + ' fail';
  } catch (err) {
    RECORDS.forEach((r) => {
      const el = document.getElementById('res_' + r.key);
      el.className = 'result show fail';
      el.innerHTML = '<span class="st">error</span>' + esc(err.message);
    });
  } finally {
    btn.disabled = false;
  }
}

// Auth gate (mirrors settings.js): redirect to /login if not signed in.
(async function init() {
  render();
  document.getElementById('verify').addEventListener('click', verify);
  try {
    const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json());
    if (!me.signedIn) { location.href = '/login'; }
  } catch (_) { /* offline: leave the page usable; verify will 401→login */ }
})();

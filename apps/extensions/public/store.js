// TronBrowser extension store — client. Talks to /api/store. CSP-safe: no
// inline handlers, all wiring via addEventListener. Each page calls the init
// function matching its [data-page].
const API = '/api/store';

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function qs(name) { return new URLSearchParams(location.search).get(name); }
function initials(name) { return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase(); }

async function api(path, opts = {}) {
  const res = await fetch(API + path, { credentials: 'include', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data, status: res.status });
  return data;
}

function scanBadge(scan) {
  if (!scan) return '<span class="badge pending">scan queued</span>';
  if (scan.status === 'done') {
    const sev = scan.severity || 'clean';
    const score = scan.score != null ? ` ${scan.score}/100` : '';
    return `<span class="badge ${esc(sev)}" title="vu1nz.com scan">🛡 ${esc(sev)}${esc(score)}</span>`;
  }
  if (scan.status === 'skipped') return '<span class="badge skipped">unscanned</span>';
  if (scan.status === 'error') return '<span class="badge high">scan error</span>';
  return `<span class="badge ${esc(scan.status)}">scan ${esc(scan.status)}</span>`;
}

function card(ext) {
  const ver = ext.version ? `<span class="badge ver">v${esc(ext.version.version)}</span>` : '';
  const flags = ext.flags > 0 ? `<span class="badge flag" title="community flags">⚑ ${ext.flags}</span>` : '';
  return `<a class="card" href="/store/extension.html?slug=${encodeURIComponent(ext.slug)}">
    <div class="top">
      <div class="avatar">${esc(initials(ext.name))}</div>
      <div><h3>${esc(ext.name)}</h3></div>
    </div>
    <p class="summary">${esc(ext.summary || '')}</p>
    <div class="meta">${ver} ${scanBadge(ext.scan)} ${flags}</div>
  </a>`;
}

/* ---------- browse (index.html) ---------- */
async function initBrowse() {
  const grid = document.getElementById('grid');
  const input = document.getElementById('q');
  const empty = document.getElementById('empty');
  async function load(q) {
    grid.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const { extensions } = await api(`/extensions${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      if (!extensions.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
      empty.classList.add('hidden');
      grid.innerHTML = extensions.map(card).join('');
    } catch (e) {
      grid.innerHTML = `<p class="error">Couldn't load extensions: ${esc(e.message)}</p>`;
    }
  }
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load(input.value.trim()), 250); });
  load('');
}

/* ---------- detail (extension.html) ---------- */
async function initDetail() {
  const slug = qs('slug');
  const root = document.getElementById('detail');
  if (!slug) { root.innerHTML = '<p class="error">No extension specified.</p>'; return; }
  if (qs('paid')) document.getElementById('paidNote')?.classList.remove('hidden');
  try {
    const ext = await api(`/extensions/${encodeURIComponent(slug)}`);
    const v = ext.version;
    const perms = (v?.permissions || []).map((p) => `<span class="perm">${esc(p)}</span>`).join('') || '<span class="muted">none requested</span>';
    const dl = v ? `${API}/extensions/${encodeURIComponent(ext.slug)}/download` : '#';
    root.innerHTML = `
      <div class="top" style="gap:16px;margin-bottom:8px">
        <div class="avatar" style="width:56px;height:56px;font-size:20px">${esc(initials(ext.name))}</div>
        <div>
          <h1 style="margin:0">${esc(ext.name)}</h1>
          <p class="muted" style="margin:4px 0 0">${esc(ext.summary || '')}</p>
        </div>
      </div>
      <div class="meta" style="margin:14px 0">
        ${v ? `<span class="badge ver">v${esc(v.version)}</span>` : ''}
        <span class="badge">MV${esc(v?.manifestVersion || 3)}</span>
        ${scanBadge(ext.scan)}
        ${ext.flags > 0 ? `<span class="badge flag">⚑ ${ext.flags} flag(s)</span>` : ''}
      </div>
      <div class="row" style="margin:18px 0">
        <a class="btn" id="installBtn" href="${esc(dl)}">⬇ Install / Download</a>
        <a class="btn secondary" href="/store/install-guide.html">How to install</a>
        <button class="btn ghost" id="flagBtn">⚑ Report</button>
      </div>
      ${ext.homepageUrl ? `<p class="hint">Homepage: <a href="${esc(ext.homepageUrl)}" rel="noopener noreferrer">${esc(ext.homepageUrl)}</a></p>` : ''}
      <h3>Permissions</h3>
      <div class="perms">${perms}</div>
      <h3>Description</h3>
      <p>${esc(ext.description || 'No description provided.')}</p>
      <h3>Auto-update</h3>
      <p class="hint">Chromium auto-updates this extension from its <code>update_url</code>:</p>
      <pre>${esc(ext.updateUrl)}</pre>`;

    document.getElementById('flagBtn').addEventListener('click', async () => {
      const reason = prompt('Reason? (malware, privacy, broken, spam, other)', 'other');
      if (!reason) return;
      try { await api(`/extensions/${encodeURIComponent(ext.slug)}/flag`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) }); alert('Thanks — flagged for review.'); }
      catch (e) { alert('Could not flag: ' + e.message); }
    });
  } catch (e) {
    root.innerHTML = `<p class="error">${e.status === 404 ? 'Extension not found.' : esc(e.message)}</p>`;
  }
}

/* ---------- submit (submit.html) ---------- */
async function initSubmit() {
  const form = document.getElementById('submitForm');
  const out = document.getElementById('submitOut');
  const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ signedIn: false }));
  if (!me.signedIn) {
    out.innerHTML = `<p class="error">You must <a href="/login?redirect=/store/submit.html">sign in</a> to publish.</p>`;
    form.classList.add('hidden');
    return;
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.innerHTML = '<p class="muted">Working…</p>';
    const fd = new FormData(form);
    let manifest;
    try { manifest = JSON.parse(fd.get('manifest')); }
    catch { out.innerHTML = '<p class="error">manifest.json is not valid JSON.</p>'; return; }
    const method = fd.get('method');
    try {
      // 1) create draft
      const draft = await api('/extensions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: fd.get('name'), summary: fd.get('summary'), description: fd.get('description'), homepageUrl: fd.get('homepageUrl') }),
      });
      // 2) submit MV3 version
      const ver = await api(`/extensions/${draft.id}/versions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manifest, bundleUrl: fd.get('bundleUrl') || null, crxUrl: fd.get('crxUrl') || null, source: 'upload' }),
      });
      const warn = (ver.warnings || []).length ? `<p class="hint">⚠ ${ver.warnings.map(esc).join('<br>⚠ ')}</p>` : '';
      // 3) pay $1
      out.innerHTML = `<p class="success">Validated MV3 ✓ (v${esc(ver.version)}). Redirecting to payment…</p>${warn}`;
      const pay = await api(`/extensions/${draft.id}/checkout`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method }),
      }).catch((err) => err.data || {});
      if (pay.checkoutUrl) { location.href = pay.checkoutUrl; return; }
      if (pay.x402Version) {
        out.innerHTML += `<p class="success">Pay 1 USDC via your CoinPay wallet, then confirm. Pay-to: <code>${esc(pay.accepts?.[0]?.payTo || '(configure STORE_X402_PAY_TO)')}</code></p>
          <div class="field"><label>Settlement reference</label><input type="text" id="x402ref" placeholder="CoinPay reference" /></div>
          <button class="btn" id="x402confirm">Confirm payment</button>`;
        document.getElementById('x402confirm').addEventListener('click', async () => {
          const reference = document.getElementById('x402ref').value.trim();
          try {
            await api(`/extensions/${draft.id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentId: pay.paymentId, reference }) });
            location.href = `/store/extension.html?slug=${encodeURIComponent(draft.slug)}&paid=1`;
          } catch (err) { out.innerHTML += `<p class="error">${esc(err.message)}</p>`; }
        });
        return;
      }
      out.innerHTML += `<p class="error">Payment could not be started: ${esc(pay.error || 'unknown')}</p>`;
    } catch (err) {
      const extra = err.data?.errors ? '<br>• ' + err.data.errors.map(esc).join('<br>• ') : '';
      out.innerHTML = `<p class="error">${esc(err.message)}${extra}</p>`;
    }
  });
}

/* ---------- tabs (install-guide.html) ---------- */
function initTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === target));
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.getAttribute('data-page');
  if (page === 'browse') initBrowse();
  else if (page === 'detail') initDetail();
  else if (page === 'submit') initSubmit();
  initTabs();
});

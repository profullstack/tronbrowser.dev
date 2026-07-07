// TronBrowser extension store — client. Talks to /api/store. CSP-safe: no
// inline handlers, all wiring via addEventListener. Each page calls the init
// function matching its [data-page].
const API = '/api/store';

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function qs(name) { return new URLSearchParams(location.search).get(name); }
function initials(name) { return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase(); }

// Logo if the listing has one (auto-ingested from the .crx icons), else initials.
// Most logos are transparent PNGs, so we render them CONTAINED (never cropped)
// and pick a light or dark backdrop from the logo's own luminance in
// hydrateIcons() — otherwise a transparent logo shows over the gradient avatar
// and looks muddy.
function avatar(ext, px) {
  const dim = px ? `width:${px}px;height:${px}px` : '';
  if (ext.iconUrl) return `<img class="avatar icon" data-icon src="${esc(ext.iconUrl)}" alt="" style="object-fit:contain;${dim}">`;
  return `<div class="avatar"${px ? ` style="${dim};font-size:20px"` : ''}>${esc(initials(ext.name))}</div>`;
}

// Choose 'dark' or 'light' backdrop for a (usually transparent) logo by the
// average luminance of its opaque pixels: a bright logo wants a dark tile, a
// dark logo a light tile. Returns null if unreadable (fully transparent / a
// CORS-tainted canvas), leaving the default neutral tile.
function backdropFor(img) {
  try {
    const s = 24;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, s, s);
    const { data } = ctx.getImageData(0, 0, s, s);
    let lum = 0, wsum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.1) continue;
      lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * a;
      wsum += a;
    }
    if (wsum === 0) return null;
    return lum / wsum > 140 ? 'dark' : 'light';
  } catch (_) {
    return 'dark'; // tainted canvas (remote icon) — dark suits the store theme
  }
}

function hydrateIcons(root) {
  root.querySelectorAll('img.avatar.icon[data-icon]').forEach((img) => {
    const apply = () => {
      const b = backdropFor(img);
      if (b) img.classList.add('icon-' + b);
      img.removeAttribute('data-icon');
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
  });
}

// ── AI auto-ingest: paste a .crx URL, we fill the form + scan (no forms) ──
function renderScanResult(scan) {
  const c = scan.countsBySeverity || {};
  const chip = (sev, n) => (n ? `<span class="badge ${sev}">${n} ${sev}</span>` : '');
  const findings = (scan.findings || []).slice(0, 12)
    .map((f) => `<li><b>${esc(f.severity)}</b> ${esc(f.rule)} — ${esc(f.detail)}${f.file ? ` <span class="muted">(${esc(f.file)})</span>` : ''}</li>`).join('');
  const verdict = scan.green
    ? '<p class="success">✅ Green light — passes the security scan and can be published.</p>'
    : '<p class="error">⛔ Blocked — critical issues must be fixed before publishing.</p>';
  return `${verdict}
    <div class="meta">${chip('critical', c.critical)} ${chip('high', c.high)} ${chip('medium', c.medium)} ${chip('low', c.low)}</div>
    ${findings ? `<ul class="findings">${findings}</ul>` : '<p class="muted">No findings.</p>'}`;
}

function wireAutoIngest(form) {
  const wrap = document.createElement('div');
  wrap.className = 'panel';
  wrap.style.marginBottom = '14px';
  wrap.innerHTML = `<h2>1 · Auto-fill from your .crx ✨</h2>
    <p class="hint">Paste your published <code>.crx</code> URL — we read its manifest, icons, and code to fill everything below and run the security scan. A <b>green scan is required to publish</b>.</p>
    <div style="display:flex;gap:8px;align-items:flex-start">
      <input type="url" id="ingestUrl" placeholder="https://…/your-extension.crx" style="flex:1" />
      <button type="button" class="btn" id="ingestBtn">Ingest &amp; scan</button>
    </div>
    <div id="ingestPreview" style="display:flex;gap:12px;align-items:center;margin-top:10px"></div>
    <div id="ingestOut"></div>`;
  form.parentNode.insertBefore(wrap, form);

  const submitBtn = form.querySelector('button[type="submit"]');
  wrap.querySelector('#ingestBtn').addEventListener('click', async () => {
    const url = wrap.querySelector('#ingestUrl').value.trim();
    const out = wrap.querySelector('#ingestOut');
    const preview = wrap.querySelector('#ingestPreview');
    if (!url) { out.innerHTML = '<p class="error">Paste a .crx URL first.</p>'; return; }
    out.innerHTML = '<p class="muted">Reading .crx + scanning…</p>';
    try {
      const { listing, scan } = await api('/extensions/ingest', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ crxUrl: url }),
      });
      form.name.value = listing.name || '';
      form.summary.value = listing.summary || '';
      form.description.value = listing.description || '';
      form.manifest.value = listing.manifestJson || '';
      if (form.crxUrl) form.crxUrl.value = url;
      form.dataset.iconUrl = listing.iconDataUri || '';
      preview.innerHTML = `${listing.iconDataUri ? `<img src="${esc(listing.iconDataUri)}" alt="" style="width:48px;height:48px;border-radius:10px;object-fit:cover">` : ''}
        <div><b>${esc(listing.name)}</b> <span class="badge ver">v${esc(listing.version)}</span><br>
        <span class="muted">${(listing.permissions || []).length} permission(s)</span></div>`;
      out.innerHTML = renderScanResult(scan);
      if (submitBtn) submitBtn.disabled = !scan.green;
    } catch (e) {
      out.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      if (submitBtn) submitBtn.disabled = true;
    }
  });
}

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
      ${avatar(ext)}
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
      hydrateIcons(grid);
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
        ${avatar(ext, 56)}
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
    hydrateIcons(root);

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
let SCP_TARGET = 'files@files.profullstack.com';

async function renderPublisher() {
  const box = document.getElementById('pubStatus');
  const form = document.getElementById('submitForm');
  const { publisher, scpTarget } = await api('/publisher');
  if (scpTarget) { SCP_TARGET = scpTarget; document.getElementById('scpTarget').textContent = scpTarget; }
  if (publisher && publisher.provisioned) {
    box.innerHTML = `<p class="success">Upload key ready ✓ — member <b>${esc(publisher.handle)}</b> (${esc(publisher.fingerprint || '')})</p>
      <p class="hint">Upload to <code>${esc(SCP_TARGET)}:/public/extensions/&lt;slug&gt;/</code> with your key.</p>`;
    form.classList.remove('hidden');
    return;
  }
  if (publisher && !publisher.provisioned) {
    box.innerHTML = `<p class="hint">Key saved for <b>${esc(publisher.handle)}</b> — provisioning is finishing. You can fill out the listing below.</p>`;
    form.classList.remove('hidden');
    return;
  }
  box.innerHTML = `
    <p class="hint">Register an SSH key so you can upload bundles. Paste your public key, or have one generated.</p>
    <div class="field"><label>Handle (your member name)</label><input type="text" id="pubHandle" placeholder="acme" /></div>
    <div class="field"><label>SSH public key</label><textarea id="pubKey" placeholder="ssh-ed25519 AAAA… you@host"></textarea></div>
    <button class="btn" id="pubSave">Register key</button>
    <button class="btn secondary" id="pubGen">Generate one for me</button>`;
  document.getElementById('pubSave').addEventListener('click', () => savePublisher(false));
  document.getElementById('pubGen').addEventListener('click', () => savePublisher(true));
}

async function savePublisher(generate) {
  const box = document.getElementById('pubStatus');
  const handle = document.getElementById('pubHandle')?.value.trim();
  const pubkey = document.getElementById('pubKey')?.value.trim();
  try {
    const r = await api('/publisher/key', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle, pubkey: generate ? '' : pubkey, generate }),
    });
    if (r.privateKey) {
      box.innerHTML = `<p class="success">Key generated for <b>${esc(r.handle)}</b>. Save this private key now — it is shown only once:</p>
        <pre>${esc(r.privateKey)}</pre>
        <p class="hint">Store it at <code>~/.ssh/id_ed25519</code> (chmod 600). Then upload with <code>scp -i ~/.ssh/id_ed25519 …</code></p>
        <button class="btn" id="pubDone">Continue</button>`;
      document.getElementById('pubDone').addEventListener('click', renderPublisher);
      document.getElementById('submitForm').classList.remove('hidden');
      return;
    }
    await renderPublisher();
  } catch (e) {
    box.innerHTML += `<p class="error">${esc(e.message)}</p>`;
  }
}

async function initSubmit() {
  const form = document.getElementById('submitForm');
  const out = document.getElementById('submitOut');
  const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ signedIn: false }));
  if (!me.signedIn) {
    out.innerHTML = `<p class="error">You must <a href="/login?redirect=/store/submit.html">sign in</a> to publish.</p>`;
    document.getElementById('pubPanel').classList.add('hidden');
    form.classList.add('hidden');
    return;
  }
  await renderPublisher();
  wireAutoIngest(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.innerHTML = '<p class="muted">Working…</p>';
    const fd = new FormData(form);
    let manifest;
    try { manifest = JSON.parse(fd.get('manifest')); }
    catch { out.innerHTML = '<p class="error">manifest.json is not valid JSON.</p>'; return; }
    const method = fd.get('method');
    const files = {};
    if (fd.get('crxFile')) files.crx = fd.get('crxFile').trim();
    if (fd.get('zipFile')) files.zip = fd.get('zipFile').trim();
    const urls = { bundleUrl: fd.get('bundleUrl') || null, crxUrl: fd.get('crxUrl') || null };
    try {
      // 1) create draft (this assigns the slug we need for the upload path)
      const draft = await api('/extensions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: fd.get('name'), summary: fd.get('summary'), description: fd.get('description'), homepageUrl: fd.get('homepageUrl'), iconUrl: form.dataset.iconUrl || null }),
      });

      // If uploading to files.profullstack.com, pause so they can scp to the
      // real slug path first; then finish. If they linked URLs, go straight on.
      if ((files.crx || files.zip) && !urls.crxUrl && !urls.bundleUrl) {
        out.innerHTML = `<p class="success">Draft created: <b>${esc(draft.slug)}</b>. Upload your bundle, then finish:</p>
          <pre>scp ${esc(files.crx || files.zip)} ${esc(SCP_TARGET)}:/public/extensions/${esc(draft.slug)}/</pre>
          <button class="btn" id="finishBtn">I've uploaded — validate &amp; pay $1 →</button>`;
        document.getElementById('finishBtn').addEventListener('click', () => finishPublish(draft, manifest, method, files, urls, out));
        return;
      }
      await finishPublish(draft, manifest, method, files, urls, out);
    } catch (err) {
      const extra = err.data?.errors ? '<br>• ' + err.data.errors.map(esc).join('<br>• ') : '';
      out.innerHTML = `<p class="error">${esc(err.message)}${extra}</p>`;
    }
  });
}

// Submit the MV3 version (HEAD-checks uploaded files) then start payment.
async function finishPublish(draft, manifest, method, files, urls, out) {
  try {
    out.innerHTML = '<p class="muted">Validating…</p>';
    const ver = await api(`/extensions/${draft.id}/versions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        manifest,
        files: (files.crx || files.zip) ? files : undefined,
        bundleUrl: urls.bundleUrl, crxUrl: urls.crxUrl, source: 'upload',
      }),
    });
    const warn = (ver.warnings || []).length ? `<p class="hint">⚠ ${ver.warnings.map(esc).join('<br>⚠ ')}</p>` : '';
    out.innerHTML = `<p class="success">Validated MV3 ✓ (v${esc(ver.version)}). Starting payment…</p>${warn}`;
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

/* ---------- global header: Sign in vs account dropdown (all pages) ---------- */
async function initHeaderAuth() {
  const bar = document.getElementById('acctbar');
  if (!bar) return;
  let me;
  try { me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()); }
  catch { return; }
  if (!me || !me.signedIn) return; // default "Sign in" link stays
  const label = me.email || (me.id ? me.id.slice(0, 8) : 'Account');
  bar.innerHTML =
    `<div class="account">
       <button class="acct-btn" id="acctBtn" aria-haspopup="true" aria-expanded="false">${esc(label)} ▾</button>
       <div class="acct-menu" id="acctMenu" hidden>
         <a href="/store/submit.html">Publish</a>
         <a href="/settings">Settings</a>
         <a href="#" id="signout">Sign out</a>
       </div>
     </div>`;
  const btn = document.getElementById('acctBtn');
  const menu = document.getElementById('acctMenu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hasAttribute('hidden');
    menu.toggleAttribute('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => menu.setAttribute('hidden', ''));
  document.getElementById('signout').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    location.reload();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.getAttribute('data-page');
  if (page === 'browse') initBrowse();
  else if (page === 'detail') initDetail();
  else if (page === 'submit') initSubmit();
  initTabs();
  initHeaderAuth();
});

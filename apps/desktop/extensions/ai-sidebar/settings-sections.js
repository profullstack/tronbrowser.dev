// Shared settings sections (Search / Markets / Sports / RSS feeds) used by BOTH
// the extension options page and the website settings page, so there is ONE
// implementation. Storage is abstracted behind a `store` adapter so each host
// persists however it likes:
//   extension -> chrome.storage.local (+ cloud push, cache invalidation)
//   website   -> the /api/settings object (Turso)
//
// Canonical file: apps/desktop/extensions/ai-sidebar/settings-sections.js
// Copied to apps/web/public/ by scripts/sync-shared-settings.mjs — edit here only.
import { DEFAULT_FEEDS, parseOpml, toOpml } from './feeds.js';

let ctx = null;        // { store, el, flash } — refreshed on every mount
let feeds = [];        // current feed list (module-level so listeners stay in sync)
let wired = false;     // listeners attached once

const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };

function renderFeeds() {
  const list = ctx.el('feedlist');
  if (!list) return;
  list.innerHTML = '';
  feeds.forEach((f, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span><b>${esc(f.title)}</b> <span class="cat">${esc(f.category || '')}</span><br><span class="cat">${esc(f.xmlUrl)}</span></span>`;
    const x = document.createElement('button');
    x.className = 'x'; x.textContent = '✕'; x.title = 'Remove';
    x.addEventListener('click', async () => { feeds.splice(i, 1); await persist(); });
    li.appendChild(x);
    list.appendChild(li);
  });
}
async function persist() { await ctx.store.set({ feeds }); renderFeeds(); }

/**
 * @param {object} o
 * @param {{get:(keys:string[])=>Promise<Record<string,any>>, set:(obj:Record<string,any>)=>Promise<void>}} o.store
 * @param {(id:string)=>HTMLElement|null} o.el     id -> element
 * @param {(id:string,msg:string)=>void}  o.flash  transient message
 */
export async function mountSettingsSections({ store, el, flash }) {
  ctx = { store, el, flash };
  const cur = await store.get(['feeds', 'tickers', 'leagues', 'searchEngine']);

  // Populate current values (on every mount, e.g. after a cloud pull).
  if (el('searchEngine')) el('searchEngine').value = cur.searchEngine || 'neosearch';
  if (el('tickers')) el('tickers').value = cur.tickers ?? '';
  if (el('leagues')) el('leagues').value = cur.leagues ?? '';
  feeds = Array.isArray(cur.feeds) && cur.feeds.length ? cur.feeds.slice() : DEFAULT_FEEDS.slice();
  renderFeeds();

  if (wired) return;   // attach listeners exactly once
  wired = true;

  el('saveSearch')?.addEventListener('click', async () => {
    await ctx.store.set({ searchEngine: el('searchEngine').value });
    ctx.flash('savedSearch', 'saved ✓');
  });
  el('saveMarkets')?.addEventListener('click', async () => {
    await ctx.store.set({ tickers: el('tickers').value.trim(), leagues: el('leagues').value.trim() });
    ctx.flash('savedMarkets', 'saved ✓');
  });
  el('addFeed')?.addEventListener('click', async () => {
    const url = el('fUrl').value.trim();
    if (!url) return ctx.flash('feedMsg', 'URL required');
    feeds.push({ title: el('fTitle').value.trim() || url, category: el('fCat').value.trim() || 'Feeds', xmlUrl: url, htmlUrl: url });
    el('fTitle').value = el('fCat').value = el('fUrl').value = '';
    await persist();
    ctx.flash('feedMsg', 'added ✓');
  });
  el('importOpml')?.addEventListener('click', async () => {
    let xml = el('opmlText') ? el('opmlText').value.trim() : '';
    const file = el('opmlFile')?.files?.[0];
    if (!xml && file) xml = await file.text();
    if (!xml) return ctx.flash('feedMsg', 'paste OPML or pick a file');
    const parsed = parseOpml(xml);
    if (!parsed.length) return ctx.flash('feedMsg', 'no feeds found in OPML');
    feeds = parsed;
    await persist();
    if (el('opmlText')) el('opmlText').value = '';
    ctx.flash('feedMsg', `imported ${parsed.length} feeds ✓`);
  });
  el('exportOpml')?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([toOpml(feeds)], { type: 'text/xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'tronbrowser-feeds.opml'; a.click();
    URL.revokeObjectURL(url);
  });
  el('resetFeeds')?.addEventListener('click', async () => { feeds = DEFAULT_FEEDS.slice(); await persist(); ctx.flash('feedMsg', 'reset ✓'); });
}

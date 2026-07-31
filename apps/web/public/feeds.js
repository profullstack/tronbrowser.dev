// Default RSS subscriptions (from the user's OPML). Overridable via OPML import
// in Settings (stored in chrome.storage.local under "feeds").
export const DEFAULT_FEEDS = [
  { category: 'Food', title: 'Taste of Home', xmlUrl: 'https://www.tasteofhome.com/feed/', htmlUrl: 'https://www.tasteofhome.com/' },
  { category: 'Profullstack, Inc.', title: 'BitTorrented Blog', xmlUrl: 'https://bittorrented.com/blog/rss.xml', htmlUrl: 'https://bittorrented.com/blog' },
  { category: 'Profullstack, Inc.', title: 'bl0ggers Blog', xmlUrl: 'https://bl0ggers.com/blog/rss.xml', htmlUrl: 'https://bl0ggers.com/blog' },
  { category: 'Profullstack, Inc.', title: 'c0mpute blog', xmlUrl: 'https://c0mpute.com/blog/rss.xml', htmlUrl: 'https://c0mpute.com/blog' },
  { category: 'Profullstack, Inc.', title: 'c0upons Blog', xmlUrl: 'https://c0upons.com/blog/rss.xml', htmlUrl: 'https://c0upons.com/blog' },
  { category: 'Profullstack, Inc.', title: 'CoinPay Blog', xmlUrl: 'https://coinpayportal.com/blog/rss.xml', htmlUrl: 'https://coinpayportal.com/blog' },
  { category: 'Profullstack, Inc.', title: 'CrawlProof blog', xmlUrl: 'https://crawlproof.com/blog/rss.xml', htmlUrl: 'https://crawlproof.com/blog' },
  { category: 'Profullstack, Inc.', title: 'd0rz blog', xmlUrl: 'https://d0rz.com/blog/rss.xml', htmlUrl: 'https://d0rz.com/blog' },
  { category: 'Profullstack, Inc.', title: 'PairUX Blog', xmlUrl: 'https://pairux.com/blog/rss.xml', htmlUrl: 'https://pairux.com/blog' },
  { category: 'Profullstack, Inc.', title: 'QryptChat Blog', xmlUrl: 'https://qrypt.chat/blog/rss.xml', htmlUrl: 'https://qrypt.chat/blog' },
  { category: 'Profullstack, Inc.', title: 'SaaSRow Blog', xmlUrl: 'https://saasrow.com/blog/rss.xml', htmlUrl: 'https://saasrow.com/blog' },
  { category: 'Profullstack, Inc.', title: 'sh1pt Blog', xmlUrl: 'https://sh1pt.com/blog/rss.xml', htmlUrl: 'https://sh1pt.com/blog' },
  { category: 'Profullstack, Inc.', title: 'ThreatCrush Blog', xmlUrl: 'https://threatcrush.com/blog/rss.xml', htmlUrl: 'https://threatcrush.com/blog' },
  { category: 'Profullstack, Inc.', title: 'ugig blog', xmlUrl: 'https://ugig.net/blog/rss.xml', htmlUrl: 'https://ugig.net/blog' },
  { category: 'Projects', title: 'MLT', xmlUrl: 'https://www.mltframework.org/feed.xml', htmlUrl: 'https://mltframework.org/' },
];

/** Parse an OPML string into the feeds array. */
export function parseOpml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out = [];
  for (const node of doc.querySelectorAll('outline[xmlUrl]')) {
    const parent = node.parentElement;
    const category = parent && parent.tagName === 'outline'
      ? parent.getAttribute('text') || parent.getAttribute('title') || 'Feeds'
      : 'Feeds';
    out.push({
      category,
      title: node.getAttribute('text') || node.getAttribute('title') || node.getAttribute('xmlUrl'),
      xmlUrl: node.getAttribute('xmlUrl'),
      htmlUrl: node.getAttribute('htmlUrl') || node.getAttribute('xmlUrl'),
    });
  }
  return out;
}

/** Parse an RSS/Atom feed document into {title, link, date, image} items. */
export function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const items = [];
  // RSS
  for (const it of doc.querySelectorAll('item')) {
    items.push({
      title: text(it, 'title'),
      link: text(it, 'link'),
      date: text(it, 'pubDate') || text(it, 'date'),
      image: image(it),
    });
  }
  // Atom
  if (items.length === 0) {
    for (const e of doc.querySelectorAll('entry')) {
      const link = e.querySelector('link');
      items.push({
        title: text(e, 'title'),
        link: link ? link.getAttribute('href') : '',
        date: text(e, 'updated') || text(e, 'published'),
        image: image(e),
      });
    }
  }
  return items;
}

function text(parent, tag) {
  const el = parent.querySelector(tag);
  return el ? el.textContent.trim() : '';
}

const IMG_RE = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;
function okUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }

// Best-effort thumbnail for a feed item: Media RSS, image enclosure, podcast art,
// or the first <img> embedded in the content. Returns '' when none is available.
function image(it) {
  const tag = (n) => it.getElementsByTagName(n)[0];
  // Media RSS: <media:thumbnail url> / <media:content url medium="image">
  const mt = tag('media:thumbnail');
  if (mt && okUrl(mt.getAttribute('url'))) return mt.getAttribute('url');
  for (const mc of it.getElementsByTagName('media:content')) {
    const url = mc.getAttribute('url');
    const medium = mc.getAttribute('medium') || mc.getAttribute('type') || '';
    if (okUrl(url) && (/image/i.test(medium) || IMG_RE.test(url))) return url;
  }
  // <enclosure type="image/..."> or an image-looking url
  for (const enc of it.getElementsByTagName('enclosure')) {
    const url = enc.getAttribute('url');
    const type = enc.getAttribute('type') || '';
    if (okUrl(url) && (/^image\//i.test(type) || IMG_RE.test(url))) return url;
  }
  // Podcast/iTunes artwork
  const ii = tag('itunes:image');
  if (ii && okUrl(ii.getAttribute('href'))) return ii.getAttribute('href');
  // First <img src> inside content:encoded or description HTML
  const html = (tag('content:encoded')?.textContent) || text(it, 'description') || '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && okUrl(m[1])) return m[1];
  return '';
}

/** Serialize feeds back to OPML (grouped by category). */
export function toOpml(feeds) {
  const byCat = {};
  for (const f of feeds) (byCat[f.category || 'Feeds'] ||= []).push(f);
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  let body = '';
  for (const [cat, items] of Object.entries(byCat)) {
    body += `    <outline text="${esc(cat)}" title="${esc(cat)}">\n`;
    for (const f of items) {
      body += `      <outline text="${esc(f.title)}" title="${esc(f.title)}" type="rss" xmlUrl="${esc(f.xmlUrl)}" htmlUrl="${esc(f.htmlUrl)}"/>\n`;
    }
    body += '    </outline>\n';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>TronBrowser RSS Subscriptions</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${body}  </body>
</opml>
`;
}

/** Load feeds from storage, falling back to the OPML defaults. */
export async function loadFeeds() {
  const { feeds } = await chrome.storage.local.get('feeds');
  return Array.isArray(feeds) && feeds.length ? feeds : DEFAULT_FEEDS;
}

export async function saveFeeds(feeds) {
  await chrome.storage.local.set({ feeds });
}

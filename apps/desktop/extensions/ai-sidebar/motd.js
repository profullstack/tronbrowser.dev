// Message of the Day, fetched from profullstack.com and cached in
// chrome.storage.local. The /motd endpoint is plain text (message + signature)
// and CORS-open. Falls back to the last cached value if the network fails.

const MOTD_URL = 'https://profullstack.com/motd';
const MOTD_TTL = 30 * 60 * 1000; // 30 min

export async function fetchMotd() {
  const { motdCache } = await chrome.storage.local.get('motdCache');
  if (motdCache && motdCache.text && Date.now() - motdCache.at < MOTD_TTL) {
    return motdCache.text;
  }
  try {
    const res = await fetch(MOTD_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = (await res.text()).trim();
    await chrome.storage.local.set({ motdCache: { at: Date.now(), text } });
    return text;
  } catch (e) {
    if (motdCache && motdCache.text) return motdCache.text; // stale-but-better-than-nothing
    throw e;
  }
}

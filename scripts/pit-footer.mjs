// The pit.world global footer for the static site Caddy serves from /srv.
// Runs beside Caddy (start.sh): fetches the snippet server-side at boot and then
// hourly, and writes it between the <!--pit-footer--> markers each page carries
// just before </body>. Any failure keeps the last good copy (or nothing), so a
// pit.world outage never breaks a page. Writes are temp-file + rename (atomic).
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const URL = "https://pit.world/snippets/footer.html?site=tronbrowser.dev";
const ROOT = process.env.PIT_FOOTER_ROOT || "/srv";
const EVERY_MS = 60 * 60 * 1000;
const MARKERS = /<!--pit-footer-->[\s\S]*?<!--\/pit-footer-->/;

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(path)));
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

async function refresh() {
  let snippet;
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snippet = (await res.text()).trim();
    if (!snippet.includes("data-pit-footer")) throw new Error("no data-pit-footer");
  } catch (err) {
    console.error(`[pit-footer] fetch failed, keeping last copy: ${err.message}`);
    return;
  }
  const block = `<!--pit-footer-->${snippet}<!--/pit-footer-->`;
  for (const file of await htmlFiles(ROOT)) {
    try {
      const html = await readFile(file, "utf8");
      if (!MARKERS.test(html)) continue;
      const next = html.replace(MARKERS, () => block);
      if (next === html) continue;
      await writeFile(`${file}.pit-tmp`, next);
      await rename(`${file}.pit-tmp`, file);
    } catch (err) {
      console.error(`[pit-footer] ${file}: ${err.message}`);
    }
  }
}

await refresh();
if (!process.argv.includes("--once")) setInterval(refresh, EVERY_MS);

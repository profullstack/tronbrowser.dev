// Smoke-test the hosted relay (tronbrowser.dev/mcp/tron) against the real
// engines, without the rest of the API: serves the relay on loopback, runs the
// MCP handshake, a few fetches through both engines, a private-target refusal
// and a screenshot, then checks no tab was left open.
//
//   pnpm --filter @tronbrowser/api build
//   TRON_MCP_CHROMIUM_BIN=/opt/ungoogled-chromium/chrome OBSCURA_BIN=/opt/obscura/obscura \
//     node services/api/scripts/mcp-smoke.mjs
import { serve } from '@hono/node-server';
import { tronRelay } from '../dist/mcp/tron.js';

const port = Number(process.env.PORT || 38790);
const relay = tronRelay({ log: (l) => console.error('[relay]', l) });
const server = serve({ fetch: relay.app.fetch, port, hostname: '127.0.0.1' }, () => console.error(`smoke: relay on 127.0.0.1:${port}`));
const base = `http://127.0.0.1:${port}/`;
const post = (body) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const short = (s) => s.slice(0, 70).replace(/\n/g, ' ');

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

try {
  const health = await (await fetch(base)).json();
  check('GET describes the relay', health.ok === true && Array.isArray(health.tools), JSON.stringify(health));
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  check('initialize', init.result?.serverInfo?.name === 'tronbrowser');

  let id = 2;
  const cases = [
    ['https://example.com/', {}, 'obscura'],
    ['https://github.com/h4ckf0r0day/obscura', { engine: 'chromium', max_chars: 2000 }, 'chromium'],
    ['https://news.ycombinator.com/', { format: 'links', max_chars: 3000 }, undefined],
  ];
  for (const [url, extra, expectEngine] of cases) {
    const r = (await post({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'fetch_page', arguments: { url, ...extra } } })).result;
    if (r.isError) {
      check(`fetch ${url}`, false, r.content[0].text);
      continue;
    }
    const outcome = JSON.parse(r.content[1].text);
    check(`fetch ${url}`, !expectEngine || outcome.engine === expectEngine, `${r.content[1].text} | ${short(r.content[0].text)}`);
  }
  const priv = (await post({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'fetch_page', arguments: { url: 'http://localhost:8090/api/healthz' } } })).result;
  check('private target refused', priv.isError === true, priv.content[0].text);

  const shot = (await post({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'screenshot_page', arguments: { url: 'https://example.com/' } } })).result;
  const png = shot.isError ? null : Buffer.from(shot.content[0].data, 'base64');
  check('screenshot_page is a PNG', png !== null && png.subarray(1, 4).toString() === 'PNG', shot.isError ? shot.content[0].text : `${png.length} bytes`);

  check('no tab left open', relay.engines?.chromium.openPages() === 0, `open=${relay.engines?.chromium.openPages()}`);
} finally {
  await relay.close();
  server.close();
}
console.log(failed ? `smoke: ${failed} failed` : 'smoke: all good');
process.exit(failed ? 1 : 0);

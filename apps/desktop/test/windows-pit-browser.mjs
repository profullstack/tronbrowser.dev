import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.env.PIT_PLAYWRIGHT_DIR, 'package.json'));
const { chromium } = require('playwright-core');
const [profile, phase, evidence, invalidTlsUrl] = process.argv.slice(2);
const [port] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const results = { phase, browser: browser.version(), checks: [] };
const check = (name) => { results.checks.push(name); console.log(`PASS: ${name}`); };
let context;
try {
  context = browser.contexts()[0];
  const worker = context.serviceWorkers()[0]
    || await context.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).host;
  const controls = await context.newPage();
  await controls.goto(`chrome-extension://${id}/options.html`);
  const message = (type, on) => controls.evaluate(
    ({ type, on }) => chrome.runtime.sendMessage({ type, on }), { type, on });

  assert.equal((await message('pit-status')).enabled, false);
  check('fresh browser session starts with Pit off');
  const enabled = await message('pit-set', true);
  assert.equal(enabled.enabled, true, JSON.stringify(enabled));
  assert.equal(enabled.port, 9081);
  assert.equal(enabled.check?.ok, true, JSON.stringify(enabled.check));
  const proxy = await controls.evaluate(() => chrome.proxy.settings.get({ incognito: false }));
  assert.equal(proxy.value.mode, 'pac_script');
  check('real extension starts helper and installs PAC without preflight failure');

  const page = await context.newPage();
  const http = await page.goto('http://mosh.eggs/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert.equal(http.status(), 200);
  check('HTTP Moshpit name resolves through the browser');

  if (phase === 'before-trust') {
    await assert.rejects(page.goto('https://profullstack.agent/', {
      waitUntil: 'domcontentloaded', timeout: 45000,
    }), /ERR_CERT_AUTHORITY_INVALID/);
    await page.screenshot({ path: path.join(evidence, 'before-trust.png') });
    check('registry HTTPS is rejected before root consent');
  } else {
    const response = await page.goto('https://profullstack.agent/', {
      waitUntil: 'domcontentloaded', timeout: 45000,
    });
    assert.equal(response.status(), 200);
    assert.equal(new URL(page.url()).hostname, 'profullstack.agent');
    assert.ok((await page.locator('body').innerText()).length > 50);
    results.title = await page.title();
    results.url = page.url();
    results.security = await response.securityDetails();
    await page.screenshot({ path: path.join(evidence, 'after-trust.png'), fullPage: true });
    check('registry HTTPS succeeds with normal browser certificate verification');
  }

  await assert.rejects(page.goto(invalidTlsUrl, {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }), /ERR_CERT_AUTHORITY_INVALID/);
  check('unrelated self-signed HTTPS remains rejected');

  assert.equal((await message('pit-set', false)).enabled, false);
  const off = await controls.evaluate(() => chrome.proxy.settings.get({ incognito: false }));
  assert.notEqual(off.value.mode, 'pac_script');
  const normal = await page.goto('https://example.com/', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  assert.equal(normal.status(), 200);
  check('Pit off restores normal HTTPS browsing');

  // Leave persisted local state ON, then require the next fresh session to
  // clear it. This exercises real storage.session reset, not a mocked reset.
  assert.equal((await message('pit-set', true)).enabled, true);
  check('Pit can be re-enabled in the same session');
} catch (error) {
  results.error = String(error.stack || error);
  for (const [index, page] of (context?.pages() || []).entries()) {
    await page.screenshot({ path: path.join(evidence, `${phase}-failure-${index}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  fs.writeFileSync(path.join(evidence, `${phase}.json`), JSON.stringify(results, null, 2));
  await browser.close();
}

// `tron run <script>` — execute a user JS/TS automation script that imports
// `@tronbrowser/sdk` (PRD M3.4). Node >= 24 strips TS types natively, so .ts
// runs with no build step. The @tronbrowser/* imports resolve to the runtime
// shipped alongside this file via the registered resolver hook.
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, resolve as resolvePath, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sdkEntry = join(here, 'sdk', 'index.js');
const coreEntry = join(here, 'automate', 'index.js');

const argv = process.argv.slice(2);
let script;
const passthrough = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--') { passthrough.push(...argv.slice(i + 1)); break; }
  if (!script && !a.startsWith('-')) { script = a; continue; }
  if (a === '--headless') { process.env.TRON_RUN_HEADLESS = '1'; continue; }
  if (a === '--profile') { process.env.TRON_RUN_PROFILE = argv[++i]; continue; }
  if (a === '--trace') { process.env.TRON_RUN_TRACE = resolvePath(argv[++i]); continue; }
  passthrough.push(a);
}

if (!script) {
  process.stderr.write('usage: tron run <script.js|.ts> [--headless] [--profile <name>] [--trace <dir>]\n');
  process.exit(2);
}

const scriptPath = resolvePath(script);
if (!existsSync(scriptPath)) {
  process.stderr.write(`tron run: script not found: ${script}\n`);
  process.exit(2);
}
if (!existsSync(sdkEntry)) {
  process.stderr.write('This TronBrowser build lacks the SDK runtime. Run: tron upgrade\n');
  process.exit(1);
}

register(pathToFileURL(join(here, 'tron-run-hooks.mjs')), import.meta.url, {
  data: {
    '@tronbrowser/sdk': pathToFileURL(sdkEntry).href,
    '@tronbrowser/browser-core': pathToFileURL(coreEntry).href,
  },
});

// Present argv to the script as if it were invoked directly.
process.argv = [process.argv[0], scriptPath, ...passthrough];

try {
  await import(pathToFileURL(scriptPath).href);
} catch (err) {
  process.stderr.write(`tron run: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}

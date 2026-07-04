// Generic launcher for shipped Node bins that import @tronbrowser/* packages by
// bare specifier (e.g. analyze-bin -> @tronbrowser/browser-core). Registers the
// resolver hook that maps those specifiers to the sibling dist trees in the
// launcher payload, then runs the target entry.
//
//   node tron-node.mjs <entry.js> [args...]
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, 'tron-run-hooks.mjs')), import.meta.url, {
  data: {
    '@tronbrowser/browser-core': pathToFileURL(join(here, 'automate', 'index.js')).href,
    '@tronbrowser/agent-runtime': pathToFileURL(join(here, 'analyze', 'index.js')).href,
    '@tronbrowser/sdk': pathToFileURL(join(here, 'sdk', 'index.js')).href,
  },
});

const entry = process.argv[2];
if (!entry) {
  process.stderr.write('tron-node: missing entry\n');
  process.exit(2);
}
process.argv = [process.argv[0], entry, ...process.argv.slice(3)];
await import(pathToFileURL(entry).href);

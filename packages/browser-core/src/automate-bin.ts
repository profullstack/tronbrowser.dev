/**
 * Executable wrapper around the automation CLI. Built into a self-contained
 * `automate.js` (see apps/desktop/scripts/build-release.sh) that the shell
 * `tron` dispatcher runs via `node`.
 */
import { run } from './automate-cli.js';

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`tron: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);

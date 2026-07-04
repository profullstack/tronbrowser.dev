/**
 * Executable wrapper for `tron analyze`. Built into the launcher payload as
 * `analyze/analyze-bin.js`; the shell dispatcher runs it via node.
 */
import { run } from './analyze-cli.js';

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`tron: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);

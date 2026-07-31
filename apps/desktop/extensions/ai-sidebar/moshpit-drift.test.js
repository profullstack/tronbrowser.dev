// Both local copies of the resolution policy, against the published one.
//
// These rules exist twice here: moshpit-resolve.ts, and a hand port of it into
// the extension because the extension is plain JS and `pnpm build` is `tsc`,
// which compiles but does not bundle. A package cannot be imported at runtime
// from an unbundled extension, so the copies stay.
//
// moshpit.test.js already compares those two against each other. That catches
// one of them drifting and misses both drifting together — and "both" is the
// likely case, since the same person edits them in the same commit.
//
// So this anchors each of them to @moshcoder/moshpit-resolve instead: the
// published package is the reference, and either copy leaving it is caught.
// Behaviour rather than bytes, because the copies legitimately differ in
// comments, in TypeScript types, and in the chrome-coupled config reader the
// package deliberately does not carry.
import { describe, expect, it } from 'vitest';

import * as ext from './moshpit.js';
import * as ts from '../../src/moshpit-resolve';
import * as pkg from '@moshcoder/moshpit-resolve';

const HOSTNAMES = [
  'blue.eggs', 'a.b.c', '1.2.3.4', 'localhost', '', 'eggs', 'mosh.eggs',
  'blue.420', '420.blue', '1.420', '192.168', 'x.y', 'A.EGGS.',
];

const LOOKUPS = [
  null,
  { registered: false, resolved: '', target: null },
  { registered: true, name_registered: false, resolved: 'blue.eggs', target: null },
  { registered: true, name_registered: true, resolved: 'blue.eggs', target: null },
  { registered: true, name_registered: true, resolved: 'blue.eggs', target: '203.0.113.9' },
];

// The three implementations, named so a failure says which one moved.
const IMPLS = [['extension', ext], ['typescript', ts]];

describe('every local copy still matches @moshcoder/moshpit-resolve', () => {
  for (const [name, impl] of IMPLS) {
    describe(name, () => {
      it('parses hostnames the same way', () => {
        for (const h of HOSTNAMES) {
          expect(impl.parseRegistryName(h), h).toEqual(pkg.parseRegistryName(h));
        }
      });

      it('builds the same gateway and parking URLs', () => {
        for (const h of ['blue.eggs', 'a.b']) {
          expect(impl.gatewayUrlFor(h)).toBe(pkg.gatewayUrlFor(h));
          expect(impl.parkingUrlFor(h)).toBe(pkg.parkingUrlFor(h));
          // A self-hosted pit has to be followed by all of them or none.
          expect(impl.gatewayUrlFor(h, 'https://my.pit/')).toBe(pkg.gatewayUrlFor(h, 'https://my.pit/'));
          expect(impl.parkingUrlFor(h, 'https://my.pit/')).toBe(pkg.parkingUrlFor(h, 'https://my.pit/'));
        }
      });

      it('agrees on the console label', () => {
        for (const h of HOSTNAMES) {
          expect(impl.consoleUrlFor(h), h).toEqual(pkg.consoleUrlFor(h));
        }
      });

      it('decides resolution identically across the whole input space', () => {
        for (const hostname of HOSTNAMES) {
          for (const mode of ['clearnet', 'moshpit']) {
            for (const clearnetResolves of [true, false]) {
              for (const moshpit of LOOKUPS) {
                const inputs = { hostname, mode, clearnetResolves, moshpit };
                expect(impl.decideResolution(inputs), JSON.stringify(inputs))
                  .toEqual(pkg.decideResolution(inputs));
              }
            }
          }
        }
      });

      it('shares the defaults', () => {
        for (const key of ['DEFAULT_REGISTRY_BASE', 'DEFAULT_CONSOLE_BASE', 'DEFAULT_PARKING_BASE', 'CONSOLE_LABEL']) {
          expect(impl[key], key).toBe(pkg[key]);
        }
      });
    });
  }

  it('the package is a subset — it carries no chrome coupling', () => {
    // moshpitConfig reads chrome.storage, which is why the package does not
    // have it. If it ever appears there, the package has stopped being usable
    // outside a browser extension.
    expect(pkg.moshpitConfig).toBeUndefined();
    expect(typeof ext.moshpitConfig).toBe('function');
  });
});

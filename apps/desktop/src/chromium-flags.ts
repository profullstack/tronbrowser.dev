/**
 * Command-line flags passed to the TronBrowser (Chromium fork) binary at launch.
 *
 * This is where the PRD privacy guarantees are enforced at runtime, on top of
 * the compile-time GN args in `chromium/config/gn-args`. Kept as pure data so it
 * is unit-testable and auditable.
 */

export interface LaunchOptions {
  /** Absolute path to the user's profile/data directory. */
  userDataDir?: string;
  /** Opt-in only. Defaults to false — no telemetry by default (PRD §Principles). */
  telemetry?: boolean;
  /** Extra flags appended verbatim (escape hatch for power users). */
  extraFlags?: string[];
}

/**
 * Flags that hard-disable phone-home / telemetry / sponsored surfaces. These are
 * always present unless telemetry is explicitly opted into.
 */
export const PRIVACY_FLAGS = [
  '--disable-background-networking',
  '--disable-domain-reliability',
  '--disable-breakpad',
  '--disable-crash-reporter',
  '--disable-features=Translate,OptimizationHints,InterestFeedContentSuggestions',
  '--no-default-browser-check',
  '--no-pings',
  '--metrics-recording-only=false',
  '--disable-sync',
] as const;

/** Flags that must never appear — ads, sponsored tabs, affiliate injection. */
export const FORBIDDEN_FLAG_SUBSTRINGS = [
  'sponsored',
  'affiliate',
  'ad-injection',
] as const;

/**
 * Builds the full, ordered flag list for launching the browser.
 * @throws if any flag would enable a forbidden surface.
 */
export function buildLaunchFlags(opts: LaunchOptions = {}): string[] {
  const flags: string[] = [];

  if (!opts.telemetry) {
    flags.push(...PRIVACY_FLAGS);
  }

  if (opts.userDataDir) {
    flags.push(`--user-data-dir=${opts.userDataDir}`);
  }

  if (opts.extraFlags) {
    flags.push(...opts.extraFlags);
  }

  for (const flag of flags) {
    const lower = flag.toLowerCase();
    for (const banned of FORBIDDEN_FLAG_SUBSTRINGS) {
      if (lower.includes(banned)) {
        throw new Error(`Refusing to launch: forbidden flag "${flag}" (${banned})`);
      }
    }
  }

  return flags;
}

/** True when telemetry is explicitly enabled. Defaults to false. */
export function telemetryEnabled(opts: LaunchOptions = {}): boolean {
  return opts.telemetry === true;
}

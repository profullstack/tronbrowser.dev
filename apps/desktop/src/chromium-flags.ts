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
  /**
   * Route all traffic through the local Tor SOCKS5 proxy (127.0.0.1:9071).
   * Hides your IP and lets `.onion` sites resolve. Implies `incognito` unless
   * explicitly disabled. NOT Tor-Browser-grade anonymity — see
   * `docs/tor-onion-mode.md`.
   */
  tor?: boolean;
  /**
   * Open in a fresh incognito (off-the-record) window — no history/cookies
   * persisted to disk. Tor mode defaults this to true; pass `false` to override
   * (discouraged).
   */
  incognito?: boolean;
  /** SOCKS5 port the local Tor daemon listens on. Defaults to 9071. */
  torSocksPort?: number;
  /** Extra flags appended verbatim (escape hatch for power users). */
  extraFlags?: string[];
}

/**
 * Default SOCKS5 port for TronBrowser's OWN Tor daemon. Deliberately NOT 9050
 * (system tor) or 9150 (Tor Browser) — we run our own bundled tor here so we
 * never collide with or depend on any existing Tor on the system.
 */
export const DEFAULT_TOR_SOCKS_PORT = 9071;

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
  '--disable-sync',
] as const;

/**
 * Builds the flags that route the browser through the local Tor SOCKS5 proxy.
 *
 * Chromium's SOCKS5 proxy performs *remote* DNS resolution (the hostname is
 * handed to the proxy), so names — including `.onion` — are resolved inside Tor
 * and never leak to the local resolver. The WebRTC policy stops UDP from
 * escaping around the proxy and revealing the real IP.
 */
export function buildTorFlags(socksPort: number = DEFAULT_TOR_SOCKS_PORT): string[] {
  return [
    `--proxy-server=socks5://127.0.0.1:${socksPort}`,
    // Force everything (incl. loopback) through the proxy; bypass nothing.
    '--proxy-bypass-list=<-loopback>',
    // Prevent WebRTC from leaking the real IP via non-proxied UDP.
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  ];
}

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

  if (opts.tor) {
    flags.push(...buildTorFlags(opts.torSocksPort));
  }

  // Tor implies a fresh, no-trace window unless the caller explicitly opts out.
  if (incognitoEnabled(opts)) {
    flags.push('--incognito');
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

/** True when traffic should be routed through Tor. */
export function torEnabled(opts: LaunchOptions = {}): boolean {
  return opts.tor === true;
}

/**
 * True when the window should be incognito. Tor mode defaults to incognito; the
 * caller can force it off with `incognito: false` (discouraged). Without Tor,
 * incognito is opt-in.
 */
export function incognitoEnabled(opts: LaunchOptions = {}): boolean {
  if (opts.incognito !== undefined) {
    return opts.incognito;
  }
  return opts.tor === true;
}

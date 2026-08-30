// What the Chrome Web Store page's "Add to TronBrowser" button should actually do.
//
// The button used to install unconditionally, and that is how it hangs. TronBrowser
// bundles MarkSyncr and loads it with --load-extension, and MarkSyncr's Web Store
// manifest carries a `key`, so the bundled copy claims the SAME extension id as the
// store listing (hjcjjcpialiakkalcgadnfnoomdaegjg). Clicking Add on that listing asks
// Chromium to install a downloaded CRX over an extension it already has from a
// command-line (unpacked) location — which a CRX can never replace. The install prompt
// has nothing to complete, so it sits there spinning and will not dismiss.
//
// Any already-installed extension has the same problem, not just the bundled one, so
// the rule is general: look the id up before offering to install it, and offer the
// action that can actually succeed — nothing when it is already there and enabled,
// enabling it when it is there and switched off, installing only when it is absent.
//
// Deciding this is pure and lives here so it can be tested without a browser. The
// lookup itself needs chrome.management, which only the service worker has.

/**
 * Budget for the chrome.management lookup. It reads the local extension registry and
 * should be instant; anything near this is already broken, and a lookup that never
 * settles must not be what decides whether the button appears.
 */
export const MANAGEMENT_TIMEOUT_MS = 3000;

/**
 * Look an extension id up in this browser. Resolves to a small record when it is
 * installed, or null when it isn't — and null, too, on any failure (no management
 * permission, a stalled registry). Never rejects: an unknown answer must leave the
 * button exactly as capable as it was before this check existed.
 */
export async function lookupInstalled(id, management = globalThis.chrome?.management) {
  if (!id || !management?.get) return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), MANAGEMENT_TIMEOUT_MS));
  const lookup = (async () => {
    try {
      const info = await management.get(id);
      if (!info) return null;
      return {
        id: info.id,
        name: info.name,
        version: info.version,
        enabled: info.enabled !== false,
        // 'development' is what --load-extension produces: the copy we bundle.
        bundled: info.installType === 'development',
      };
    } catch (_) {
      // management.get rejects for an id that isn't installed. That is the common
      // case and the answer we want, not an error.
      return null;
    }
  })();
  return Promise.race([lookup, timeout]);
}

/**
 * Decide the button. Pure.
 *
 * @param {object} state
 * @param {?object} state.installed  Result of `lookupInstalled`, or null.
 * @param {?string} state.tronDownloadUrl  TronBrowser-store download, when listed there.
 * @param {?string} state.crxUrl  Chrome Web Store CRX, the fallback.
 * @returns {{action: 'none'|'enable'|'navigate', url?: string, id?: string, label: string, title: string}}
 */
export function decideInstallTarget({ installed, tronDownloadUrl, crxUrl } = {}) {
  if (installed) {
    if (!installed.enabled) {
      return {
        action: 'enable',
        id: installed.id,
        label: '⏻ Enable in TronBrowser',
        title: `${installed.name || 'This extension'} is already installed but switched off. Installing again cannot fix that — this turns it back on.`,
      };
    }
    return {
      action: 'none',
      id: installed.id,
      label: installed.bundled ? '✓ Bundled with TronBrowser' : '✓ Already in TronBrowser',
      title: installed.bundled
        ? `${installed.name || 'This extension'} ${installed.version ? `v${installed.version} ` : ''}ships with TronBrowser and is already running. Installing it from the Web Store cannot replace the bundled copy — the prompt would never finish.`
        : `${installed.name || 'This extension'} ${installed.version ? `v${installed.version} ` : ''}is already installed and enabled.`,
    };
  }

  if (tronDownloadUrl) {
    return {
      action: 'navigate',
      url: tronDownloadUrl,
      label: '⬇ Add from TronBrowser Store',
      title: 'Install from the TronBrowser store (not published on the Chrome Web Store)',
    };
  }

  return {
    action: 'navigate',
    url: crxUrl,
    label: '⬇ Add to TronBrowser',
    title: 'Install this extension (Ungoogled Chromium disables the native button)',
  };
}

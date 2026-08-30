# TronBrowser AI Sidebar (M2)

A privacy-first AI side panel as a Manifest V3 Chrome extension — it loads into
the TronBrowser (Ungoogled Chromium) fork and into any Chromium browser, which
keeps Chrome-extension compatibility (PRD §Desktop).

## Features

- Side panel chat with streaming responses.
- **Bring your own key** — the 8 providers used across Profullstack apps:
  Anthropic, OpenAI, Google/Gemini, DeepSeek, Perplexity, Kimi (Moonshot),
  Qwen (DashScope) — plus local Ollama / LM Studio / vLLM (no key).
- Optional **page context** (current tab title + URL) toggle.
- Keys stay in `chrome.storage.local`; requests go only to the chosen provider.
  No telemetry.

## Load it (unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder
   (`apps/desktop/extensions/ai-sidebar`).
3. Click the toolbar action to open the side panel.
4. Open **Settings** (⚙), pick a provider, paste your API key + model, Save.

## The Chrome Web Store button

Ungoogled Chromium greys out Google's native "Add to Chrome", so `install-helper.js`
injects a working **Add to TronBrowser** button on Web Store detail pages. It resolves
the target through the service worker, which checks in this order:

1. **Is the extension already installed?** If so the button does not offer an install.
   Installing over an extension the browser already has leaves Chromium's prompt
   spinning with nothing to complete and no way to dismiss it. This is not
   hypothetical: TronBrowser bundles MarkSyncr and loads it with `--load-extension`,
   and MarkSyncr's Web Store manifest carries a `key`, so the bundled copy claims the
   same id as its store listing (`hjcjjcpialiakkalcgadnfnoomdaegjg`). Opening that
   listing and clicking Add used to hang the browser's install dialog. An
   installed-but-disabled extension gets an **Enable** button instead — installing
   again could not have fixed that either.
2. **The TronBrowser store**, since we do not publish on the Chrome Web Store.
3. **The Chrome Web Store CRX**, which installs thanks to the launcher pre-seeding
   `extension-mime-request-handling = Always prompt for install`.

If the worker can't answer within 5s the button falls back to a plain CRX install, so
an unknown answer never makes it less capable than it was.

Anything a bundled extension needs from the store — an update, a reinstall — has to go
through the bundle, not this button. A `--load-extension` copy outranks a downloaded
CRX and cannot be replaced by one.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest (side_panel, storage, tabs, management, host permissions) |
| `background.js` | Opens the panel on action click; resolves store-install targets |
| `install-helper.js` | The "Add to TronBrowser" button on Web Store detail pages |
| `install-state.js` | Pure decision + `chrome.management` lookup behind that button |
| `sidepanel.html/.css/.js` | The chat UI |
| `options.html/.js` | Provider + key configuration |
| `providers.js` | Provider endpoints + streaming chat (mirrors `@tronbrowser/model-providers`) |

The TypeScript engine (`@tronbrowser/model-providers`, `@tronbrowser/ai-core`)
backs services/agents; this extension is the in-browser runtime. A future build
step will bundle the shared packages in place of `providers.js`.

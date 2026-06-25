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

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest (side_panel, storage, tabs, host permissions) |
| `background.js` | Opens the panel on action click |
| `sidepanel.html/.css/.js` | The chat UI |
| `options.html/.js` | Provider + key configuration |
| `providers.js` | Provider endpoints + streaming chat (mirrors `@tronbrowser/model-providers`) |

The TypeScript engine (`@tronbrowser/model-providers`, `@tronbrowser/ai-core`)
backs services/agents; this extension is the in-browser runtime. A future build
step will bundle the shared packages in place of `providers.js`.

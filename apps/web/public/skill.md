# Skill: TronBrowser CLI

Use the `tron` command-line interface to open URLs and manage the TronBrowser
(privacy-first, Ungoogled-Chromium) browser from a shell or an agent.

## Install

```bash
curl -fsSL https://tronbrowser.dev/install.sh | sh
```

## Commands

| Command | Description |
| --- | --- |
| `tron <url> [url...]` | Open one or more URLs in TronBrowser |
| `tron open <url>` | Explicit form of the above |
| `tron` | Launch the browser |
| `tron upgrade` | Update to the latest release |
| `tron remove` | Uninstall (keeps your profile data) |
| `tron version` | Print the installed version |
| `tron help` | Show help |

## Examples

```bash
tron https://example.com
tron https://a.com https://b.com
tron upgrade
```

## Notes

- Privacy flags are applied by default; sponsored/affiliate flags are refused.
- AI sidebar is bundled; configure your own provider API keys in its settings.
- More: https://tronbrowser.dev/ · https://github.com/profullstack/tronbrowser.dev

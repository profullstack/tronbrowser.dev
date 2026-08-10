# TronBrowser Android patches

Applied by [`../scripts/apply-patches.sh`](../scripts/apply-patches.sh) **after**
the Ungoogled Chromium patch set, in the order listed in [`series`](series).
Each entry lives at `tronbrowser-android/<name>.patch`. The release preflight
and patch script fail closed when an entry is missing or empty; `series` is a
required build manifest, not a list of optional placeholders.

## The series

| # | Patch | Concern |
|---|---|---|
| 0001 | branding-strings | Replace Chromium/Chrome product strings (see `../branding/BRANDING`). |
| 0002 | disable-telemetry-residual | Strip residual telemetry the GN flags miss. |
| 0003 | remove-sponsored-integrations | Remove sponsored tiles / affiliate surfaces (PRD). |
| 0004 | default-search-and-newtab | TronBrowser default search + new-tab page. |
| 0005 | strip-gms-gcm-feedback | Remove Google Mobile Services / GCM / feedback (Android-specific de-google). |
| 0006 | enable-extension-support | Roadmap placeholder only: experimental Android extensions, pending a Cromite proof of concept and product decision. |
| 0007 | tor-proxy-toggle | In-browser Tor toggle → bundled `tor` SOCKS5 (see `../scripts/tor.sh`). |
| 0008 | always-incognito-and-privacy-defaults | Privacy-leaning defaults matching the desktop launcher. |

## Generating a patch

```bash
# after editing the checkout under $TB_WORKDIR/src
git -C "$TB_WORKDIR/src" diff \
  > apps/android-engine/chromium/patches/tronbrowser-android/0007-tor-proxy-toggle.patch
```

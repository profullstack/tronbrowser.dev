# TronBrowser patches

TronBrowser-specific source patches, applied **after** the Ungoogled Chromium
patch set during `scripts/apply-patches.sh`. Order is defined by [`series`](./series).

| Patch | Purpose |
| --- | --- |
| `0001-branding-strings.patch` | Replace Chromium/Google Chrome product strings with TronBrowser (PRD: replace branding) |
| `0002-disable-telemetry-residual.patch` | Strip any residual metrics/UMA/variations call sites Ungoogled leaves (PRD: no telemetry) |
| `0003-remove-sponsored-integrations.patch` | Remove sponsored NTP tiles, promo surfaces, affiliate hooks (PRD: no sponsored tabs / no affiliate injection) |
| `0004-default-search-and-newtab.patch` | Neutral default search + clean new-tab page |

## Generating a patch

```bash
# from the chromium source checkout, after making edits:
git diff > <path>/apps/desktop/chromium/patches/tronbrowser/0001-branding-strings.patch
```

Patches are kept empty in-repo until the first real fork checkout exists; the
table above is the spec each must satisfy. `apply-patches.sh` skips missing or
empty patch files with a warning so the pipeline stays runnable during M1.

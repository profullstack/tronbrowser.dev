# Branding assets

Drop TronBrowser product icons here; the branding patch copies them over the
upstream `chrome/app/theme/chromium` assets during `apply-patches.sh`.

Required (PNG, square):
- `product_logo_16.png`, `_22`, `_24`, `_32`, `_48`, `_64`, `_128`, `_256`
- macOS: `app.icns`
- Windows: `tronbrowser.ico`

Until real assets land, the build falls back to upstream Chromium icons.

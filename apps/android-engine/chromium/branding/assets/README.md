# Android engine branding assets

APK/launcher icons and product imagery for the native Android build, applied by
the branding patch (`../../patches/tronbrowser-android/0001-branding-strings.patch`).

Source of truth for the logo/emblem is the repo root (`logo.svg`, `favicon.svg`,
`hero.svg`) and `apps/web/public/icons/`. Android needs density-bucketed PNGs
(`mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi`) and adaptive-icon foreground/background —
generate these here rather than committing large binaries prematurely.

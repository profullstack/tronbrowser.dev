# ADR 0002: Android engine source strategy

- Status: Proposed
- Date: 2026-08-10
- Milestone: Android engine Week 2

## Context

TronBrowser wants a native Android Chromium build with its own branding,
privacy changes, possible desktop-style extension support, and optional Tor
routing. The current `apps/android-engine` directory is a scaffold: it pins an
old desktop Ungoogled Chromium release and lists eight Android patches, but the
patch bodies, Android assets, and Tor binaries do not exist.

The source options were checked against their live upstream projects on
2026-08-10:

1. Apply the matching
   [Ungoogled Chromium](https://github.com/ungoogled-software/ungoogled-chromium)
   common patches to Chromium, then own a TronBrowser Android overlay.
2. Revive
   [ungoogled-chromium-android](https://github.com/ungoogled-software/ungoogled-chromium-android).
3. Track an Android downstream such as
   [Cromite](https://github.com/uazo/cromite),
   [Kiwi](https://github.com/kiwibrowser/src.next), or
   [Vanadium](https://github.com/GrapheneOS/Vanadium).

The first-party Android Ungoogled repository stopped near Chromium 99. Kiwi's
engine work is discontinued. Vanadium is current but tightly coupled to
GrapheneOS. Cromite is the most relevant maintained Android downstream. It now
includes an
[experimental Android extension patch](https://github.com/uazo/cromite/blob/master/build/patches/Experimental-support-for-extensions-on-Android.patch),
but the feature is disabled by default and needs product-specific validation.
Cromite is also GPL-3.0, so its update cadence, security response, and
distribution obligations need explicit review. None of these projects supplies
TronBrowser's proposed Tor integration.

The release snapshot matters for maintenance planning: on 2026-08-10,
Cromite's latest published build was
[Chromium 148 from 2026-05-21](https://github.com/uazo/cromite/releases/tag/v148.0.7778.168-cb3baf14f52eb4365d017f640f85310735c19b79),
while Chrome for Android had already entered
[Chromium 151 stable](https://chromereleases.googleblog.com/2026/07/chrome-for-android-update_02121837194.html).
Chromium documentation also describes a
[two-week milestone schedule from M153](https://chromiumdash.appspot.com/schedule).
That snapshot does not disqualify Cromite, but it makes an explicit maximum-lag
and emergency-security-update policy a prerequisite for adopting it.

Upstream Chromium disables the normal extension build on Android. Its
experimental desktop-Android path is not the `chrome_public_apk` target used by
this scaffold. Cromite demonstrates a possible downstream implementation, but
extension support remains a high-risk product requirement rather than an
inherited Chromium capability.

## Recommendation

Do **not** treat the current raw Chromium + Ungoogled + custom overlay as a
production-ready source strategy. Maintaining it across Chromium's release
cadence is only realistic with a dedicated owner, repeatable large Linux build
infrastructure, patch-rebase tests, and an explicit security-update SLA.

The primary existing-downstream candidate is **Cromite**, provided the project
accepts GPL distribution obligations, its release-lag policy, and the limits of
its experimental extension implementation. Choose the production base after
resolving one product and licensing question:

- If desktop-style Android extensions are required, first test Cromite's
  experimental implementation against TronBrowser's required extensions. Track
  Cromite if it passes and GPL is acceptable; otherwise a dedicated overlay
  still needs its own funded proof of concept and long-term owner.
- If extensions are not required, Cromite remains the lower-maintenance
  candidate, subject to the same GPL and security-update decisions.

Until that decision is made, the existing direct-Chromium path is a controlled
build experiment only. Cromite and Vanadium remain references, not code
sources, and GPL downstream code must not be copied into this ISC repository
without a separate licensing decision.

## Recorded adoption gate (Week 3)

The candidate decision is now represented by the machine-readable
[`cromite-candidate.json`](../../apps/android-engine/chromium/config/cromite-candidate.json)
record. The 2026-08-17 snapshot pins Cromite's Chromium 148 release tag and
independently records the tag's resolved Git commit. Cromite's 40-character tag
suffix is a build identifier, not the Git commit. The snapshot records Chrome
for Android 151 as the comparison point and pins the experimental extension
patch by path and Git blob SHA.

The initial policy permits at most one Chromium major of lag, a 35-day-old
candidate release, and a 30-day-old evidence snapshot. `record` mode validates
that evidence and reports blockers without breaking CI. `adopt` mode fails
closed. The current snapshot is intentionally blocked: GPL obligations and the
extension requirement are undecided, the candidate is three majors behind the
recorded stable major and its release is 88 UTC calendar days old, and no
emergency security-update SLA has been accepted.

This audit is offline by default; its upstream facts are attestations, not build
verification. An opt-in `--live` mode performs read-only GitHub API verification
of the recorded release tag, commit, LICENSE blob, and extension patch blob.
Records must still be refreshed from primary sources before adoption.
No Cromite or other GPL source is copied into this repository by this milestone.

## Build-readiness requirements

- Linux x86-64 build host.
- At least 100 GiB free on the build filesystem; more than 16 GiB RAM is
  recommended. See Chromium's
  [Android build instructions](https://chromium.googlesource.com/chromium/src/+/main/docs/android_build_instructions.md).
- A current, reviewed Chromium security pin with a matching Ungoogled tag.
- Per-version patch application, APK build, and device or emulator smoke tests.
- Pinned and checksummed Tor artifacts for every supported CPU.
- Real Android branding assets and a verified application ID.
- An explicit answer on extension support before estimating the production
  fork's ongoing maintenance cost.

## Consequences

- The Week 2 change can validate the scaffold and prevent expensive false
  starts, but it cannot honestly claim to produce a release APK.
- Source checkout remains available for patch development while the historical
  Chromium 131 pin is unapproved.
- A release build is blocked until that pin is approved and patches, branding,
  and Tor integration are real and verifiable.
- The first full Chromium compile remains a separate infrastructure milestone.

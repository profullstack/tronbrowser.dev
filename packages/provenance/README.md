# @tronbrowser/provenance

Reads what a media file declares about how it was made, and badges it on the page.

## What it does

Reads three things out of the bytes of an image or video:

- **C2PA manifests** — JPEG APP11/JUMBF, PNG `caBX`, WebP `C2PA`, ISO-BMFF
- **IPTC `DigitalSourceType`** — the standard vocabulary (`trainedAlgorithmicMedia`, `digitalCapture`, …)
- **Generator names** left in XMP by Midjourney, DALL·E, Firefly, Imagen, Veo and others

## Local by default

The only network traffic a scan causes is a re-request for an image the page **already loaded**, to the origin that **already served it**, normally answered from cache. No third party learns anything.

That is not incidental — it is why this is a browser feature rather than a call to somebody's API. Badging every image on every page by asking a remote service would be telemetry on the user's entire browsing session.

Asking a third party is available, but it is a separate function, off by default, and it throws rather than silently proceeding if the user has not opted in:

```ts
import { lookupRemote, RemoteLookupDisabledError } from '@tronbrowser/provenance';

// Throws RemoteLookupDisabledError — there is no config that makes this silently on
await lookupRemote(url, { enabled: false, apiKey: '' });
```

## What it will not claim

There is deliberately **no "authentic" or "verified real" badge.** Nothing here can establish that. The strongest positive statement available is *"the file says it was captured by a camera"*, and that is exactly what the badge says.

Three rules the tests enforce:

1. **Absence proves nothing.** Most sites strip metadata on upload, so a bare file is equally common for real photographs and AI output. "No provenance" is never rendered as "probably real".
2. **Self-declaration is not proof.** Only C2PA is signed, and even then this reports its *presence* — validating the certificate chain needs a trust list and is a separate job. `signatureVerified` is typed as the literal `false` so it cannot drift.
3. **A generator name is a hint, not a verdict.** Image editors write their own name into the same fields, so "opened in Firefly" and "made by Firefly" are indistinguishable there. It never triggers an AI badge, and never shows unprompted.

**SynthID is never checked**, and every report says so rather than staying quiet about it — Google's watermarks are verified by its own service, not from a file's bytes.

## Usage

```ts
import { scanMedia } from '@tronbrowser/provenance';

const result = await scanMedia();
// { examined: 12, badged: 2, skipped: 1 }
```

Only findings that actually say something are drawn unprompted. Most images on most pages have no provenance at all, and badging all of them is noise people learn to ignore — which is worse than no badge. Pass `showAll: true` for the on-demand view.

Scans are bounded (`maxElements`, default 40) and skip anything under `minSize` (default 96px), so a gallery of thumbnails does not turn into hundreds of range requests.

## Reading one file directly

```ts
import { readProvenance, toBadge } from '@tronbrowser/provenance';

const report = readProvenance(bytes);
const badge = toBadge(report);
```

`readProvenance` is pure and has no DOM or Node dependencies — it runs in a content script, a worker, or a test.

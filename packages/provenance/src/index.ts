/**
 * `@tronbrowser/provenance` — what a file declares about how it was made.
 *
 * Local by default: everything the badge shows is read from bytes the browser
 * already has. Asking a third party is a separate, opt-in feature.
 */

export {
  readProvenance,
  detectC2pa,
  detectContainer,
  extractXmp,
  readDigitalSourceType,
  readGenerators,
  indexOfAscii,
  DIGITAL_SOURCE_TYPES,
  SCAN_BYTES,
  type C2paFinding,
  type MediaContainer,
  type ProvenanceReport,
  type ProvenanceSignal,
  type ProvenanceStrength,
} from './read.js';

export { toBadge, shouldDisplay, type Badge, type BadgeKind } from './badge.js';

export {
  scanMedia,
  inspect,
  fetchHead,
  mediaUrl,
  attachBadge,
  SCANNED_ATTRIBUTE,
  type ScanOptions,
  type ScanResult,
} from './scan.js';

export {
  lookupRemote,
  RemoteLookupDisabledError,
  REMOTE_LOOKUP_DISCLOSURE,
  type RemoteLookupConfig,
  type RemoteVerdict,
} from './remote.js';

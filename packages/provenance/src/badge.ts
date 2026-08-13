/**
 * Turning a provenance report into what the user actually sees.
 *
 * Pure: report in, presentation out. Kept separate from the DOM work so the
 * wording — the part that can mislead someone — is testable on its own.
 *
 * The hard rule is that the badge never asserts more than the file does. There
 * is deliberately no "authentic" or "real photo" state, because nothing here
 * can establish that. The strongest positive claim available is "the file says
 * it was captured by a camera", and the badge says exactly that.
 */

import type { ProvenanceReport } from './read.js';

/**
 * What the badge is telling the user.
 *
 * `ai` — the file declares generative origin.
 * `camera` — the file declares camera capture.
 * `signed` — a manifest is present but says neither.
 * `hint` — a generator name, too weak to call.
 * `unknown` — nothing found. Shown only on request, never volunteered.
 */
export type BadgeKind = 'ai' | 'camera' | 'signed' | 'hint' | 'unknown';

export interface Badge {
  readonly kind: BadgeKind;
  /** Short text on the badge itself. */
  readonly label: string;
  /** The longer explanation, shown on hover or focus. */
  readonly detail: string;
  /** True when the badge should appear without the user asking. */
  readonly prominent: boolean;
}

/** Wording for each state, in one place so it can be reviewed as a set. */
const LABELS: Readonly<Record<BadgeKind, string>> = {
  ai: 'AI-generated',
  camera: 'Camera capture',
  signed: 'Signed provenance',
  hint: 'Possible AI tool',
  unknown: 'No provenance',
};

/**
 * Maps a report onto a badge.
 *
 * @param report - What the file declared
 * @returns The badge to show
 */
export function toBadge(report: ProvenanceReport): Badge {
  if (report.declaredAiGenerated === true) {
    return {
      kind: 'ai',
      label: LABELS.ai,
      detail: qualify(report, report.digitalSourceTypeLabel ?? 'The file declares generative origin.'),
      prominent: true,
    };
  }

  if (report.declaredAiGenerated === false) {
    return {
      kind: 'camera',
      label: LABELS.camera,
      detail: qualify(report, report.digitalSourceTypeLabel ?? 'The file declares camera capture.'),
      // A capture claim is worth showing when signed, and not worth
      // interrupting the page for when it is a bare editable field.
      prominent: report.strength === 'signed',
    };
  }

  if (report.c2pa.present) {
    return {
      kind: 'signed',
      label: LABELS.signed,
      detail: qualify(
        report,
        'This file carries a C2PA manifest but does not declare how it was made.',
      ),
      prominent: true,
    };
  }

  if (report.generators.length > 0) {
    return {
      kind: 'hint',
      label: LABELS.hint,
      detail: qualify(report, `Metadata mentions ${report.generators.join(', ')}.`),
      // A tool name is not a finding. Surfacing it unprompted would train
      // people to read "opened in Firefly" as "fake".
      prominent: false,
    };
  }

  return {
    kind: 'unknown',
    label: LABELS.unknown,
    detail: qualify(report, 'This file carries no provenance metadata.'),
    prominent: false,
  };
}

/**
 * Appends the report's own caveats to a summary.
 *
 * The caveat is not optional garnish — it is the part that stops a badge from
 * overclaiming — so it is attached here rather than left to each caller.
 *
 * @param report - The report the badge came from
 * @param summary - The one-line summary
 * @returns Summary plus caveats
 */
function qualify(report: ProvenanceReport, summary: string): string {
  return [summary, ...report.notes].join(' ');
}

/**
 * Whether a badge should be drawn on the page without being asked for.
 *
 * Most images on most pages have no provenance at all. Badging every one of
 * them would be noise that people learn to ignore, which is worse than no
 * badge — so only findings that say something get drawn, and the rest are
 * available on demand.
 *
 * @param badge - The badge in question
 * @returns True when it should be shown unprompted
 */
export function shouldDisplay(badge: Badge): boolean {
  return badge.prominent;
}

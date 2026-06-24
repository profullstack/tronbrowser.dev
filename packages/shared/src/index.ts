/**
 * @tronbrowser/shared
 * Shared types, utilities, and constants used across TronBrowser packages.
 */

export const PACKAGE_NAME = '@tronbrowser/shared' as const;

/** Privacy principles enforced across the product (PRD §Principles). */
export const PRIVACY_PRINCIPLES = [
  'no-telemetry-by-default',
  'no-ads',
  'no-sponsored-tabs',
  'no-affiliate-injection',
  'user-owned-data',
  'chrome-compatibility',
  'self-hostable',
] as const;
export type PrivacyPrinciple = (typeof PRIVACY_PRINCIPLES)[number];

/** Branded id helper so ids of different objects don't get mixed up. */
export type Id<TBrand extends string> = string & { readonly __brand: TBrand };

/** A discriminated result type, used in lieu of throwing across boundaries. */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** ISO-8601 timestamp string. */
export type Timestamp = string;

/** Common metadata carried by persisted, syncable objects. */
export interface BaseEntity {
  id: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Returns true only when telemetry is explicitly opted into. Defaults to false. */
export function telemetryEnabled(optIn: boolean | undefined): boolean {
  return optIn === true;
}

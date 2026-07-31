import { describe, expect, it } from 'vitest';
import { boundedInteger, buildExtensionUpdate } from './db.js';

describe('buildExtensionUpdate', () => {
  it('returns null when there is nothing to write', () => {
    expect(buildExtensionUpdate({})).toBeNull();
  });

  it('touches only the fields provided', () => {
    const update = buildExtensionUpdate({ summary: 'Now with bulk payouts.' })!;
    expect(update.set).toBe("summary = ?, updated_at = datetime('now')");
    expect(update.args).toEqual(['Now with bulk payouts.']);
  });

  it('maps camelCase fields to their columns', () => {
    const update = buildExtensionUpdate({ homepageUrl: 'https://example.com', iconUrl: 'data:image/png;base64,AA' })!;
    expect(update.set).toBe("homepage_url = ?, icon_url = ?, updated_at = datetime('now')");
    expect(update.args).toEqual(['https://example.com', 'data:image/png;base64,AA']);
  });

  it('distinguishes clearing a field from leaving it alone', () => {
    const cleared = buildExtensionUpdate({ summary: null })!;
    expect(cleared.args).toEqual([null]);
    // `description` absent entirely — must not appear in the SET clause.
    expect(cleared.set).not.toContain('description');
  });

  it('always stamps updated_at so a copy edit is visible on the listing', () => {
    const update = buildExtensionUpdate({ description: 'x' })!;
    expect(update.set.endsWith("updated_at = datetime('now')")).toBe(true);
    // updated_at is inlined SQL, not a bound arg.
    expect(update.args).toHaveLength(1);
  });

  it('orders columns predictably regardless of key order', () => {
    const a = buildExtensionUpdate({ description: 'd', name: 'n' })!;
    const b = buildExtensionUpdate({ name: 'n', description: 'd' })!;
    expect(a.set).toBe(b.set);
    expect(a.args).toEqual(b.args);
  });
});

describe('boundedInteger', () => {
  it('falls back for non-finite pagination values', () => {
    expect(boundedInteger(Number.NaN, 50, 1, 100)).toBe(50);
    expect(boundedInteger(Number.POSITIVE_INFINITY, 50, 1, 100)).toBe(50);
    expect(boundedInteger(Number.NEGATIVE_INFINITY, 0, 0)).toBe(0);
  });

  it('clamps and truncates finite pagination values', () => {
    expect(boundedInteger(-1, 50, 1, 100)).toBe(1);
    expect(boundedInteger(200, 50, 1, 100)).toBe(100);
    expect(boundedInteger(12.9, 50, 1, 100)).toBe(12);
    expect(boundedInteger(2.7, 0, 0)).toBe(2);
  });
});

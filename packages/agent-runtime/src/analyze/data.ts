/**
 * User data handling for analyze (PRD §11.4). Flattens the `--data` JSON to
 * dot-paths so fields can reference `lead.email` instead of echoing values —
 * keeping sensitive values out of plans, logs, and traces.
 */

export type DataLeaf = { path: string; value: string };

/** Flatten an object to `{ "a.b.c": "value" }` for primitive leaves. */
export function flattenData(data: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (data === null || data === undefined) return out;
  if (typeof data !== 'object') {
    if (prefix) out[prefix] = String(data);
    return out;
  }
  if (Array.isArray(data)) {
    data.forEach((v, i) => Object.assign(out, flattenData(v, prefix ? `${prefix}.${i}` : String(i))));
    return out;
  }
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    Object.assign(out, flattenData(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

/** Resolve a dot-path against the data object (used at execute time). */
export function getByPath(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, data);
}

/** The list of leaves as {path, value}. */
export function dataLeaves(data: unknown): DataLeaf[] {
  return Object.entries(flattenData(data)).map(([path, value]) => ({ path, value }));
}

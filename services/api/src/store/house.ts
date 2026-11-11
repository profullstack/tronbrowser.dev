// House publishers: accounts whose listings go live without the $1 fee.
//
// The fee exists to make spam cost something. Our own extensions are published
// by CI (scripts/store-sync.mjs) from the house registry, and a listing that
// stops at "draft" until someone pays ourselves a dollar through a hosted
// checkout is a listing that never goes live: nothing in CI can complete one.
//
// STORE_HOUSE_PUBLISHERS is a comma/space separated list of user ids. Empty
// (the default) exempts nobody, so a misconfigured box charges everyone.
export function housePublishers(raw: string | undefined = process.env.STORE_HOUSE_PUBLISHERS): Set<string> {
  return new Set(
    String(raw || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isHousePublisher(userId: string | null | undefined, raw?: string): boolean {
  if (!userId) return false;
  return housePublishers(raw ?? process.env.STORE_HOUSE_PUBLISHERS).has(userId);
}

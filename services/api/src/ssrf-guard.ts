/**
 * SSRF guard for caller-supplied outbound base URLs (e.g. the BYO-key
 * `baseUrl` in /api/swarm). Returns true when a hostname or IP literal points
 * at a loopback / private / link-local / cloud-metadata target that a signed-in
 * caller must not be able to make the server reach.
 *
 * `isBlockedHost` is intentionally pure and synchronous so it can be unit
 * tested and also applied to DNS-resolved addresses (defense against a public
 * hostname that resolves to a private IP).
 */

function ipv4Blocked(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // private 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local / cloud metadata 169.254.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

export function isBlockedHost(host: string | undefined | null): boolean {
  if (!host) return true;
  // normalize: lowercase, trim, strip IPv6 brackets and any zone id
  let h = host.toLowerCase().trim().replace(/^\[/, '').replace(/\]$/, '');
  h = h.replace(/%.*$/, '');

  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }

  if (h.includes(':')) {
    // IPv6
    if (h === '::' || h === '::1') return true; // unspecified / loopback
    if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
    if (/^f[cd]/.test(h)) return true; // fc00::/7 unique-local
    const mapped = h.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/); // ::ffff:1.2.3.4
    if (mapped) return ipv4Blocked(mapped[1]);
    return false;
  }

  return ipv4Blocked(h);
}

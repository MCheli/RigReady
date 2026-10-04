import type { UpdateChannel } from '../../../core/ports';

/** A semantic version, as far as update decisions need it. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers: "2.1.0-beta.3" has ['beta', 3]. Empty for a release. */
  pre: (string | number)[];
}

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses "2.1.0", "v2.1.0-beta.3", "2.1.0+build". Anything else is undefined. */
export function parseVersion(text: string): Version | undefined {
  const match = PATTERN.exec(text.trim());
  if (!match) return undefined;
  const pre = match[4]
    ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : [];
  if (pre.some((part) => part === '')) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre };
}

/** Semver precedence: negative when a is older than b, positive when newer, 0 when equal. */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  // A release is newer than any pre-release of the same version.
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    // Numbers sort before words; numbers by value, words by character.
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export type OfferVerdict =
  { take: true } | { take: false; why: 'unreadable' | 'notNewer' | 'prerelease' };

/**
 * Whether a version the feed offers is one this install should take on this channel.
 * Never a downgrade, never the same version; the stable channel takes releases only,
 * the beta channel also takes x.y.z-beta.n (and nothing else that is pre-release:
 * "-dev", "-alpha" and "-rc" builds are never offered to users).
 */
export function judgeOffer(current: string, offered: string, channel: UpdateChannel): OfferVerdict {
  const now = parseVersion(current);
  const next = parseVersion(offered);
  if (!now || !next) return { take: false, why: 'unreadable' };
  if (compareVersions(next, now) <= 0) return { take: false, why: 'notNewer' };
  if (next.pre.length > 0 && !(channel === 'beta' && next.pre[0] === 'beta')) {
    return { take: false, why: 'prerelease' };
  }
  return { take: true };
}

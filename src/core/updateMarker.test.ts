import { describe, expect, it } from 'vitest';
import { isSecurityRelease, SECURITY_MARKER } from './updateMarker';

describe('the security marker of a release', () => {
  it('is [security] in the title, whatever the capitals', () => {
    expect(SECURITY_MARKER).toBe('[security]');
    expect(isSecurityRelease('v2.0.1 [security]', undefined)).toBe(true);
    expect(isSecurityRelease('[SECURITY] RigReady 2.0.1', null)).toBe(true);
    expect(isSecurityRelease('v2.0.1', undefined)).toBe(false);
    expect(isSecurityRelease('v2.0.1 security fixes', 'Fixes a security problem.')).toBe(false);
  });

  it('or at the start of the notes: the first line, or the first 300 characters of one long line', () => {
    expect(isSecurityRelease(undefined, '[security] Fixes how imported files are checked.')).toBe(
      true
    );
    expect(isSecurityRelease(null, '\n  [Security] first line\nmore')).toBe(true);
    // Deeper down the notes is not the start: an ordinary release may mention the word.
    expect(isSecurityRelease(undefined, 'Faster checks.\n[security] in a later line')).toBe(false);
    expect(isSecurityRelease(undefined, `${'x'.repeat(300)} [security]`)).toBe(false);
    expect(isSecurityRelease(undefined, `${'x'.repeat(280)} [security]`)).toBe(true);
    expect(isSecurityRelease(undefined, '')).toBe(false);
    expect(isSecurityRelease(undefined, undefined)).toBe(false);
  });
});

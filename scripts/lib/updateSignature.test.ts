import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySigning, type BuildConfig } from './signing';
import { checkUpdateSignature } from './updateSignature';

/**
 * The check runs electron-updater's own verifier, which runs Get-AuthenticodeSignature: on
 * Windows only, against a real signed program. Node itself is one (signed by its publisher
 * with an embedded signature, as RigReady's installer is); where this Node is not signed,
 * PowerShell is (by Windows' catalog). Its subject is read here first, to make the names a
 * build would put into the feed file for that certificate.
 */
const windows = process.platform === 'win32';

/** The signer's subject of `file` when its signature is valid, else undefined. */
function validSubject(file: string): string | undefined {
  const quoted = file.replace(/'/g, "''");
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$s = Get-AuthenticodeSignature -LiteralPath '${quoted}'; if ($s.Status -eq 'Valid') { $s.SignerCertificate.Subject }`,
    ],
    { encoding: 'utf8' }
  ).trim();
  return out || undefined;
}

/** The CN of a subject as Windows writes it ("CN=Name, O=..."). */
const cnOf = (subject: string): string => /^CN=([^,]+)/.exec(subject)![1]!;

const build: BuildConfig = {
  publish: [{ provider: 'github', owner: 'example', repo: 'rigready' }],
};

describe.runIf(windows)('checkUpdateSignature: electron-updater checks a signed file', () => {
  let dir = '';
  let signed = '';
  let subject = '';
  let cn = '';

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rigready-test-'));
    const powershell = path.join(
      process.env['SystemRoot'] ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    for (const file of [process.execPath, powershell]) {
      const found = validSubject(file);
      if (found) {
        signed = file;
        subject = found;
        break;
      }
    }
    expect(subject, 'a signed program to check').toMatch(/^CN=[^,]+, /);
    cn = cnOf(subject);
  });

  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  /** A feed file as electron-builder writes it into the package, with these names. */
  async function feedWith(name: string, publisherName?: unknown): Promise<string> {
    const file = path.join(dir, `${name}.yml`);
    const feed: Record<string, unknown> = {
      ...build.publish![0],
      updaterCacheDirName: 'rigready-updater',
    };
    if (publisherName !== undefined) feed['publisherName'] = publisherName;
    await fs.writeFile(file, yaml.dump(feed));
    return file;
  }

  it('the names a signed build writes, the DN and then the CN, pass by the full DN without a warning', async () => {
    const composed = applySigning(build, {
      mode: 'signed',
      endpoint: 'https://eus.codesigning.azure.net',
      account: 'a',
      profile: 'p',
      publisher: cn,
      publisherDn: subject,
    });
    const names = composed.publish![0]!['publisherName'];
    expect(names).toEqual([subject, cn]);
    const result = await checkUpdateSignature(signed, await feedWith('built', names));
    expect(result).toEqual({ names: [subject, cn], warnings: [] });
  });

  it('the CN alone, as the signed betas had it: electron-updater accepts with its warning, and the check fails', async () => {
    const result = await checkUpdateSignature(signed, await feedWith('cn-only', [cn]));
    expect(result.warnings.join(' ')).toContain(`Signature validated using only CN ${cn}`);
    expect(result.problem).toMatch(
      /^electron-updater does not accept the installer by its full DN/
    );
    expect(result.problem).toContain(`the feed file names no full DN (${cn})`);
    // One name on its own, not as a list, is read the same way.
    const single = await checkUpdateSignature(signed, await feedWith('cn-single', cn));
    expect(single.names).toEqual([cn]);
    expect(single.problem).toContain('names no full DN');
  });

  it("a DN that is no longer the certificate's subject, with the CN after it: installed copies still take it, but the check fails and shows the subject", async () => {
    const moved = subject.replace(/, C=([^,]+)$/, ', C=ZZ');
    expect(moved).not.toBe(subject);
    const result = await checkUpdateSignature(signed, await feedWith('moved', [moved, cn]));
    expect(result.warnings.join(' ')).toContain('Signature validated using only CN');
    expect(result.problem).toContain(`the full DN ${moved} is not the certificate's subject`);
    // electron-updater's own answer names the subject the certificate has.
    expect(result.problem).toContain(`"Subject": "${subject}"`);
  });

  it('a file signed by someone else, or not signed, is refused', async () => {
    const other = await checkUpdateSignature(
      signed,
      await feedWith('other', ['CN=Someone Else, O=Someone Else, C=US', 'Someone Else'])
    );
    expect(other.problem).toMatch(/^electron-updater refuses the installer\. publisherNames: /);
    const unsigned = path.join(dir, 'unsigned.exe');
    await fs.writeFile(unsigned, 'not a program');
    const refused = await checkUpdateSignature(unsigned, await feedWith('unsigned', [subject, cn]));
    expect(refused.problem).toMatch(/^electron-updater refuses the installer\./);
  });

  it('a feed file without a publisher, or no feed file, fails before any signature is read', async () => {
    const none = await checkUpdateSignature(signed, await feedWith('none'));
    expect(none.problem).toMatch(/names no publisher: an installed copy would take any update/);
    const missing = await checkUpdateSignature(signed, path.join(dir, 'missing.yml'));
    expect(missing.problem).toMatch(/missing\.yml cannot be read/);
  });
});

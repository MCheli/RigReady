/**
 * The check an installed RigReady makes on every downloaded update, made on a newly built
 * installer before it is released (docs/RELEASING.md, "Code signing").
 *
 * Nothing here re-implements that check: it is electron-updater's own NsisUpdater, the class
 * the installed app updates with, reading the publisher names from a feed file
 * (resources/app-update.yml) with its own loader and verifying the installer with its own
 * verifier (windowsExecutableCodeSignatureVerifier.js: Get-AuthenticodeSignature, then the
 * names in order; a name with "=" is a DN and must equal the subject part by part, a plain
 * name must equal the subject's CN, and a match by the CN alone is logged as a warning).
 *
 * The installer passes only when electron-updater accepts it without a single warning, and
 * accepts it again from the DN names of the list alone. So a build whose certificate no
 * longer matches the DN fails here, at build time, although installed copies would still
 * take it by the CN that follows the DN: the DN is put right before such a release is made.
 */
import path from 'node:path';
import { parseDn } from 'builder-util-runtime';
import { NsisUpdater } from 'electron-updater';
import type { AppAdapter } from 'electron-updater/out/AppAdapter';

export interface UpdateSignatureCheck {
  /** The publisher names in the feed file, in its order. */
  names: string[];
  /** What electron-updater logged as a warning or an error while it checked. */
  warnings: string[];
  /** Why an installed copy would not accept the installer by its full DN; absent when it would. */
  problem?: string;
}

/**
 * The installed app as electron-updater sees it, with only what reading the feed file needs.
 * Nothing here is ever started, relaunched or quit.
 */
function appAt(feedFile: string): AppAdapter {
  return {
    version: '0.0.0',
    name: 'RigReady',
    isPackaged: true,
    appUpdateConfigPath: feedFile,
    userDataPath: path.dirname(feedFile),
    baseCachePath: path.dirname(feedFile),
    whenReady: () => Promise.resolve(),
    relaunch: () => undefined,
    quit: () => undefined,
    onQuit: () => undefined,
  };
}

/**
 * electron-updater's own members that the installed app runs and its type declarations keep
 * private: the feed file as loaded (AppUpdater.configOnDisk) and the check made on every
 * downloaded update (NsisUpdater.verifySignature).
 */
interface UpdaterInside {
  configOnDisk: { value: Promise<{ publisherName?: string | string[] | null } | null> };
  verifySignature(tempUpdateFile: string): Promise<string | null>;
}

/** Checks `installer` as an installed copy whose feed file is `feedFile` would check it. */
export async function checkUpdateSignature(
  installer: string,
  feedFile: string
): Promise<UpdateSignatureCheck> {
  const file = path.resolve(installer);
  const warnings: string[] = [];
  const updater = new NsisUpdater(undefined, appAt(path.resolve(feedFile)));
  updater.logger = {
    info: () => undefined,
    warn: (message: unknown) => warnings.push(String(message)),
    error: (message: unknown) => warnings.push(String(message)),
  };
  const inside = updater as unknown as UpdaterInside;

  let named: string | string[] | null | undefined;
  try {
    named = (await inside.configOnDisk.value)?.publisherName;
  } catch (e) {
    return {
      names: [],
      warnings,
      problem: `the feed file ${feedFile} cannot be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  // As NsisUpdater.verifySignature reads it: one name or a list.
  const names = named === null || named === undefined ? [] : Array.isArray(named) ? named : [named];
  if (names.length === 0) {
    return {
      names,
      warnings,
      problem: `the feed file ${feedFile} names no publisher: an installed copy would take any update without checking its signature`,
    };
  }

  const refused = await inside.verifySignature(file);
  if (refused !== null) {
    return { names, warnings, problem: `electron-updater refuses the installer. ${refused}` };
  }
  const byNames = [...warnings];
  // The same verifier, given only the DN names of the list: what the CN alone cannot pass.
  // When it refuses, what it answers holds the certificate's subject.
  const dns = names.filter((name) => parseDn(name).size > 0);
  const byDn = dns.length > 0 ? await updater.verifyUpdateCodeSignature(dns, file) : null;
  const wrong: string[] = [];
  if (dns.length === 0) wrong.push(`the feed file names no full DN (${names.join(' | ')})`);
  if (byNames.length > 0) {
    wrong.push(`electron-updater accepted the installer with a warning: ${byNames.join(' ')}`);
  }
  if (byDn !== null) {
    wrong.push(`the full DN ${dns.join(' | ')} is not the certificate's subject. ${byDn}`);
  }
  if (wrong.length === 0) return { names, warnings };
  return {
    names,
    warnings,
    problem:
      `electron-updater does not accept the installer by its full DN: ${wrong.join('; ')}. ` +
      "Set the DN to the certificate's subject before releasing (docs/RELEASING.md, " +
      '"Code signing"); installed copies still take updates by the CN that follows it.',
  };
}

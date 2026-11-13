/**
 * Code signing of the release build (docs/RELEASING.md, "Code signing").
 *
 * The decision is made from the environment alone, so the same `npm run dist` builds the
 * unsigned installer on a PC and a signed one in the Release workflow once the repository
 * holds the signing configuration. Five repository variables name the Azure Artifact
 * Signing endpoint, account and certificate profile, the publisher (the certificate's
 * subject CN) and the certificate's whole subject (its distinguished name, DN); three
 * secrets are the credentials the TrustedSigning PowerShell module reads (Azure.Identity's
 * EnvironmentCredential). Either all eight are set or none of them: anything in between
 * stops the build, so a release meant to be signed is never built unsigned by accident,
 * and a signing attempt never starts half configured.
 *
 * What electron-builder (app-builder-lib 26.18) does with the result:
 *   - `win.azureSignOptions` selects WindowsSignAzureManager, which installs the
 *     TrustedSigning module on the build machine and runs Invoke-TrustedSigning on every
 *     file it signs: the program, the uninstaller and the installer. An error rejects the
 *     build; `forceCodeSigning` makes a build that signed nothing an error too. Its
 *     `publisherName` is a single string in this version's schema and is not passed to
 *     the signing itself; it stays the CN.
 *   - PublishManager writes resources/app-update.yml into the NSIS build from
 *     `publish[0]` (plus updaterCacheDirName). It takes `publisherName` (a list) from there
 *     when the entry has one, else from azureSignOptions.publisherName. The list here is
 *     the DN first and the CN after it. electron-updater verifies each downloaded update
 *     against the list in order (NsisUpdater.verifySignature): the DN matches when every
 *     part of it equals the certificate's subject; the CN matches by the subject's CN
 *     alone, with the warning "Signature validated using only CN". So the DN is what an
 *     update is checked by, and the CN is the fallback that keeps installed copies
 *     updating if the certificate's other details (the town, say) ever change: an installed
 *     copy checks every later update against its own list. The Release workflow fails a
 *     build that passes only by the CN (scripts/lib/updateSignature.ts), so the DN is put
 *     right before such a release is made.
 */
import { parseDn } from 'builder-util-runtime';

export const SIGNING_VARIABLES = {
  endpoint: 'RIGREADY_SIGN_ENDPOINT',
  account: 'RIGREADY_SIGN_ACCOUNT',
  profile: 'RIGREADY_SIGN_PROFILE',
  publisher: 'RIGREADY_SIGN_PUBLISHER',
  publisherDn: 'RIGREADY_SIGN_PUBLISHER_DN',
} as const;

export const SIGNING_SECRETS = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
] as const;

/** Every name the build reads, in the order the documentation lists them. */
export const SIGNING_NAMES: readonly string[] = [
  ...Object.values(SIGNING_VARIABLES),
  ...SIGNING_SECRETS,
];

export type SigningDecision =
  | { mode: 'unsigned' }
  | {
      mode: 'signed';
      endpoint: string;
      account: string;
      profile: string;
      /** The certificate's subject CN. */
      publisher: string;
      /** The certificate's whole subject, as Windows shows it: "CN=..., O=..., C=...". */
      publisherDn: string;
    };

/** An Artifact Signing endpoint: https://<region>.codesigning.azure.net */
const ENDPOINT = /^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net\/?$/i;

/**
 * Unsigned when none of the eight names is set (empty and blank count as not set),
 * signed when all of them are, and an error naming the gap for anything in between.
 * The DN is read with electron-updater's own parser (builder-util-runtime's parseDn), so
 * it is accepted here exactly when the installed app will read it as a DN.
 */
export function signingFromEnv(env: Readonly<Record<string, string | undefined>>): SigningDecision {
  const value = (name: string): string => (env[name] ?? '').trim();
  const set = SIGNING_NAMES.filter((name) => value(name) !== '');
  if (set.length === 0) return { mode: 'unsigned' };
  if (set.length !== SIGNING_NAMES.length) {
    const missing = SIGNING_NAMES.filter((name) => value(name) === '');
    const are = (names: string[]): string => (names.length === 1 ? 'is' : 'are');
    throw new Error(
      `code signing is half configured: ${set.join(', ')} ${are(set)} set but ` +
        `${missing.join(', ')} ${are(missing)} not. Set all of ${SIGNING_NAMES.join(', ')} ` +
        'for a signed build, or none of them for an unsigned one (docs/RELEASING.md, "Code signing").'
    );
  }
  const endpoint = value(SIGNING_VARIABLES.endpoint).replace(/\/$/, '');
  if (!ENDPOINT.test(endpoint)) {
    throw new Error(
      `${SIGNING_VARIABLES.endpoint} must be the account's Artifact Signing endpoint, ` +
        `https://<region>.codesigning.azure.net (for example https://eus.codesigning.azure.net), not "${endpoint}"`
    );
  }
  const publisher = value(SIGNING_VARIABLES.publisher);
  const publisherDn = value(SIGNING_VARIABLES.publisherDn);
  const dn = parseDn(publisherDn);
  if (dn.get('CN') !== publisher || dn.size < 2) {
    throw new Error(
      `${SIGNING_VARIABLES.publisherDn} must be the certificate's whole subject as ` +
        'Get-AuthenticodeSignature shows it on a signed file, such as ' +
        `"CN=${publisher}, O=${publisher}, L=<town>, S=<state>, C=<country>", with ` +
        `${SIGNING_VARIABLES.publisher} as its CN; it is "${publisherDn}"`
    );
  }
  return {
    mode: 'signed',
    endpoint,
    account: value(SIGNING_VARIABLES.account),
    profile: value(SIGNING_VARIABLES.profile),
    publisher,
    publisherDn,
  };
}

/**
 * The publisher names an installed copy of a signed build checks every update against, in
 * the order electron-updater tries them: the certificate's whole subject (DN), then its CN.
 */
export function publisherNames(decision: Extract<SigningDecision, { mode: 'signed' }>): string[] {
  return [decision.publisherDn, decision.publisher];
}

/** The `build` object of package.json, as far as signing touches it. */
export interface BuildConfig {
  win?: Record<string, unknown>;
  publish?: Record<string, unknown>[];
  [key: string]: unknown;
}

/**
 * The electron-builder configuration for the decision: the build as it is when unsigned,
 * and when signed the same with Azure signing on, signing required, and the publisher
 * names (the DN, then the CN) in the feed file the installed app reads.
 */
export function applySigning<T extends BuildConfig>(build: T, decision: SigningDecision): T {
  if (decision.mode === 'unsigned') return build;
  const [feed, ...otherFeeds] = build.publish ?? [];
  if (!feed) {
    throw new Error('the build configuration has no publish entry to carry the publisher name');
  }
  return {
    ...build,
    forceCodeSigning: true,
    win: {
      ...build.win,
      azureSignOptions: {
        publisherName: decision.publisher,
        endpoint: decision.endpoint,
        codeSigningAccountName: decision.account,
        certificateProfileName: decision.profile,
      },
    },
    publish: [{ ...feed, publisherName: publisherNames(decision) }, ...otherFeeds],
  };
}

/** The one line the build prints about signing. */
export function describeSigning(decision: SigningDecision): string {
  return decision.mode === 'unsigned'
    ? 'code signing: off'
    : `code signing: on (${decision.publisher}, ${decision.account}/${decision.profile})`;
}

/**
 * Checks the feed file electron-builder put into the package (resources/app-update.yml,
 * parsed) against the decision: a signed build names the publisher (the DN, then the CN),
 * an unsigned build names none. Returns what is wrong, or undefined when the file is as
 * it should be.
 */
export function appUpdateProblem(feed: unknown, decision: SigningDecision): string | undefined {
  if (typeof feed !== 'object' || feed === null || Array.isArray(feed)) {
    return 'resources/app-update.yml is not a mapping';
  }
  const named = (feed as Record<string, unknown>)['publisherName'];
  if (decision.mode === 'unsigned') {
    return named === undefined
      ? undefined
      : `resources/app-update.yml names a publisher (${JSON.stringify(named)}) in an unsigned ` +
          'build: an installed copy would refuse every update';
  }
  const expected = publisherNames(decision);
  if (JSON.stringify(named) === JSON.stringify(expected)) return undefined;
  return (
    `resources/app-update.yml should name the publisher ${JSON.stringify(expected)} in a signed ` +
    `build, so the installed app verifies its updates; it has ${JSON.stringify(named)}`
  );
}

/**
 * Code signing of the release build (docs/RELEASING.md, "Code signing").
 *
 * The decision is made from the environment alone, so the same `npm run dist` builds the
 * unsigned installer on a PC and a signed one in the Release workflow once the repository
 * holds the signing configuration. Four repository variables name the Azure Artifact
 * Signing endpoint, account and certificate profile and the publisher (the certificate's
 * subject CN); three secrets are the credentials the TrustedSigning PowerShell module
 * reads (Azure.Identity's EnvironmentCredential). Either all seven are set or none of
 * them: anything in between stops the build, so a release meant to be signed is never
 * built unsigned by accident, and a signing attempt never starts half configured.
 *
 * What electron-builder (app-builder-lib 26.18) does with the result:
 *   - `win.azureSignOptions` selects WindowsSignAzureManager, which installs the
 *     TrustedSigning module on the build machine and runs Invoke-TrustedSigning on every
 *     file it signs: the program, the uninstaller and the installer. An error rejects the
 *     build; `forceCodeSigning` makes a build that signed nothing an error too.
 *   - PublishManager writes resources/app-update.yml into the NSIS build from
 *     `publish[0]` (plus updaterCacheDirName). It takes `publisherName` from there when
 *     the entry has one, else from azureSignOptions.publisherName; both are set here to
 *     the same name so the file states what the config states. electron-updater verifies
 *     each downloaded update against that name (NsisUpdater.verifySignature) and refuses
 *     an installer that is unsigned or signed under another name.
 */

export const SIGNING_VARIABLES = {
  endpoint: 'RIGREADY_SIGN_ENDPOINT',
  account: 'RIGREADY_SIGN_ACCOUNT',
  profile: 'RIGREADY_SIGN_PROFILE',
  publisher: 'RIGREADY_SIGN_PUBLISHER',
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
  | { mode: 'signed'; endpoint: string; account: string; profile: string; publisher: string };

/** An Artifact Signing endpoint: https://<region>.codesigning.azure.net */
const ENDPOINT = /^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net\/?$/i;

/**
 * Unsigned when none of the seven names is set (empty and blank count as not set),
 * signed when all of them are, and an error naming the gap for anything in between.
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
  return {
    mode: 'signed',
    endpoint,
    account: value(SIGNING_VARIABLES.account),
    profile: value(SIGNING_VARIABLES.profile),
    publisher: value(SIGNING_VARIABLES.publisher),
  };
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
 * in the feed file the installed app reads.
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
    publish: [{ ...feed, publisherName: [decision.publisher] }, ...otherFeeds],
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
 * parsed) against the decision: a signed build names the publisher, an unsigned build
 * names none. Returns what is wrong, or undefined when the file is as it should be.
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
  const expected = [decision.publisher];
  if (JSON.stringify(named) === JSON.stringify(expected)) return undefined;
  return (
    `resources/app-update.yml should name the publisher ${JSON.stringify(expected)} in a signed ` +
    `build, so the installed app verifies its updates; it has ${JSON.stringify(named)}`
  );
}

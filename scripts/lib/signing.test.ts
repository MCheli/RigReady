import { describe, expect, it } from 'vitest';
import {
  SIGNING_NAMES,
  SIGNING_SECRETS,
  SIGNING_VARIABLES,
  appUpdateProblem,
  applySigning,
  describeSigning,
  signingFromEnv,
  type BuildConfig,
  type SigningDecision,
} from './signing';

/** A complete signing configuration, as the Release workflow hands it to the build step. */
const complete: Record<string, string> = {
  RIGREADY_SIGN_ENDPOINT: 'https://eus.codesigning.azure.net',
  RIGREADY_SIGN_ACCOUNT: 'rigready-signing',
  RIGREADY_SIGN_PROFILE: 'rigready-public-trust',
  RIGREADY_SIGN_PUBLISHER: 'Example Person',
  AZURE_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  AZURE_CLIENT_ID: '00000000-0000-0000-0000-000000000002',
  AZURE_CLIENT_SECRET: 'not-a-real-secret',
};

const signed: SigningDecision = {
  mode: 'signed',
  endpoint: 'https://eus.codesigning.azure.net',
  account: 'rigready-signing',
  profile: 'rigready-public-trust',
  publisher: 'Example Person',
};

/** The shape of package.json's build, with only what signing touches. */
const build: BuildConfig = {
  appId: 'io.rigready.app',
  productName: 'RigReady',
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'assets/icon.ico' },
  nsis: { oneClick: false },
  publish: [{ provider: 'github', owner: 'example', repo: 'rigready' }],
};

describe('signingFromEnv', () => {
  it('the seven names are the four variables and the three secrets, in that order', () => {
    expect(SIGNING_NAMES).toEqual([
      'RIGREADY_SIGN_ENDPOINT',
      'RIGREADY_SIGN_ACCOUNT',
      'RIGREADY_SIGN_PROFILE',
      'RIGREADY_SIGN_PUBLISHER',
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
    ]);
    expect(Object.keys(complete)).toEqual([
      ...Object.values(SIGNING_VARIABLES),
      ...SIGNING_SECRETS,
    ]);
  });

  it('nothing set, or everything blank, is an unsigned build; other variables do not count', () => {
    expect(signingFromEnv({})).toEqual({ mode: 'unsigned' });
    expect(
      signingFromEnv({ RIGREADY_SIGN_PUBLISHER: '', AZURE_CLIENT_SECRET: '  ', PATH: 'C:\\x' })
    ).toEqual({ mode: 'unsigned' });
    // The workflow passes `${{ vars.X }}` of a variable that does not exist as an empty string.
    expect(signingFromEnv(Object.fromEntries(SIGNING_NAMES.map((n) => [n, ''])))).toEqual({
      mode: 'unsigned',
    });
  });

  it('all seven set is a signed build with the four values, trimmed', () => {
    expect(signingFromEnv(complete)).toEqual(signed);
    expect(
      signingFromEnv({
        ...complete,
        RIGREADY_SIGN_PUBLISHER: '  Example Person ',
        RIGREADY_SIGN_ENDPOINT: 'https://eus.codesigning.azure.net/',
      })
    ).toEqual(signed);
  });

  it.each(SIGNING_NAMES)('%s missing from the other six fails, naming it', (name) => {
    const env = { ...complete, [name]: '' };
    expect(() => signingFromEnv(env)).toThrow(/half configured/);
    expect(() => signingFromEnv(env)).toThrow(new RegExp(`but ${name} is not`));
    expect(() => signingFromEnv(env)).toThrow(/docs\/RELEASING\.md/);
  });

  it.each(SIGNING_NAMES)(
    '%s alone fails too: a build is signed with everything or nothing',
    (name) => {
      expect(() => signingFromEnv({ [name]: 'x' })).toThrow(
        new RegExp(`^code signing is half configured: ${name} is set but`)
      );
    }
  );

  it('the endpoint must be an Artifact Signing endpoint', () => {
    for (const endpoint of [
      'http://eus.codesigning.azure.net',
      'eus.codesigning.azure.net',
      'https://portal.azure.com/#view/something',
      'https://eus.codesigning.azure.net/path',
    ]) {
      expect(() => signingFromEnv({ ...complete, RIGREADY_SIGN_ENDPOINT: endpoint })).toThrow(
        /RIGREADY_SIGN_ENDPOINT must be the account's Artifact Signing endpoint/
      );
    }
    expect(
      signingFromEnv({ ...complete, RIGREADY_SIGN_ENDPOINT: 'https://wus2.codesigning.azure.net' })
    ).toMatchObject({ mode: 'signed', endpoint: 'https://wus2.codesigning.azure.net' });
  });
});

describe('applySigning', () => {
  it('leaves an unsigned build exactly as package.json has it: no Azure options, no publisher', () => {
    const result = applySigning(build, { mode: 'unsigned' });
    expect(result).toBe(build);
    expect(result.win).not.toHaveProperty('azureSignOptions');
    expect(result).not.toHaveProperty('forceCodeSigning');
    expect(result.publish![0]).not.toHaveProperty('publisherName');
  });

  it('a signed build selects Azure signing as app-builder-lib reads it, requires it, and names the publisher in the feed', () => {
    const before = JSON.stringify(build);
    const result = applySigning(build, signed);
    expect(result).toEqual({
      ...build,
      forceCodeSigning: true,
      win: {
        ...build.win,
        // WindowsSignAzureManager.signFile reads exactly these keys.
        azureSignOptions: {
          publisherName: 'Example Person',
          endpoint: 'https://eus.codesigning.azure.net',
          codeSigningAccountName: 'rigready-signing',
          certificateProfileName: 'rigready-public-trust',
        },
      },
      // PublishManager.getAppUpdatePublishConfiguration takes publish[0].publisherName (a list).
      publish: [
        {
          provider: 'github',
          owner: 'example',
          repo: 'rigready',
          publisherName: ['Example Person'],
        },
      ],
    });
    // The rest of the build is untouched, and the input is not changed.
    expect(result.nsis).toBe(build.nsis);
    expect(JSON.stringify(build)).toBe(before);
  });

  it('keeps any further publish entries and refuses a build without one', () => {
    const two = {
      ...build,
      publish: [...build.publish!, { provider: 'generic', url: 'https://x' }],
    };
    expect(applySigning(two, signed).publish).toEqual([
      { ...build.publish![0], publisherName: ['Example Person'] },
      { provider: 'generic', url: 'https://x' },
    ]);
    expect(() => applySigning({ ...build, publish: [] }, signed)).toThrow(/no publish entry/);
    expect(() => applySigning({ ...build, publish: undefined }, signed)).toThrow(
      /no publish entry/
    );
  });
});

describe('describeSigning', () => {
  it('is one line: off, or on with the publisher, the account and the profile', () => {
    expect(describeSigning({ mode: 'unsigned' })).toBe('code signing: off');
    expect(describeSigning(signed)).toBe(
      'code signing: on (Example Person, rigready-signing/rigready-public-trust)'
    );
  });
});

describe('appUpdateProblem: the feed file inside the package', () => {
  const feed = {
    provider: 'github',
    owner: 'example',
    repo: 'rigready',
    updaterCacheDirName: 'rigready-updater',
  };

  it('an unsigned build must not name a publisher: the installed app would refuse every update', () => {
    expect(appUpdateProblem(feed, { mode: 'unsigned' })).toBeUndefined();
    expect(
      appUpdateProblem({ ...feed, publisherName: ['Example Person'] }, { mode: 'unsigned' })
    ).toMatch(/names a publisher \(\["Example Person"\]\) in an unsigned build/);
  });

  it('a signed build must name exactly the publisher, as a list', () => {
    expect(
      appUpdateProblem({ ...feed, publisherName: ['Example Person'] }, signed)
    ).toBeUndefined();
    expect(appUpdateProblem(feed, signed)).toMatch(
      /should name the publisher \["Example Person"\]/
    );
    expect(appUpdateProblem({ ...feed, publisherName: ['Someone Else'] }, signed)).toMatch(
      /it has \["Someone Else"\]/
    );
    expect(appUpdateProblem({ ...feed, publisherName: 'Example Person' }, signed)).toMatch(
      /it has "Example Person"/
    );
  });

  it('a file that is not a mapping is a problem whatever the mode', () => {
    expect(appUpdateProblem(null, signed)).toMatch(/not a mapping/);
    expect(appUpdateProblem('text', { mode: 'unsigned' })).toMatch(/not a mapping/);
    expect(appUpdateProblem([], signed)).toMatch(/not a mapping/);
  });
});

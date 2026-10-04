// Builds the installer smoke test's variant of RigReady ("RigReady Test"), twice: the
// current version, and the next patch version to update to. It is the product's own
// installer configuration with another identity (app id, name, shortcut, data folder),
// so installing and removing it cannot touch a real RigReady on the same PC.
//
//   node scripts/build-test-installer.mjs      (part of npm run smoke:installer)
//
// Nothing is published: both builds run with --publish never, and the update feed
// written into the test variant points at a dead address on this PC.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { UUID } = require('builder-util-runtime');

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const outRoot = path.join(root, 'release', 'installer-test');

const TEST_APP_ID = 'io.rigready.app.test';
const TEST_PRODUCT_NAME = 'RigReady Test';
// The package name decides where the installer keeps its copy for later updates
// (the folder <name>-updater in %LOCALAPPDATA%): the test variant must not share the product's.
const TEST_PACKAGE_NAME = 'rigready-test';

/** The uninstall registry key electron-builder derives from an app id (NsisTarget). */
const guidFor = (appId) => UUID.v5(appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));

const release = /^(\d+)\.(\d+)\.(\d+)/.exec(pkg.version);
if (!release) throw new Error(`Cannot read the version ${pkg.version}`);
const current = pkg.version;
const next = `${release[1]}.${release[2]}.${Number(release[3]) + 1}`;

function build(version) {
  const outDir = path.join(outRoot, version);
  const installer = path.join(outDir, `RigReadyTest-Setup-${version}.exe`);
  if (process.env.RIGREADY_INSTALLER_REUSE === '1' && existsSync(installer)) {
    console.log(`test installer ${version}: reusing ${installer}`);
    return { version, installer, feedDir: outDir };
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const config = {
    ...pkg.build,
    appId: TEST_APP_ID,
    productName: TEST_PRODUCT_NAME,
    extraMetadata: { version, name: TEST_PACKAGE_NAME },
    // Speed, not size: this installer is never shipped.
    compression: 'store',
    directories: { ...pkg.build.directories, output: outDir },
    win: { ...pkg.build.win, artifactName: 'RigReadyTest-Setup-${version}.${ext}' },
    nsis: {
      ...pkg.build.nsis,
      shortcutName: TEST_PRODUCT_NAME,
      include: 'build/installer-test.nsh',
    },
    // A feed nobody listens on; the smoke test points the app at its own with RIGREADY_UPDATE_FEED.
    publish: [{ provider: 'generic', url: 'http://127.0.0.1:9/' }],
  };
  const configFile = path.join(outRoot, `builder-${version}.json`);
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
  const result = spawnSync(
    process.execPath,
    [cli, '--win', 'nsis', '--x64', '--publish', 'never', '--config', configFile],
    { cwd: root, stdio: 'inherit' }
  );
  if (result.status !== 0) throw new Error(`electron-builder failed for ${version}`);
  if (!existsSync(installer)) throw new Error(`${installer} was not produced`);
  return { version, installer, feedDir: outDir };
}

mkdirSync(outRoot, { recursive: true });
const manifest = {
  appId: TEST_APP_ID,
  productName: TEST_PRODUCT_NAME,
  guid: guidFor(TEST_APP_ID),
  productGuid: guidFor(pkg.build.appId),
  dataFolder: '.rigready-installer-test',
  cacheFolder: `${TEST_PACKAGE_NAME}-updater`,
  productCacheFolder: `${pkg.name}-updater`,
  current: build(current),
  next: build(next),
};
if (manifest.guid === manifest.productGuid) {
  throw new Error('The test variant must not share the product’s uninstall key.');
}
writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
  `test installers: ${manifest.current.version} and ${manifest.next.version}, uninstall key {${manifest.guid}}`
);

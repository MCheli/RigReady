import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  builtOn,
  describePick,
  ownerOf,
  pickScenarioFiles,
  readWorld,
  type World,
} from './scenarioPick';

const world: World = {
  features: ['fly', 'cheat-sheets', 'dcs-bindings', 'dcs-setup', 'devices'],
  specs: {
    'tests/e2e/cheat-sheets.e2e.ts': "rig.launch('sheets-hornet', 'cheat-sheets')",
    'tests/e2e/dcs-bindings.e2e.ts': 'rig.launch("bindings-hornet", "dcs-bindings")',
    'tests/e2e/dcs-setup.e2e.ts': "rig.launch('flying-all-good', 'dcs-setup')",
    'tests/e2e/devices.e2e.ts': "rig.launch('racing-fresh', 'devices')",
    'tests/e2e/fly.e2e.ts': "rig.launch('flying-all-good', 'fly')",
    'tests/e2e/fly-session.e2e.ts': "rig.launch('fly-two-setups', 'fly-session')",
    'tests/e2e/keyboard.e2e.ts': "rig.launch('flying-fresh', 'keyboard')",
    'tests/e2e/tray.e2e.ts': "rig.launch('fly-two-setups', 'tray')",
  },
  scenarios: {
    'flying-fresh': 'rig: mark-full\n',
    'flying-all-good': 'rig: mark-full\nextends: flying-fresh.yaml\n',
    'fly-two-setups':
      'rig: mark-full\nextends: flying-all-good.yaml\ndata:\n  state.json: data/fly/state-uh1h.json\n',
    'sheets-hornet': 'rig: mark-full\nextends: flying-all-good.yaml\n',
    'bindings-hornet': 'rig: generic\n',
    'racing-fresh': 'rig: mark-racing\n',
  },
};
const all = Object.keys(world.specs).sort();
const files = (changed: string[]): string[] =>
  pickScenarioFiles(changed, world).specs.map((spec) => spec.file);

describe('scenario files picked from what changed (npm run test:e2e:changed)', () => {
  it('a scenario test that changed runs, and one that was deleted does not', () => {
    const picked = pickScenarioFiles(['tests/e2e/tray.e2e.ts', 'tests/e2e/gone.e2e.ts'], world);
    expect(picked).toEqual({
      all: false,
      specs: [{ file: 'tests/e2e/tray.e2e.ts', why: ['it changed'] }],
      shared: [],
      unread: ['tests/e2e/gone.e2e.ts'],
    });
  });

  it.each([
    ['src/platform/fake/index.ts', 'the platform layer and its fakes'],
    ['src/platform/node/index.ts', 'the platform layer and its fakes'],
    ['src/core/files/fileStore.ts', 'code every feature shares'],
    ['src/shared/result.ts', 'code every feature shares'],
    ['src/renderer/App.vue', 'the app shell every scenario starts'],
    ['src/main/index.ts', 'the app shell every scenario starts'],
    ['src/preload/index.ts', 'the app shell every scenario starts'],
    ['src/legacy/old.ts', 'app code outside the feature folders'],
    ['src/features/gone/core/x.ts', 'app code outside the feature folders'],
    ['tests/e2e/harness.ts', 'a helper the scenario tests share'],
    ['tests/e2e/a11y.ts', 'a helper the scenario tests share'],
    ['tests/helpers.ts', 'a helper the tests share'],
    ['tests/fixtures/features/x.json', 'test data any scenario test may read'],
    ['playwright.config.ts', 'the settings every scenario test runs with'],
    ['package-lock.json', 'the build'],
    ['electron.vite.config.ts', 'the build'],
    ['fixtures/dcs-actions/F-16C_50.json', 'a fixture no scenario test names'],
    ['assets/icon.png', 'not a path this script knows'],
  ])('%s is read by every scenario, so all of them run', (file, why) => {
    const picked = pickScenarioFiles([file, 'docs/PRODUCT.md'], world);
    expect(picked.all).toBe(true);
    expect(picked.specs.map((spec) => spec.file)).toEqual(all);
    expect(picked.shared).toEqual([{ file, why: expect.stringContaining(why) }]);
    expect(picked.unread).toEqual(['docs/PRODUCT.md']);
  });

  it('a feature runs the files named after it and the ones named after no feature', () => {
    // The case of pull request 65: a change to the cheat sheets broke their own print test.
    expect(files(['src/features/cheat-sheets/core/service.ts'])).toEqual([
      'tests/e2e/cheat-sheets.e2e.ts',
      'tests/e2e/keyboard.e2e.ts',
      'tests/e2e/tray.e2e.ts',
    ]);
    expect(files(['src\\features\\fly\\renderer\\FlyPage.vue'])).toEqual([
      'tests/e2e/fly-session.e2e.ts',
      'tests/e2e/fly.e2e.ts',
      'tests/e2e/keyboard.e2e.ts',
      'tests/e2e/tray.e2e.ts',
    ]);
    const picked = pickScenarioFiles(
      ['src/features/fly/core/fly.ts', 'src/features/fly/core/sessions.ts'],
      world
    );
    expect(picked.specs.find((spec) => spec.file === 'tests/e2e/fly.e2e.ts')?.why).toEqual([
      'the fly feature changed (src/features/fly/core/fly.ts)',
      'the fly feature changed (src/features/fly/core/sessions.ts)',
    ]);
    expect(picked.specs.find((spec) => spec.file === 'tests/e2e/tray.e2e.ts')?.why).toEqual([
      'it crosses features, and fly changed',
    ]);
  });

  it('the longest feature name owns a file: dcs-setup is not a file of a feature "dcs"', () => {
    const features = ['dcs', 'dcs-setup', 'fly'];
    expect(ownerOf('tests/e2e/dcs-setup.e2e.ts', features)).toBe('dcs-setup');
    expect(ownerOf('tests/e2e/dcs-setup-screens.e2e.ts', features)).toBe('dcs-setup');
    expect(ownerOf('tests/e2e/dcs-other.e2e.ts', features)).toBe('dcs');
    expect(ownerOf('tests/e2e/flying.e2e.ts', features)).toBeUndefined();
    expect(ownerOf('tests/e2e/harness.ts', features)).toBeUndefined();
  });

  it('a scenario runs the files that name it or a scenario built on it', () => {
    expect(builtOn('flying-fresh', world.scenarios)).toEqual([
      'fly-two-setups',
      'flying-all-good',
      'flying-fresh',
      'sheets-hornet',
    ]);
    expect(files(['fixtures/scenarios/flying-all-good.yaml'])).toEqual([
      'tests/e2e/cheat-sheets.e2e.ts',
      'tests/e2e/dcs-setup.e2e.ts',
      'tests/e2e/fly-session.e2e.ts',
      'tests/e2e/fly.e2e.ts',
      'tests/e2e/tray.e2e.ts',
    ]);
    expect(pickScenarioFiles(['fixtures/scenarios/bindings-hornet.yaml'], world).specs).toEqual([
      {
        file: 'tests/e2e/dcs-bindings.e2e.ts',
        why: ['it uses bindings-hornet (fixtures/scenarios/bindings-hornet.yaml changed)'],
      },
    ]);
  });

  it('a recorded rig runs the files of every scenario on it, a data file those that name it', () => {
    expect(files(['fixtures/rigs/mark-racing/devices.json'])).toEqual(['tests/e2e/devices.e2e.ts']);
    expect(files(['fixtures/scenarios/data/fly/state-uh1h.json'])).toEqual([
      'tests/e2e/fly-session.e2e.ts',
      'tests/e2e/tray.e2e.ts',
    ]);
    // Nothing names it: any scenario may read it.
    expect(pickScenarioFiles(['fixtures/scenarios/data/fly/unnamed.json'], world).all).toBe(true);
    expect(pickScenarioFiles(['fixtures/rigs/unused/devices.json'], world).all).toBe(true);
  });

  it('nothing runs for what no scenario reads', () => {
    const unread = [
      '.github/workflows/ci.yml',
      'README.md',
      'artifacts/screens/tray/01-not-ready.png',
      'docs/requirements/ledger.yaml',
      'playwright.packaged.config.ts',
      'scripts/lib/scenarioPick.ts',
      'site/index.html',
      'src/features/fly/core/sessions.test.ts',
      'tests/e2e/ai-assist.live.ts',
      'tests/packaged/packaged.e2e.ts',
      'tests/unit/fileStore.test.ts',
      'vitest.config.ts',
    ];
    expect(pickScenarioFiles(unread, world)).toEqual({ all: false, specs: [], shared: [], unread });
  });

  it('says what runs and why', () => {
    expect(
      describePick(
        pickScenarioFiles(['src/core/jsonStore.ts', 'docs/PRODUCT.md'], world),
        8,
        'origin/main'
      )
    ).toEqual([
      'All 8 scenario test files run, because of what changed since origin/main that every scenario can read:',
      '  src/core/jsonStore.ts: code every feature shares',
      '1 changed file(s) are read by no scenario test.',
    ]);
    expect(
      describePick(
        pickScenarioFiles(
          ['src/features/devices/core/a.ts', 'src/features/devices/core/b.ts'],
          world
        ),
        8,
        'main'
      )
    ).toEqual([
      '3 of 8 scenario test files run for what changed since main:',
      '  tests/e2e/devices.e2e.ts: the devices feature changed (src/features/devices/core/a.ts) (and 1 more reasons)',
      '  tests/e2e/keyboard.e2e.ts: it crosses features, and devices changed',
      '  tests/e2e/tray.e2e.ts: it crosses features, and devices changed',
      'This is the first look, not the whole answer: the build server runs every scenario file.',
    ]);
    expect(describePick(pickScenarioFiles(['README.md'], world), 8, 'origin/main')).toEqual([
      'No scenario test reads what changed since origin/main. Nothing to run.',
      '1 changed file(s) are read by no scenario test.',
    ]);
  });

  it('reads this repository: every scenario test is found, and a feature owns its own', () => {
    const root = path.resolve(import.meta.dirname, '..', '..');
    const real = readWorld(root);
    expect(real.features).toContain('fly');
    expect(Object.keys(real.scenarios)).toContain('fly-two-setups');
    expect(Object.keys(real.specs)).toContain('tests/e2e/tray.e2e.ts');
    const picked = pickScenarioFiles(['src/features/cheat-sheets/core/service.ts'], real);
    const names = picked.specs.map((spec) => spec.file);
    expect(picked.all).toBe(false);
    expect(names).toContain('tests/e2e/cheat-sheets.e2e.ts');
    expect(names).toContain('tests/e2e/nfr.e2e.ts');
    expect(names).not.toContain('tests/e2e/racing.e2e.ts');
    // The tray test starts the scenario with two setups: a change to it reaches the test.
    expect(
      pickScenarioFiles(['fixtures/scenarios/fly-two-setups.yaml'], real).specs.map((s) => s.file)
    ).toContain('tests/e2e/tray.e2e.ts');
    expect(readWorld(path.join(root, 'no-such-folder'))).toEqual({
      specs: {},
      features: [],
      scenarios: {},
    });
  });
});

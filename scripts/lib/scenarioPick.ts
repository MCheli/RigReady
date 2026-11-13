/**
 * Which scenario test files a set of changed files can reach (`npm run test:e2e:changed`).
 *
 * `npm run check` runs no scenario test, so a change that breaks one is first seen on the
 * build server, a quarter of an hour later. This picks the scenario files worth running
 * before a push, from the paths that changed. The rules, in the order they are tried:
 *
 * 1. A scenario test file that changed runs.
 * 2. Nothing runs for what no scenario reads: unit tests, documents, the website, the
 *    workflows, the scripts, the screenshots, the packaged and installer tests.
 * 3. A feature folder changed (src/features/<id>): the scenario files named after that
 *    feature run (<id>.e2e.ts, <id>-*.e2e.ts), and so do the ones named after no feature,
 *    because those cross features: the walk over every page, the keyboard, the tray.
 * 4. A scenario (fixtures/scenarios/<name>.yaml) changed: the files that name it run, and
 *    the ones that name a scenario built on it (extends). A recorded rig
 *    (fixtures/rigs/<rig>) counts as every scenario on that rig, and a data file as the
 *    scenarios that name it. A fixture nothing names counts as read by all.
 * 5. Anything else is taken as read by every scenario, and all of them run. That is the
 *    code outside the feature folders (src/core, src/shared, src/renderer, src/main,
 *    src/preload, src/platform with its fakes), the helpers the scenario tests share
 *    (tests/e2e/*.ts that is not a test, tests/*.ts, tests/fixtures), the Playwright and
 *    build settings and the packages. It is also any path this file does not know: a guess
 *    that nothing reads it would be the expensive mistake.
 *
 * The pick is the first look, not the whole answer: a feature can still break a scenario
 * named after another feature, and the build server runs them all.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface World {
  /** Every scenario test file, by its path from the repository root, with its text. */
  specs: Record<string, string>;
  /** The ids of the feature folders (src/features/<id>). */
  features: readonly string[];
  /** Every scenario, by its name (the file name without .yaml), with its text. */
  scenarios: Record<string, string>;
}

export interface Picked {
  /** True when a file every scenario can read changed: `specs` is then all of them. */
  all: boolean;
  /** The scenario test files to run, in name order, each with why. */
  specs: { file: string; why: string[] }[];
  /** With `all`: the changed files that every scenario can read, each with why. */
  shared: { file: string; why: string }[];
  /** Changed files that no scenario reads. */
  unread: string[];
}

const SPEC = /^tests\/e2e\/([^/]+)\.e2e\.ts$/;

/** Paths no scenario test reads. What is neither here nor matched by a rule runs everything. */
const UNREAD: readonly RegExp[] = [
  /\.test\.ts$/,
  /\.md$/,
  /^(docs|site|artifacts|scripts|\.github|\.husky|\.claude|\.vscode)\//,
  /^tests\/(unit|packaged|installer|rig)\//,
  /^tests\/e2e\/[^/]+\.live\.ts$/,
  /^playwright\.(packaged|installer)\.config\.ts$/,
  /^vitest\.[^/]*config\.ts$/,
  /^eslint\.config\.mjs$/,
  /^(LICENSE|\.gitignore|\.gitattributes|\.prettierrc[^/]*|\.prettierignore|\.editorconfig)$/,
];

const SHARED: readonly [RegExp, string][] = [
  [/^src\/platform\//, 'the platform layer and its fakes, which every scenario runs on'],
  [/^src\/(core|shared)\//, 'code every feature shares'],
  [/^src\/(renderer|main|preload)\//, 'the app shell every scenario starts'],
  [/^src\//, 'app code outside the feature folders'],
  [/^tests\/e2e\//, 'a helper the scenario tests share'],
  [/^tests\/[^/]+\.ts$/, 'a helper the tests share'],
  [/^tests\/fixtures\//, 'test data any scenario test may read'],
  [/^playwright\.config\.ts$/, 'the settings every scenario test runs with'],
  [/^(package(-lock)?\.json|electron\.vite\.config\.ts|tsconfig[^/]*\.json)$/, 'the build'],
];

const UNKNOWN = 'not a path this script knows, so it is taken as read by all';

/** The feature a scenario test file is named after, if any: fly-session belongs to fly. */
export function ownerOf(spec: string, features: readonly string[]): string | undefined {
  const name = SPEC.exec(spec)?.[1];
  if (!name) return undefined;
  return features
    .filter((id) => name === id || name.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
}

/** The scenario itself and every scenario built on it with `extends`, however many steps away. */
export function builtOn(name: string, scenarios: Record<string, string>): string[] {
  const found = new Set([name]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [other, text] of Object.entries(scenarios)) {
      const base = /^extends:\s*["']?([^\s"']+?)(?:\.yaml)?["']?\s*$/m.exec(text)?.[1];
      if (base && found.has(base) && !found.has(other)) {
        found.add(other);
        grew = true;
      }
    }
  }
  return [...found].sort();
}

const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const quoted = (text: string, name: string): boolean =>
  [`'${name}'`, `"${name}"`, `\`${name}\``].some((form) => text.includes(form));

/** The scenarios a changed fixture file belongs to; none when that cannot be told. */
function scenariosOf(file: string, world: World): string[] {
  const scenario = /^fixtures\/scenarios\/([^/]+)\.yaml$/.exec(file)?.[1];
  if (scenario) return builtOn(scenario, world.scenarios);
  const rig = /^fixtures\/rigs\/([^/]+)\//.exec(file)?.[1];
  const onRig = rig ? new RegExp(`^rig:\\s*["']?${literal(rig)}["']?\\s*$`, 'm') : undefined;
  // A scenario names its data by the path below fixtures/scenarios.
  const below = file.replace(/^fixtures\/(scenarios\/)?/, '');
  const direct = Object.entries(world.scenarios)
    .filter(([, text]) => (onRig ? onRig.test(text) : below.includes('/') && text.includes(below)))
    .map(([name]) => name);
  return [...new Set(direct.flatMap((name) => builtOn(name, world.scenarios)))].sort();
}

export function pickScenarioFiles(changed: readonly string[], world: World): Picked {
  const every = Object.keys(world.specs).sort();
  const why = new Map<string, string[]>();
  const add = (spec: string, reason: string): void => {
    const reasons = why.get(spec) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    why.set(spec, reasons);
  };
  const shared: Picked['shared'] = [];
  const unread: string[] = [];

  for (const file of [...new Set(changed.map((raw) => raw.replace(/\\/g, '/')))].sort()) {
    if (SPEC.test(file)) {
      // One that was deleted is not in the world, and there is nothing of it to run.
      if (file in world.specs) add(file, 'it changed');
      else unread.push(file);
      continue;
    }
    if (UNREAD.some((pattern) => pattern.test(file))) {
      unread.push(file);
      continue;
    }
    const feature = /^src\/features\/([^/]+)\//.exec(file)?.[1];
    if (feature && world.features.includes(feature)) {
      for (const spec of every) {
        const owner = ownerOf(spec, world.features);
        if (owner === feature) add(spec, `the ${feature} feature changed (${file})`);
        else if (!owner) add(spec, `it crosses features, and ${feature} changed`);
      }
      continue;
    }
    if (file.startsWith('fixtures/')) {
      const scenarios = scenariosOf(file, world);
      const readers = every.filter((spec) =>
        scenarios.some((name) => quoted(world.specs[spec] ?? '', name))
      );
      if (readers.length === 0) {
        shared.push({ file, why: 'a fixture no scenario test names, so any of them may read it' });
        continue;
      }
      for (const spec of readers) {
        const used = scenarios.filter((name) => quoted(world.specs[spec] ?? '', name));
        add(spec, `it uses ${used.join(', ')} (${file} changed)`);
      }
      continue;
    }
    shared.push({ file, why: SHARED.find(([pattern]) => pattern.test(file))?.[1] ?? UNKNOWN });
  }

  if (shared.length > 0) {
    return {
      all: true,
      specs: every.map((file) => ({ file, why: ['a file every scenario can read changed'] })),
      shared,
      unread,
    };
  }
  return {
    all: false,
    specs: [...why.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, reasons]) => ({ file, why: reasons })),
    shared,
    unread,
  };
}

/** What the pick is, in lines a person reads before deciding to wait for it. */
export function describePick(picked: Picked, total: number, base: string): string[] {
  const lines: string[] = [];
  if (picked.all) {
    lines.push(
      `All ${total} scenario test files run, because of what changed since ${base} that every scenario can read:`
    );
    for (const { file, why } of picked.shared) lines.push(`  ${file}: ${why}`);
  } else if (picked.specs.length === 0) {
    lines.push(`No scenario test reads what changed since ${base}. Nothing to run.`);
  } else {
    lines.push(
      `${picked.specs.length} of ${total} scenario test files run for what changed since ${base}:`
    );
    for (const { file, why } of picked.specs) {
      const more = why.length > 1 ? ` (and ${why.length - 1} more reasons)` : '';
      lines.push(`  ${file}: ${why[0]}${more}`);
    }
    lines.push(
      'This is the first look, not the whole answer: the build server runs every scenario file.'
    );
  }
  if (picked.unread.length > 0) {
    lines.push(`${picked.unread.length} changed file(s) are read by no scenario test.`);
  }
  return lines;
}

/** The scenario tests, features and scenarios of the repository at `root`. */
export function readWorld(root: string): World {
  const texts = (dir: string, ending: string): [string, string][] =>
    existsSync(path.join(root, dir))
      ? readdirSync(path.join(root, dir))
          .filter((name) => name.endsWith(ending))
          .sort()
          .map((name) => [name, readFileSync(path.join(root, dir, name), 'utf8')])
      : [];
  const features = path.join(root, 'src', 'features');
  return {
    specs: Object.fromEntries(
      texts('tests/e2e', '.e2e.ts').map(([name, text]) => [`tests/e2e/${name}`, text])
    ),
    features: existsSync(features)
      ? readdirSync(features, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [],
    scenarios: Object.fromEntries(
      texts('fixtures/scenarios', '.yaml').map(([name, text]) => [name.slice(0, -5), text])
    ),
  };
}

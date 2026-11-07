/**
 * CFG-PROFILE-015: every path variable a game module can hand out is declared with a label.
 *
 * The setup editor accepts a game's variables whether or not the game is on this PC, and the
 * Variables menu offers them, from `knownPathVariables`: a variable a module assigns in
 * `pathVariables` but never declares in `pathVariableLabels` would be refused by the editor on
 * a PC without that game, as {MSFS2024_USER} and {AC_USER} once were. This scans every
 * src/features/games/<game>/module.ts for the variables it assigns and checks each is declared.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameRegistry, type GameModule } from '../../src/core/games';
import {
  STANDARD_VARIABLE_LABELS,
  knownPathVariables,
  standardPathVariables,
} from '../../src/core/pathVariables';
import { repoRoot, scenarioRig } from '../helpers';

const modules = import.meta.glob<{ default: GameModule }>('../../src/features/games/*/module.ts', {
  eager: true,
});

const NAME = /^[A-Z][A-Z0-9_]*$/;

/** The variables a module's source assigns: variables['DCS_USER'] = ..., variables.DCS_USER = ... */
function assignedIn(source: string): string[] {
  const names = new Set<string>();
  const assignment = /variables\s*(?:\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]|\.([A-Z][A-Z0-9_]*))\s*=/g;
  for (const m of source.matchAll(assignment)) names.add((m[1] ?? m[2])!);
  return [...names].sort();
}

describe('path variables of the game modules', () => {
  it('finds every game module and its source', () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(8);
  });

  for (const [file, { default: module }] of Object.entries(modules)) {
    it(`${module.id} declares a label for every variable it assigns`, async () => {
      const source = await fs.readFile(path.join(repoRoot, 'tests', 'unit', file), 'utf8');
      const assigned = assignedIn(source);
      const labels = module.pathVariableLabels ?? {};
      if (module.pathVariables) {
        expect(assigned, `${file} assigns no variables although it has pathVariables`).not.toEqual(
          []
        );
      }
      for (const name of assigned) {
        expect(
          labels[name],
          `${file}: variables['${name}'] has no label in pathVariableLabels`
        ).toBeTypeOf('string');
        expect(
          labels[name]!.trim().length,
          `${file}: the label of ${name} is empty`
        ).toBeGreaterThan(0);
      }
      for (const name of Object.keys(labels)) {
        expect(name, `${file}: ${name} is not a variable name`).toMatch(NAME);
        expect(assigned, `${file}: ${name} is declared but never assigned`).toContain(name);
        expect(
          STANDARD_VARIABLE_LABELS,
          `${file}: ${name} is a standard variable`
        ).not.toHaveProperty(name);
      }
    });
  }

  it('the parser sees the ways a module assigns a variable', () => {
    expect(
      assignedIn(
        `variables['A_B'] = x; variables["C2"] = y;\n  variables.D_E = z; other['NOT'] = 1; variables['x'] = 2`
      )
    ).toEqual(['A_B', 'C2', 'D_E']);
  });

  it('knownPathVariables has the standard variables, STEAM included, and every module’s', async () => {
    const games = new GameRegistry();
    for (const { default: module } of Object.values(modules)) games.register(module);
    const known = knownPathVariables(games);
    // Known on every PC, whether or not Steam or any game is here.
    for (const name of Object.keys(STANDARD_VARIABLE_LABELS)) expect(known).toHaveProperty(name);
    expect(known['STEAM']).toBe('Steam library');
    for (const { default: module } of Object.values(modules)) {
      for (const [name, label] of Object.entries(module.pathVariableLabels ?? {})) {
        expect(known[name]).toBe(label);
      }
    }
    // The variables a hand-kept list once left out of the editor.
    for (const name of [
      'MSFS2024_USER',
      'AC_USER',
      'AC_INSTALL',
      'IRACING_INSTALL',
      'LMU_INSTALL',
      'BEAMNG_INSTALL',
    ]) {
      expect(known, name).toHaveProperty(name);
    }
    expect(known).not.toHaveProperty('MSFS_USER');

    // Every standard variable that resolves on a PC is one of the labelled ones.
    const rig = await scenarioRig('flying-all-good', { files: [] });
    try {
      const resolved = await standardPathVariables(rig.ports);
      for (const name of Object.keys(resolved)) {
        expect(STANDARD_VARIABLE_LABELS).toHaveProperty(name);
      }
    } finally {
      await rig.cleanup();
    }
  });
});

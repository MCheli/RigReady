import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { proposedSetup } from '../../../core/captureDefaults';
import type { McpCallContext } from '../../../core/mcp';
import type { Profile } from '../../../core/profile/schema';
import { builtinTools } from './curated';

/**
 * "Create a setup from this rig" as an assistant calls it, on a scenario rig with every
 * feature wired: the tool runs against the real capture and the real save.
 */

let app: WiredApp;
afterEach(() => app?.cleanup());

interface Made {
  id: string;
  name: string;
  game?: string;
  checks: { title: string; required: boolean; type: string }[];
  steps: string[];
  leftOut: string[];
  problems: string[];
}

/** What the New setup page reads: the same call the tool makes. */
type Read = Parameters<typeof proposedSetup>[0] & {
  candidates: { title: string; game?: string; check: { type: string; title: string } }[];
  tracked: { label: string; path: string }[];
};

const ctx = (): McpCallContext => ({
  client: 'Test assistant',
  signal: new AbortController().signal,
  invoke: async (channel, input) => {
    const handler = app.wiring.handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler(input);
  },
});

async function createFromRig(input: {
  name: string;
  game?: string;
  everything?: boolean;
}): Promise<Made> {
  const tool = builtinTools({ manual: () => [] }).find((t) => t.name === 'setup_create_from_rig')!;
  const result = await tool.run(tool.input.parse(input), ctx());
  if (!result.ok) throw new Error(`${result.error.code} ${result.error.message}`);
  return result.value as Made;
}

const titles = (made: Made): string[] => made.checks.map((c) => c.title);

describe('CFG-PROFILE-022: a setup an assistant makes from the rig is the one the New setup page makes', () => {
  it('on a rig with a wheel and flight gear, a racing game gets the wheel and a flight sim the flight gear', async () => {
    app = await wiredApp('flying-fresh');
    const racing = await createFromRig({ name: 'Racing by an assistant', game: 'iracing' });
    expect(titles(racing)).toContain('FANATEC Podium Wheel Base DD2');
    expect(
      titles(racing).filter((t) => /WINWING|T-Pendular|R-VPC|TrackIR|SimAppPro/.test(t))
    ).toEqual([]);
    // Left out is said, not hidden.
    expect(racing.leftOut).toEqual(expect.arrayContaining(['WINWING MFD1-L', 'TrackIR software']));

    const flight = await createFromRig({ name: 'Flying by an assistant', game: 'dcs' });
    expect(titles(flight)).toEqual(
      expect.arrayContaining([
        'WINWING MFD1-L',
        'T-Pendular-Rudder',
        'SimAppPro',
        'TrackIR software',
        'DCS bindings match devices (F/A-18C)',
      ])
    );
    expect(titles(flight)).not.toContain('FANATEC Podium Wheel Base DD2');
    expect(flight.leftOut).toContain('FANATEC Podium Wheel Base DD2');
  });

  it('saves exactly what the page proposes before anyone changes a tick: the same checks and the same files to back up', async () => {
    app = await wiredApp('flying-fresh');
    const read = await app.invoke<Read>('profiles:capture');
    for (const game of ['dcs', 'iracing']) {
      const proposed = proposedSetup(read, game);
      const made = await createFromRig({ name: `From the rig for ${game}`, game });
      expect(made.game).toBe(game);
      expect(made.checks.map((c) => ({ type: c.type, title: c.title }))).toEqual(
        [...proposed.kept.map((c) => c.check!), ...proposed.stepChecks].map(
          (c: { type: string; title?: string }) => ({ type: c.type, title: c.title })
        )
      );
      expect(made.leftOut).toHaveLength(read.candidates.length - proposed.kept.length);
      const saved = await app.invoke<Profile>('profiles:get', { id: made.id });
      const backedUp = (saved.extensions['backup'] as { items?: { path: string }[] } | undefined)
        ?.items;
      expect((backedUp ?? []).map((item) => item.path)).toEqual(
        proposed.tracked.map((t) => (t as unknown as { path: string }).path)
      );
    }
    // And the rules did have something to decide here: the two setups differ.
    expect(proposedSetup(read, 'dcs').tracked.length).toBeGreaterThan(0);
    expect(proposedSetup(read, 'dcs').kept).not.toEqual(proposedSetup(read, 'iracing').kept);
  });

  it('a game that reads a gamepad gets "Start a virtual controller" before launch and the driver check with it', async () => {
    app = await wiredApp('virtual-controller-ready', { files: ['Program Files (x86)/Steam/**'] });
    const made = await createFromRig({ name: 'Ace by an assistant', game: 'ace-combat-8' });
    expect(made.steps).toEqual(['Start a virtual controller']);
    expect(made.checks).toContainEqual({
      title: 'Virtual controller driver installed',
      required: true,
      type: 'virtual-controller.driver',
    });
    // The game is fed from the flight gear; a head tracker and helpers are not kept for it.
    expect(titles(made)).toContain('T-Pendular-Rudder');
    expect(titles(made).some((t) => /TrackIR|SimAppPro|Stream Deck/.test(t))).toBe(false);
    const saved = await app.invoke<Profile>('profiles:get', { id: made.id });
    expect(saved.actions?.preLaunch).toEqual([
      expect.objectContaining({
        type: 'virtual-controller.start',
        params: { profile: 'my-ace-combat-stick', profileName: 'My Ace Combat stick' },
        continueOnError: false,
      }),
    ]);
  });

  it('asked for everything, keeps every check the page lists for the game and still nothing of another game', async () => {
    app = await wiredApp('flying-fresh');
    const made = await createFromRig({ name: 'All of it', game: 'iracing', everything: true });
    expect(titles(made)).toEqual(
      expect.arrayContaining([
        'FANATEC Podium Wheel Base DD2',
        'WINWING MFD1-L',
        'TrackIR software',
      ])
    );
    expect(titles(made).some((t) => /DCS bindings|Export\.lua|DCS World installed/.test(t))).toBe(
      false
    );
    const read = await app.invoke<Read>('profiles:capture');
    expect(made.leftOut.sort()).toEqual(
      read.candidates
        .filter((c) => c.game && c.game !== 'iracing')
        .map((c) => c.title)
        .sort()
    );
  });

  it('a game that is not on this PC is refused in words, and nothing is saved', async () => {
    app = await wiredApp('flying-fresh');
    const tool = builtinTools({ manual: () => [] }).find(
      (t) => t.name === 'setup_create_from_rig'
    )!;
    const result = await tool.run(tool.input.parse({ name: 'Nope', game: 'no-such-game' }), ctx());
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toBe('No game "no-such-game" was found on this PC.');
    expect(await app.invoke<{ id: string }[]>('profiles:list')).toEqual([]);
  });
});

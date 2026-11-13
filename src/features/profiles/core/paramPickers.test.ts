import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CheckContext, ParamPicker } from '../../../core/checks/registry';
import { err, ok } from '../../../core/result';
import { asksForGame, gamesPicker, resolvePicker, usesGamesList } from './paramPickers';

const logged: string[] = [];
const ctx = {
  log: { error: (message: string) => logged.push(message) },
} as unknown as CheckContext;

const picker = (extra: Partial<ParamPicker> = {}): ParamPicker => ({
  list: 'things',
  param: 'thingId',
  label: 'Thing',
  empty: 'No things yet.',
  choices: async () => ok([{ value: 'a', label: 'Alpha', detail: 'the first' }]),
  ...extra,
});

const schemaOf = (shape: z.ZodRawShape): Record<string, unknown> =>
  z.toJSONSchema(z.object(shape), { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;

describe('CFG-PROFILE-019: a list of names in place of a typed id', () => {
  it('carries the choices as they are now, with what choosing fills in', async () => {
    expect(await resolvePicker(picker(), ctx)).toEqual({
      list: 'things',
      param: 'thingId',
      label: 'Thing',
      fills: [],
      empty: 'No things yet.',
      choices: [{ value: 'a', label: 'Alpha', detail: 'the first' }],
    });
    expect(
      await resolvePicker(
        picker({ fills: ['thingName'], shares: ['role'], unpicked: 'None chosen.' }),
        ctx
      )
    ).toMatchObject({ fills: ['thingName'], shares: ['role'], unpicked: 'None chosen.' });
  });

  it('a list that cannot be read says why and offers nothing, and the editor still opens', async () => {
    const failed = await resolvePicker(
      picker({ choices: async () => err('things.read', 'The things file is damaged.') }),
      ctx
    );
    expect(failed).toMatchObject({ choices: [], problem: 'The things file is damaged.' });
    const threw = await resolvePicker(
      picker({
        choices: async () => {
          throw new Error('boom');
        },
      }),
      ctx
    );
    expect(threw).toMatchObject({ choices: [], problem: 'The list could not be read.' });
    expect(logged).toContain('picker things threw');
  });

  it('the games RigReady knows are chosen by name, in order', async () => {
    const games = gamesPicker({
      all: () => [
        { id: 'iracing', name: 'iRacing' },
        { id: 'dcs', name: 'DCS World' },
      ],
    } as unknown as Parameters<typeof gamesPicker>[0]);
    expect(games).toMatchObject({ list: 'games', param: 'game', label: 'Game' });
    expect(await games.choices(ctx)).toEqual({
      ok: true,
      value: [
        { value: 'dcs', label: 'DCS World' },
        { value: 'iracing', label: 'iRacing' },
      ],
    });
  });

  it('a type is asked which game with that list when it has a typed game of its own', () => {
    const typed = schemaOf({ game: z.string() });
    const optional = schemaOf({ game: z.string().optional(), other: z.number() });
    const nullable = schemaOf({ game: z.string().nullable() });
    const closed = schemaOf({ game: z.enum(['dcs', 'iracing']) });
    const none = schemaOf({ name: z.string() });
    expect(asksForGame(typed)).toBe(true);
    expect(asksForGame(optional)).toBe(true);
    expect(asksForGame(nullable)).toBe(true);
    // A closed list of games is already a list, and a type without a game is not asked.
    expect(asksForGame(closed)).toBe(false);
    expect(asksForGame(none)).toBe(false);
    expect(asksForGame({})).toBe(false);

    expect(usesGamesList(typed, undefined)).toBe(true);
    expect(usesGamesList(typed, { param: 'layoutId', fills: ['layoutName'] })).toBe(true);
    // Its own list already says the game: an aircraft belongs to one game.
    expect(usesGamesList(typed, { param: 'aircraft', fills: ['game'] })).toBe(false);
    expect(usesGamesList(typed, { param: 'game' })).toBe(false);
    expect(usesGamesList(none, undefined)).toBe(false);
  });
});

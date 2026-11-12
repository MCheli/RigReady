import type { CheckContext, ParamPicker } from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { ok } from '../../../core/result';
import type { PickerInfo } from '../contract';

/**
 * A picker with its choices as they are right now. A list that cannot be read is not a
 * reason to fail the whole editor: the picker says why and offers nothing.
 */
export async function resolvePicker(picker: ParamPicker, ctx: CheckContext): Promise<PickerInfo> {
  const base = {
    list: picker.list,
    param: picker.param,
    label: picker.label,
    fills: picker.fills ?? [],
    ...(picker.shares?.length ? { shares: picker.shares } : {}),
    empty: picker.empty,
    ...(picker.unpicked ? { unpicked: picker.unpicked } : {}),
  };
  try {
    const listed = await picker.choices(ctx);
    if (!listed.ok) return { ...base, choices: [], problem: listed.error.message };
    return { ...base, choices: listed.value };
  } catch (e) {
    ctx.log.error(`picker ${picker.list} threw`, e);
    return { ...base, choices: [], problem: 'The list could not be read.' };
  }
}

export const GAME_PARAM = 'game';
export const GAME_LABEL = 'Game';

/** The games RigReady knows, by name: for every check and fix that asks which game. */
export function gamesPicker(games: Pick<GameRegistry, 'all'>): ParamPicker {
  return {
    list: 'games',
    param: GAME_PARAM,
    label: GAME_LABEL,
    empty: 'RigReady knows no games yet.',
    choices: async () =>
      ok(
        games
          .all()
          .map((g) => ({ value: g.id, label: g.name }))
          .sort((a, b) => a.label.localeCompare(b.label))
      ),
  };
}

/**
 * True when a type is asked which game with the list of games: it has a free-text `game`,
 * and its own list does not already say (an aircraft belongs to one game).
 */
export function usesGamesList(
  schema: Record<string, unknown>,
  own: Pick<ParamPicker, 'param' | 'fills'> | undefined
): boolean {
  if (!asksForGame(schema)) return false;
  return own?.param !== GAME_PARAM && !own?.fills?.includes(GAME_PARAM);
}

/** Text anyone can type: a string ("string or nothing" too) that is not a closed list. */
function freeText(schema: Record<string, unknown>): boolean {
  const type = schema['type'];
  const text = type === 'string' || (Array.isArray(type) && type.includes('string'));
  return text && !Array.isArray(schema['enum']);
}

/** True when a params schema has a free-text `game`: the id of a game module, typed by hand. */
export function asksForGame(schema: Record<string, unknown>): boolean {
  const properties = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
  const game = properties?.['game'];
  if (!game) return false;
  if (freeText(game)) return true;
  const anyOf = game['anyOf'];
  return Array.isArray(anyOf) && anyOf.some((s: Record<string, unknown>) => freeText(s));
}

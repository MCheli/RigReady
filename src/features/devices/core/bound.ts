import { z } from 'zod';
import { directInputName, type AircraftBindings, type BindingReader } from '../../../core/bindings';

/**
 * "What does this control do?" for the input tester: the actions a game has bound to each
 * input of each controller, read through core's binding registry (`ctx.bindings`). The
 * devices feature knows nothing about any game's files.
 */

export const BindingSourceSchema = z.object({
  game: z.string(),
  gameName: z.string(),
  aircraft: z.array(z.object({ id: z.string(), name: z.string(), hasUserBindings: z.boolean() })),
});
export type BindingSource = z.infer<typeof BindingSourceSchema>;

export const BoundActionSchema = z.object({
  action: z.string(),
  category: z.array(z.string()),
  /** The user's own binding or one the game ships. */
  source: z.enum(['user', 'default']),
  /** Modifiers that must be held with the input. */
  modifiers: z.array(z.string()),
});
export type BoundAction = z.infer<typeof BoundActionSchema>;

export const BoundControlSchema = z.object({
  /** The input as press detection names it (JOY_BTN12, JOY_BTN_POV1_U, JOY_Z), in every game. */
  input: z.string(),
  label: z.string(),
  actions: z.array(BoundActionSchema),
  /** Several actions fire together on this input (same modifiers): usually a mistake. */
  duplicate: z.boolean(),
});
export type BoundControl = z.infer<typeof BoundControlSchema>;

export const BoundInputsSchema = z.object({
  game: z.string(),
  gameName: z.string(),
  aircraft: z.object({ id: z.string(), name: z.string() }),
  controllers: z.array(
    z.object({
      /** DirectInput instance GUID, upper case. */
      guid: z.string(),
      /** Where this controller's bindings are shown and edited. */
      route: z.string(),
      controls: z.array(BoundControlSchema),
    })
  ),
});
export type BoundInputs = z.infer<typeof BoundInputsSchema>;

/** Groups a game's bindings by controller and input. */
export function boundInputsOf(
  reader: Pick<BindingReader, 'game' | 'gameName' | 'route'>,
  bindings: AircraftBindings
): BoundInputs {
  return {
    game: reader.game,
    gameName: reader.gameName,
    aircraft: {
      id: bindings.aircraft.id,
      // The one set a game uses for everything is called by the game: "in iRacing", not
      // "in All cars".
      name: bindings.aircraft.general ? reader.gameName : bindings.aircraft.name,
    },
    controllers: bindings.devices
      .filter((device) => device.kind === 'controller' && device.guid !== undefined)
      .map((device) => {
        const controls = new Map<string, BoundControl>();
        for (const binding of device.bindings) {
          // A reader that says which control it is (every racing game, and DCS) is found by
          // the name press detection gives that control, whatever the game calls its input.
          const input = binding.control ? directInputName(binding.control) : binding.input;
          let control = controls.get(input);
          if (!control) {
            control = { input, label: binding.inputLabel, actions: [], duplicate: false };
            controls.set(input, control);
          }
          control.actions.push({
            action: binding.action,
            category: binding.category,
            source: binding.source,
            modifiers: binding.modifiers,
          });
        }
        for (const control of controls.values()) {
          const together = new Map<string, number>();
          for (const action of control.actions) {
            const key = [...action.modifiers].sort().join('+');
            together.set(key, (together.get(key) ?? 0) + 1);
          }
          control.duplicate = [...together.values()].some((n) => n > 1);
        }
        return {
          guid: device.guid!.toUpperCase(),
          route: reader.route({ guid: device.guid!, aircraftId: bindings.aircraft.id }),
          controls: [...controls.values()],
        };
      }),
  };
}

/** The control of a controller, by DirectInput GUID and the game's input name. */
export function boundControl(
  bound: BoundInputs | undefined,
  guid: string | undefined,
  input: string | undefined
): BoundControl | undefined {
  if (!bound || !guid || !input) return undefined;
  return bound.controllers
    .find((c) => c.guid === guid.toUpperCase())
    ?.controls.find((c) => c.input === input);
}

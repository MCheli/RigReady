import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { OverlayStateSchema, PressRowsSchema, SetupDefaultSchema } from './core/model';
import { AtSchema } from './core/settings';

export type {
  OverlaySource,
  OverlayState,
  PressAction,
  PressRow,
  SetupDefault,
  SetupOverlay,
  WidgetState,
} from './core/model';

/** The id of a part of the overlay, as overlay:state lists them. */
const WidgetIdSchema = z.string().min(1).max(60);

export const overlayContract = defineContract(
  'overlay',
  {
    state: channel(noInput, OverlayStateSchema, {
      describe:
        'Answers with the in-game overlay: whether it is on, each of its parts (the recent presses) with its options, the size of its window, the screen and place it is on (or that it follows the main screen) and whether it is showing, the screens that are on, which setup, game and aircraft or car the names of the actions come from, every setup and whether the overlay shows in it, and whether the controllers are being read. Changes nothing. The overlay shows over a game in a window or borderless; it does not show inside a VR headset and may not show over a game in exclusive full screen.',
      tier: 'read',
    }),
    set: channel(z.object({ on: z.boolean() }), OverlayStateSchema, {
      describe:
        'Turns the in-game overlay on or off. On, a small see-through window stays over whatever is on the screen (it takes no clicks and no keys from the game) and lists each controller button as it is pressed with what the game does on it, while the setup in use has the overlay on; it comes up again whenever RigReady runs. Each setup has its own switch for it (profile extensions.overlay.on, changed with profiles:save); a setup without one has it on only where RigReady can read its game’s bindings. Off, the window is taken away. Writes only RigReady’s own settings.',
      tier: 'change',
    }),
    setupDefault: channel(
      z.object({
        game: z.string().min(1).max(100).optional(),
        gameName: z.string().max(80).optional(),
      }),
      SetupDefaultSchema,
      {
        describe:
          'Answers whether the in-game overlay is on to begin with in a setup for this game (game: a game id as profiles:games lists them, or "other" with gameName; left out, a setup for no game in particular): on when RigReady can read that game’s bindings on this PC, so the overlay can say what a press does, otherwise off with the reason. Also whether the overlay itself is turned on. Changes nothing.',
        tier: 'read',
      }
    ),
    options: channel(
      z.object({ widget: WidgetIdSchema, options: z.record(z.string(), z.unknown()) }),
      OverlayStateSchema,
      {
        describe:
          'Sets the options of one part of the overlay, all of them at once. For recent-presses: lifetimeSeconds (1 to 30, how long a press stays), rows (1 to 10), size (small, medium or large) and showUnbound (whether a press the game has nothing on is listed). widget and the options in effect come from overlay:state. Writes only RigReady’s own settings.',
        tier: 'change',
      }
    ),
    place: channel(
      z.object({
        widget: WidgetIdSchema,
        screen: z.string().min(1).max(300).nullable().optional(),
        at: AtSchema,
      }),
      OverlayStateSchema,
      {
        describe:
          'Puts one part of the overlay somewhere else: on a screen and at a place on it. screen is an id from overlay:state; null is the main screen of whatever monitor layout is in use; left out, the screen it is on. x and y go from 0 (left, top) to 1 (right, bottom). Remembered for that monitor. Writes only RigReady’s own settings.',
        tier: 'change',
      }
    ),
    move: channel(z.object({ widget: WidgetIdSchema, moving: z.boolean() }), OverlayStateSchema, {
      describe:
        'Lets the user drag one part of the overlay with the mouse (moving true), or locks it where it was dragged to and remembers that place (moving false). While it can be dragged it takes the mouse; locked, clicks go through it to the game. For the Overlay page in the window.',
      tier: 'off',
    }),
    aircraft: channel(
      z.object({ aircraftId: z.string().min(1).max(300).nullable() }),
      OverlayStateSchema,
      {
        describe:
          'Chooses the aircraft or car whose bindings name the presses in the overlay, for the setup in use; null goes back to the one RigReady picks itself. aircraftId comes from the choices of overlay:state. Writes only RigReady’s own settings.',
        tier: 'change',
      }
    ),
    current: channel(noInput, OverlayStateSchema, {
      describe:
        'Answers with the same as overlay:state as the overlay last worked it out, without reading the PC again. For the overlay’s own windows, which open over the game. Changes nothing.',
      tier: 'off',
    }),
    recent: channel(noInput, PressRowsSchema, {
      describe:
        'Answers with the presses the overlay lists right now, newest first: the control, the controller, what the game does on it for the aircraft or car in use, how often it was pressed running and how long ago. Empty while the overlay is off: the controllers are only read for it while it is on. Changes nothing.',
      tier: 'read',
    }),
  },
  {
    /** Anything overlay:state answers with changed: the same answer, as it is now. */
    changed: OverlayStateSchema,
    /** The recent presses changed: all of them, newest first. */
    presses: PressRowsSchema,
  }
);

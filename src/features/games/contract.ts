import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { LaunchTargetSchema } from '../../shared/models';

export const GameSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['racing', 'flight']).optional(),
  installs: z.array(
    z.object({
      source: z.enum(['steam', 'standalone', 'store']),
      installDir: z.string(),
      launch: LaunchTargetSchema.optional(),
    })
  ),
  /** Of the first install. */
  version: z.object({ version: z.string(), updatePending: z.boolean().optional() }).optional(),
  /** One of the game's processes is running now. */
  running: z.boolean().default(false),
  configLocations: z.array(z.object({ id: z.string(), label: z.string(), path: z.string() })),
  trackedFiles: z.array(z.object({ label: z.string(), path: z.string() })).default([]),
  /** What RigReady can and cannot do for this game, in plain words. */
  notes: z.array(z.string()).default([]),
  /** Facts about this PC ("Last run as 0.38.5"). */
  facts: z.array(z.string()).default([]),
  /** When the game can be pointed at by hand: what to choose, and the folder chosen. */
  manualFolder: z.object({ label: z.string(), chosen: z.string().optional() }).optional(),
  problems: z.array(z.string()),
  /** A game the user added on the Games page; it can be edited and removed. */
  addedByYou: z.boolean().optional(),
});
export type GameSummary = z.infer<typeof GameSummarySchema>;

const GameId = z.object({ gameId: z.string().regex(/^[a-z0-9-]+$/) });
/** A game id; main refuses one that is not among the games the user added ("user-..."). */
const UserGameId = z
  .string()
  .max(45)
  .regex(/^[a-z0-9-]+$/);
/**
 * A program or folder of a game the user adds, by the pick main made of it: "pick-3" for
 * one chosen in a native picker this session, "saved-0" for one the game already has.
 * The renderer never hands main a path.
 */
const PickRef = z.string().regex(/^(pick|saved)-\d{1,6}$/);

export const UserGameKindSchema = z.enum(['flight', 'racing', 'none']);

export const UserGameViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: UserGameKindSchema,
  /** The program Launch starts, as chosen. */
  program: z.string().optional(),
  programRef: z.string().optional(),
  folders: z.array(z.object({ ref: z.string(), path: z.string() })),
  steamAppId: z.string().optional(),
  processes: z.array(z.string()),
  /** The setups on this PC that are for this game, by name. */
  usedBy: z.array(z.string()),
  /** What was left out when the games file was read, and why. */
  problems: z.array(z.string()),
});
export type UserGameView = z.infer<typeof UserGameViewSchema>;

const PickedSchema = z.object({
  picked: z.boolean(),
  ref: z.string().optional(),
  /** The program or folder chosen, to show. */
  shown: z.string().optional(),
  /** For a program: a name for the game and the program's image name, to start from. */
  name: z.string().optional(),
  process: z.string().optional(),
});

export const gamesContract = defineContract('games', {
  /** Every registered game module with what was detected on this PC. */
  list: channel(noInput, z.array(GameSummarySchema), {
    describe:
      'Answers with every game RigReady knows and what was found of each on this PC: installs, version, whether it is running, config folders and what RigReady can do for it. Game ids come from here. Changes nothing.',
    tier: 'read',
  }),
  /** One game, the same as in list(). */
  get: channel(GameId, GameSummarySchema, {
    describe:
      'Answers with one game as games:list does. gameId comes from games:list. Changes nothing.',
    tier: 'read',
  }),
  /**
   * Asks the user for the game's folder and remembers it when it holds the game.
   * `chosen` is false when the picker was cancelled.
   */
  chooseFolder: channel(GameId, z.object({ chosen: z.boolean(), game: GameSummarySchema }), {
    describe: "Opens a native folder picker to point RigReady at a game's folder.",
    tier: 'off',
  }),
  /** Forgets a folder chosen by hand. */
  forgetFolder: channel(GameId, GameSummarySchema, {
    describe: 'Forgets a game folder the user chose by hand. gameId comes from games:list.',
    tier: 'change',
  }),
  /** Starts the game from its first install. Resolves with what happened, in words. */
  launch: channel(GameId, z.object({ message: z.string() }), {
    describe:
      "Starts a game from its first install, without a setup's checks or actions. gameId comes from games:list. Prefer fly:launch when the user plays with a setup.",
    tier: 'launch',
  }),
  /** The games the user added, with what each names, and what was wrong with the file. */
  userGames: channel(
    noInput,
    z.object({ games: z.array(UserGameViewSchema), problems: z.array(z.string()) }),
    {
      describe:
        'Answers with the games the user added on the Games page: the program, settings folders, Steam app id and program names of each, and which setups use it. Their ids start with "user-". Changes nothing.',
      tier: 'read',
    }
  ),
  /** Asks the user for a game's program in the native file picker. */
  pickProgram: channel(noInput, PickedSchema, {
    describe: 'Opens a native file picker for the program of a game the user adds.',
    tier: 'off',
  }),
  /** Asks the user for a folder where a game keeps its settings, in the native folder picker. */
  pickFolder: channel(z.object({ game: z.string().max(60).optional() }), PickedSchema, {
    describe: 'Opens a native folder picker for a settings folder of a game the user adds.',
    tier: 'off',
  }),
  /** Adds a game of the user's own, or changes one (gameId set). Resolves with it as listed. */
  saveUserGame: channel(
    z.object({
      gameId: UserGameId.optional(),
      name: z.string().max(60),
      kind: UserGameKindSchema,
      program: PickRef.optional(),
      folders: z.array(PickRef).max(8),
      steamAppId: z
        .string()
        .regex(/^\d{1,10}$/)
        .optional(),
      processes: z.array(z.string().max(64)).max(8),
    }),
    GameSummarySchema,
    {
      describe:
        'Changes a game the user added: its name, kind (flight, racing or none), Steam app id and program names. gameId and the "saved-N" refs of its program and folders come from games:userGames; a new program or folder can only be chosen by the user in the window.',
      tier: 'change',
    }
  ),
  /**
   * Removes a game the user added. The setups for it become setups for "Another game" with
   * its name; resolves with their names.
   */
  removeUserGame: channel(
    z.object({ gameId: UserGameId }),
    z.object({ name: z.string(), setups: z.array(z.string()) }),
    {
      describe:
        'Removes a game the user added. Its setups keep working as setups for "Another game" with the same name. gameId comes from games:userGames.',
      tier: 'change',
    }
  ),
});

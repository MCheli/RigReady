import path from 'node:path';
import { z } from 'zod';
import type { BindingProposal, BindingReader, BindingRegistry } from '../../../core/bindings';
import { JsonStore } from '../../../core/jsonStore';
import type { Logger } from '../../../core/logger';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { AppSettingsPatch } from '../../../core/settings';
import {
  API_ROOT,
  approximateTokens,
  DEFAULT_MODEL,
  knownModel,
  type MessageAnswer,
  type Usage,
} from './anthropic';
import { budgetStopMessage, MonthSpend } from './budget';
import { draftSchema, draftTask, validateDraft } from './draft';
import { describeInput, fits, hasInput } from './inputs';
import {
  classGuides,
  forCars,
  classInName,
  iracingEntries,
  iracingParts,
  isIracingId,
  IRACING_PREFIX,
  type IracingBindings,
  type IracingEntry,
  type IracingOverview,
  type IracingWanted,
} from './iracing';
import { guideProblem, MAX_GUIDE_BYTES, starterGuide } from './ownGuide';
import {
  GAME_ROLES,
  gameOfKey,
  GUIDE_GAME_NAMES,
  GUIDE_GAMES,
  guideKey,
  matchActions,
  packText,
  parsePack,
  placeTitle,
  plainLabels,
  resolvePack,
  roleTitle,
  tierTitle,
  TIERS,
  type GuideGame,
  type Pack,
} from './pack';
import {
  ProgressSchema,
  AcknowledgedSchema,
  DEFAULT_MONTHLY_BUDGET,
  DEFAULT_QUESTION_CEILING,
  MAX_MONTHLY_BUDGET,
  MAX_PRICE,
  MAX_QUESTION_CEILING,
  PRICES_RECORDED,
  PriceSchema,
  type AiStatus,
  type MonthBudget,
  type Price,
  type WhatIsSent,
  type AircraftList,
  type AppliedView,
  type GuideGames,
  type GuideView,
  type IracingReviewView,
  type PlanView,
  type Prepared,
  type Progress,
  type RequestKind,
  type SendProgress,
  type Sent,
  type Staged,
  type StagedView,
  type UsageView,
} from './model';
import { shipped, shippedPack } from './shipped';
import { contextText, takeSnapshot, type GuideKind, type Snapshot } from './snapshot';
import { jsonText } from './openai';
import {
  checkBaseUrl,
  KEY_SECRETS,
  MODEL_ID,
  OPENAI_ROOT,
  OPENAI_DEFAULT_MODEL,
  PRESETS,
  PROVIDER_IDS,
  PROVIDER_NAMES,
  providerFor,
  suggestedModels,
  type ChatProvider,
  type ProviderId,
  type ProviderSettings,
  type Structured,
} from './providers';
import { JsonItemCounter } from './sse';
import type { Parsed } from './suggest';
import {
  cleanAnswer,
  markConflicts,
  MAX_QUESTION,
  questionTask,
  suggestionSchema,
  suggestionTask,
  systemPrompt,
  validatePlan,
  type SuggestionPlan,
} from './suggest';

export interface AiAssistContext {
  ports: Ports;
  log: Logger;
  bindings: BindingRegistry;
  /**
   * iRacing's bindings, from the iRacing bindings feature (its channels, in main.ts). Absent
   * where that feature is not wired: the guide then has nothing for iRacing.
   */
  iracing?: IracingBindings;
  /** Told how a streamed request is coming along; the app passes it on to the page. */
  onProgress?: (progress: SendProgress) => void;
  /** Told what the month is estimated at each time a request was counted, for Settings. */
  onCounted?: (month: MonthBudget) => void;
  /** Longest silence accepted from a streamed answer; the API module's default when absent. */
  streamIdleMs?: number;
  /**
   * The app settings, where `aiKeyPresent` says whether an Anthropic key is stored. Kept
   * true to the secret when the key is stored or removed here.
   */
  settings?: { update(patch: AppSettingsPatch): Promise<Result<unknown>> };
}

/** The long answers, which are streamed so the user sees them arrive and can cancel. */
const STREAMED: ReadonlySet<RequestKind> = new Set(['suggest', 'draft']);
/** Progress is reported at most this often while text arrives (and whenever an item is finished). */
const PROGRESS_EVERY_MS = 150;

const GAME = 'dcs';

const SettingsSchema = z.object({
  provider: z.enum(PROVIDER_IDS).default('anthropic'),
  /** The Anthropic model (its name from before there were other providers). */
  model: z.string().default(DEFAULT_MODEL),
  openai: z.object({ model: z.string().default(OPENAI_DEFAULT_MODEL) }).prefault({}),
  compatible: z
    .object({
      baseUrl: z.string().default(''),
      model: z.string().default(''),
      structured: z.enum(['schema', 'prompt']).default('schema'),
    })
    .prefault({}),
  /** Dollars one question to the assistant may reach by RigReady's estimate before it stops and asks; 0 for none. */
  questionCeiling: z.number().min(0).max(MAX_QUESTION_CEILING).default(DEFAULT_QUESTION_CEILING),
  /** Dollars a calendar month may reach by RigReady's estimate before it stops sending; 0 for none. */
  monthlyBudget: z.number().min(0).max(MAX_MONTHLY_BUDGET).default(DEFAULT_MONTHLY_BUDGET),
  /** Prices the user typed, by service and model (`priceKey`). They win over the built-in ones. */
  prices: z.record(z.string(), PriceSchema).default({}),
  /** When the user acknowledged, for each limit, that it is counted from estimates. */
  acknowledged: AcknowledgedSchema.prefault({}),
});

/** The limits that are counted from estimates: turning one on needs the user's acknowledgement. */
type Limit = 'questionCeiling' | 'monthlyBudget';
const LIMITS: Record<Limit, { most: number; off: string }> = {
  questionCeiling: { most: MAX_QUESTION_CEILING, off: '0 means no ceiling.' },
  monthlyBudget: { most: MAX_MONTHLY_BUDGET, off: '0 means no monthly budget.' },
};
/** The OpenAI-compatible key, kept with the host it was stored for. */
const CompatibleKeySchema = z.object({ origin: z.string(), key: z.string() });
const ProgressFileSchema = z.object({ aircraft: z.record(z.string(), ProgressSchema).default({}) });

/**
 * What is and is not sent, shown in Settings: by use, because the two uses send different
 * things. The assistant, which is the same for every game, sends the conversation and
 * whatever the tools it used answered. AI help in the binding guide, which is for DCS
 * aircraft and iRacing cars, sends a fixed, narrow description of one aircraft's or one
 * class's bindings. The assistant comes first: it is the part that everyone who sets up AI
 * uses, whatever they play.
 */
export function whatIsSent(provider: ChatProvider | undefined): WhatIsSent {
  const guide = {
    title: 'AI help in the binding guide (DCS aircraft and iRacing cars)',
    lines: [
      'Only when you ask for AI help on the Binding guide page, which covers DCS aircraft and iRacing cars. If you play neither, nothing in this list is ever sent.',
      'Sent for a DCS aircraft: its name, and DCS\'s list of its actions (ids, names, categories) with what each is bound to now; for each controller used in DCS, its DirectInput product name (such as "Joystick - HOTAS Warthog"), what it is used as, how many buttons and hats it has, and the names of its axes.',
      "Sent for iRacing: the class or car's name, iRacing's list of actions (ids and groups) with what each is bound to now in those bindings, and the DirectInput product name of each connected controller they name.",
      "Sent: the guide when there is one (RigReady's, one drafted by AI, or your own): its summary and each item with its title, tier, place and what it does. And your question.",
      'Never sent: file paths, device ids (GUIDs), serial numbers, the names you gave your devices, your Windows user or PC name, or any other content of your files.',
      'Every request is shown to you in full before it is sent.',
    ],
  };
  const assistant = {
    title: 'The assistant (any game)',
    lines: [
      'Used for questions about your rig and about RigReady, for proposing a setup and for drafting a script. It works the same whatever you play: a racing sim such as iRacing, a flight sim such as DCS, or anything else.',
      "Sent with every request: your messages and the assistant's answers in the conversation so far, RigReady's instructions for the assistant, and the list of tools it may use (their names, descriptions and arguments).",
      "Sent: what each tool answered when the assistant used it. A tool can answer what RigReady itself can show you: your setups and their checks and steps, whether the rig is ready, what is connected and running, where programs are installed, the names of your devices, the bindings and settings RigReady reads from your games, and pages of RigReady's manual.",
      'Every tool the assistant used is listed in the conversation. Open its row to read exactly what it answered, which is exactly what is sent.',
      "Before a tool's answer is sent, the path of your Windows user folder is replaced by {USER}, in any case, in its short form and in a file:/// address too, and the PC's name by {PC} when it has five or more characters. Nothing else is taken out: other names and paths go as they are.",
      'Not sent: anything no tool was used for. The assistant cannot read the PC in any other way.',
      'Each request is shown before it is sent, with its exact text one click away, unless you ticked "Don\'t show this again for this conversation".',
      'A setup it proposes or a script it drafts comes back in its answer and waits in RigReady until you save it or throw it away. Saving it sends nothing.',
    ],
  };
  if (!provider) {
    return [
      assistant,
      guide,
      {
        title: 'Where it goes',
        lines: ['Nothing is sent until a provider is set up and you press Send.'],
      },
    ];
  }
  const where = [
    provider.local
      ? `Requests go only to ${provider.host}, a server on this PC. Nothing leaves the PC unless that server sends it on.`
      : `Requests go only to ${provider.host}, over https. No other address is contacted, and redirects are not followed.`,
    `The key, when one is stored, goes only to ${provider.host}, in a request header. It is stored encrypted for your Windows account and never written to settings, logs, backups, shared setups or screenshots.`,
    'Testing a key sends the key and the name of the model, and to some servers the words "Reply with the word OK." Nothing of yours.',
  ];
  if (!provider.local) {
    where.push(
      provider.id === 'compatible'
        ? `The terms and privacy policy of the service at ${provider.host} apply to what is sent.`
        : `${provider.label}'s API terms and privacy policy apply to what is sent.`
    );
  }
  return [assistant, guide, { title: 'Where it goes', lines: where }];
}

const MAX_TOKENS: Record<RequestKind, number> = {
  suggest: 16000,
  draft: 16000,
  ask: 8000,
  explain: 8000,
};

interface PreparedRequest {
  kind: RequestKind;
  aircraftId: string;
  /** Who it goes to, fixed when it was shown to the user. */
  provider: ChatProvider;
  /** The answer's format was only asked for in the text: one more try when it does not check out. */
  retriesOnce: boolean;
  model: string;
  body: Record<string, unknown>;
  snapshot: Snapshot;
  question: string;
  /** What reading it is estimated at, as the preview said; null without prices. */
  approxCost: number | null;
}

interface Round {
  aircraftId: string;
  plan: SuggestionPlan;
}

const modelOf = (s: ProviderSettings): string =>
  s.provider === 'anthropic'
    ? s.model
    : s.provider === 'openai'
      ? s.openai.model
      : s.compatible.model;

const safeName = (id: string): string => id.replace(/[^A-Za-z0-9_.-]/g, '_');

/** The guide's line in the preview of a request: whose guide it is, and what of it is sent. */
const GUIDE_IN_A_REQUEST: Record<GuideKind, string> = {
  shipped: "RigReady's binding guide for this aircraft",
  drafted:
    'The guide drafted by AI for this aircraft: its summary and each item with its title, tier, place and what it does',
  own: 'Your own guide for this aircraft: its summary and each item with its title, tier, place and what it does',
};
const IRACING_GUIDE_IN_A_REQUEST: Record<GuideKind, string> = {
  shipped: "RigReady's binding guide for this class of car",
  drafted:
    'The guide drafted by AI for this car: its summary and each item with its title, tier, place and what it does',
  own: 'Your own guide for this car: its summary and each item with its title, tier, place and what it does',
};

export class AiAssist {
  private readonly settings: JsonStore<typeof SettingsSchema>;
  private readonly progressStore: JsonStore<typeof ProgressFileSchema>;
  /** What this month's answered requests are estimated at, for the monthly budget. */
  private readonly spend: MonthSpend;
  private readonly prepared = new Map<string, PreparedRequest>();
  private readonly rounds = new Map<string, Round>();
  /** Streamed requests on their way, by request id, so they can be cancelled. */
  private readonly inFlight = new Map<string, AbortController>();
  private sequence = 0;

  constructor(private readonly ctx: AiAssistContext) {
    const root = path.join(ctx.ports.folders.dataRoot(), 'ai-assist');
    this.settings = new JsonStore(
      ctx.ports.files,
      path.join(root, 'settings.json'),
      SettingsSchema
    );
    this.progressStore = new JsonStore(
      ctx.ports.files,
      path.join(root, 'progress.json'),
      ProgressFileSchema
    );
    this.spend = new MonthSpend(
      ctx.ports.files,
      path.join(root, 'spend.json'),
      ctx.ports.clock,
      ctx.log
    );
  }

  private next(prefix: string): string {
    this.sequence += 1;
    return `${prefix}${this.sequence}`;
  }

  private reader(): Result<BindingReader> {
    const reader = this.ctx.bindings.get(GAME);
    return reader ? ok(reader) : err('ai.noBindings', 'No DCS bindings feature is available.');
  }

  private draftPath(aircraftId: string): string {
    return path.join(
      this.ctx.ports.folders.dataRoot(),
      'ai-assist',
      'guides',
      `${safeName(aircraftId)}.yaml`
    );
  }

  /**
   * The guide file kept for an aircraft in the data folder, as it reads now: a draft by AI
   * or the user's own. Undefined when there is none; a problem when it cannot be used.
   */
  private async stored(aircraftId: string): Promise<{ pack?: Pack; problem?: string } | undefined> {
    const file = this.draftPath(aircraftId);
    if (!(await this.ctx.ports.files.exists(file))) return undefined;
    const text = await this.ctx.ports.files.readText(file);
    if (!text.ok) return { problem: text.error.message };
    const parsed = parsePack(text.value, path.basename(file));
    return parsed.ok ? { pack: parsed.value } : { problem: guideProblem(parsed.error) };
  }

  /**
   * The shipped guide, or the one kept for an aircraft or an iRacing car: drafted by AI, or the
   * user's own. An iRacing car without one uses the class guide its folder name says, if any.
   */
  async guideFor(aircraftId: string): Promise<
    | {
        pack: Pack;
        kind: 'shipped' | 'drafted' | 'own';
        suggested?: { className: string; token: string };
      }
    | undefined
  > {
    const pack = shippedPack(aircraftId);
    if (pack) return { pack, kind: 'shipped' };
    const stored = await this.stored(aircraftId);
    if (stored && !stored.pack) {
      this.ctx.log.warn(`ai-assist: the guide file for ${aircraftId} cannot be used`);
    }
    if (stored?.pack) return { pack: stored.pack, kind: stored.pack.drafted ? 'drafted' : 'own' };
    if (stored || !isIracingId(aircraftId)) return undefined;
    const carSet = aircraftId.slice(IRACING_PREFIX.length);
    const inName = carSet.startsWith('car:') ? classInName(carSet.slice(4)) : undefined;
    const classPack = inName ? shippedPack(`${IRACING_PREFIX}${inName.classId}`) : undefined;
    return classPack && inName
      ? {
          pack: classPack,
          kind: 'shipped',
          suggested: { className: classPack.aircraft.name, token: inName.token },
        }
      : undefined;
  }

  /** True when a draft by AI would replace a guide file the user wrote or imported. */
  private async ownGuideKept(aircraftId: string): Promise<boolean> {
    if (shippedPack(aircraftId)) return false;
    const stored = await this.stored(aircraftId);
    return stored !== undefined && !stored.pack?.drafted;
  }

  // -------------------------------------------------------------------------
  // A guide of the user's own: imported from a file, or written by hand (no key needed)
  // -------------------------------------------------------------------------

  /** Why a guide file cannot be added for this aircraft, or the aircraft's name when it can. */
  private async roomForGuide(aircraftId: string): Promise<Result<Snapshot>> {
    if (shippedPack(aircraftId)) {
      return err(
        'ai.guideShipped',
        isIracingId(aircraftId)
          ? 'RigReady includes a guide for this class and uses that one. A guide of your own is for one car with controls of its own in iRacing.'
          : 'RigReady includes a guide for this aircraft and uses that one.'
      );
    }
    if (await this.ctx.ports.files.exists(this.draftPath(aircraftId))) {
      return err(
        'ai.guideExists',
        'There is a guide file for this aircraft already. Open it, or delete it first.'
      );
    }
    return this.snapshot(aircraftId);
  }

  /**
   * Takes a guide file the user picks in the Windows file dialog. It is read, checked by the
   * same parser as every guide, and only then copied into RigReady's data folder. The file
   * the user picked is never changed.
   */
  async importGuide(aircraftId: string): Promise<Result<{ imported: boolean; items: number }>> {
    const room = await this.roomForGuide(aircraftId);
    if (!room.ok) return room;
    const { files, dialogs } = this.ctx.ports;
    const picked = await dialogs.open({
      title:
        room.value.game === 'iracing'
          ? `Import a binding guide for ${room.value.aircraftName}`
          : `Import a binding guide for the ${room.value.aircraftName}`,
      filters: [{ name: 'Binding guide', extensions: ['yaml', 'yml'] }],
    });
    if (!picked.ok) return picked;
    const file = picked.value[0];
    if (!file) return ok({ imported: false, items: 0 });
    const entry = await files.stat(file);
    if (!entry.ok) return entry;
    if (!entry.value || entry.value.isDirectory) {
      return err('ai.guideFile', 'That file could not be found.');
    }
    if (entry.value.size > MAX_GUIDE_BYTES) {
      return err(
        'ai.guideSize',
        `That file is larger than a binding guide can be (${MAX_GUIDE_BYTES / 1024} KB).`
      );
    }
    const text = await files.readText(file);
    if (!text.ok) return text;
    const parsed = parsePack(text.value, path.basename(file));
    if (!parsed.ok) return err(parsed.error.code, guideProblem(parsed.error));
    const pack = parsed.value;
    const wanted = aircraftId.toLowerCase();
    const forThis = [pack.aircraft.id, ...(pack.aircraft.also ?? [])].some(
      (id) => guideKey(pack.game, id) === wanted
    );
    if (!forThis) {
      const shown = gameOfKey(aircraftId);
      return err(
        'ai.guideAircraft',
        pack.game !== shown
          ? `That guide is for ${GUIDE_GAME_NAMES[pack.game]}. The guide shown here is for ${GUIDE_GAME_NAMES[shown]}.`
          : shown === 'iracing'
            ? `That guide is for ${pack.aircraft.name} (${pack.aircraft.id}). The car shown here is ${room.value.aircraftName} (${aircraftId.slice(IRACING_PREFIX.length)}).`
            : `That guide is for the ${pack.aircraft.name} (${pack.aircraft.id}). The aircraft shown here is the ${room.value.aircraftName} (${aircraftId}).`
      );
    }
    const written = await files.write(this.draftPath(aircraftId), text.value, {
      reason: 'Binding guide imported from a file',
    });
    if (!written.ok) return written;
    return ok({ imported: true, items: pack.items.length });
  }

  /** Writes a short, valid guide on real actions of the aircraft for the user to edit. */
  async startOwnGuide(aircraftId: string): Promise<Result<{ started: boolean }>> {
    const room = await this.roomForGuide(aircraftId);
    if (!room.ok) return room;
    const s = room.value;
    if (s.actions.length === 0) {
      return err(
        'ai.guideActions',
        s.game === 'iracing'
          ? 'iRacing lists no actions in these bindings yet.'
          : `DCS lists no actions for the ${s.aircraftName} yet.`
      );
    }
    const text =
      s.game === 'iracing'
        ? starterGuide(
            // The car's folder, without the game in front: what an iRacing guide names.
            {
              id: aircraftId.slice(IRACING_PREFIX.length),
              name: s.iracing?.setName ?? s.aircraftName,
            },
            s.actions,
            'iracing'
          )
        : starterGuide({ id: aircraftId, name: s.aircraftName }, s.actions);
    const checked = parsePack(text, 'The starter guide');
    if (!checked.ok) return err(checked.error.code, guideProblem(checked.error));
    const written = await this.ctx.ports.files.write(this.draftPath(aircraftId), text, {
      reason: 'Binding guide started by hand',
    });
    return written.ok ? ok({ started: true }) : written;
  }

  /** Opens the guide file kept for an aircraft in Notepad. No other file can be named. */
  async openGuideFile(aircraftId: string): Promise<Result<{ opened: boolean }>> {
    const file = this.draftPath(aircraftId);
    if (!(await this.ctx.ports.files.exists(file))) {
      return err('ai.guideFile', 'There is no guide file for this aircraft.');
    }
    const notepad = path.join(this.ctx.ports.folders.windows(), 'notepad.exe');
    const started = await this.ctx.ports.shell.launch(notepad, [file]);
    return started.ok ? ok({ opened: true }) : started;
  }

  /** The games the guide has guides for, and whether each is found here, for the page's picker. */
  async games(): Promise<Result<GuideGames>> {
    const games = await Promise.all(
      GUIDE_GAMES.map(async (id) => ({
        id,
        name: GUIDE_GAME_NAMES[id],
        available: id === 'dcs' ? await this.dcsAvailable() : await this.iracingAvailable(),
      }))
    );
    return ok({ games });
  }

  private async dcsAvailable(): Promise<boolean> {
    const reader = this.ctx.bindings.get(GAME);
    return reader !== undefined && (await reader.available());
  }

  /** iRacing counts as found when its program is: the page then says what is missing, if anything. */
  private async iracingAvailable(): Promise<boolean> {
    const overview = await this.ctx.iracing?.overview();
    return overview?.ok === true && overview.value.installed;
  }

  async aircraft(game: GuideGame = 'dcs'): Promise<Result<AircraftList>> {
    if (game === 'iracing') return this.iracingList();
    const reader = this.ctx.bindings.get(GAME);
    if (!reader || !(await reader.available())) {
      return ok({
        game,
        available: false,
        gameName: reader?.gameName ?? 'DCS World',
        aircraft: [],
      });
    }
    const list = await reader.aircraft();
    if (!list.ok) return list;
    const aircraft = await Promise.all(
      list.value.map(async (a) => ({ ...a, guide: (await this.guideFor(a.id))?.kind ?? null }))
    );
    // Aircraft with a guide first, then the ones with bindings of the user's own.
    aircraft.sort(
      (a, b) =>
        Number(b.guide !== null) - Number(a.guide !== null) ||
        Number(b.hasUserBindings) - Number(a.hasUserBindings)
    );
    return ok({ game, available: true, gameName: reader.gameName, aircraft });
  }

  /** The iRacing classes RigReady has a guide for, then each car with controls of its own. */
  private async iracingEntries(): Promise<
    Result<{ entries: IracingEntry[]; installed: boolean; overview?: IracingOverview }>
  > {
    const source = this.ctx.iracing;
    if (!source) return ok({ entries: [], installed: false });
    const overview = await source.overview();
    if (!overview.ok) return overview;
    const classes = classGuides(shipped().values()).map((p) => ({
      id: p.aircraft.id,
      name: p.aircraft.name,
    }));
    return ok({
      entries: overview.value.installed ? iracingEntries(overview.value, classes) : [],
      installed: overview.value.installed,
      overview: overview.value,
    });
  }

  private async iracingList(): Promise<Result<AircraftList>> {
    const found = await this.iracingEntries();
    if (!found.ok) return found;
    // The classes work on the bindings for all cars: without them there is nothing to show yet.
    const overview = found.value.overview;
    if (found.value.installed && overview && !overview.sets.some((s) => s.general)) {
      return ok({
        game: 'iracing',
        available: true,
        gameName: 'iRacing',
        aircraft: [],
        problem:
          overview.source?.problem ??
          'iRacing has no bindings file yet. Set up your controls in iRacing once, and the guide fills in.',
      });
    }
    const aircraft = await Promise.all(
      found.value.entries.map(async (entry) => {
        const guide = await this.guideFor(entry.id);
        return {
          id: entry.id,
          name: entry.name,
          hasUserBindings: true,
          guide: guide?.kind ?? null,
          ...(guide?.suggested ? { uses: guide.suggested.className } : {}),
        };
      })
    );
    return ok({ game: 'iracing', available: found.value.installed, gameName: 'iRacing', aircraft });
  }

  private async snapshot(aircraftId: string): Promise<Result<Snapshot>> {
    if (isIracingId(aircraftId)) return this.iracingSnapshot(aircraftId);
    const reader = this.reader();
    if (!reader.ok) return reader;
    const found = await this.guideFor(aircraftId);
    const taken = await takeSnapshot(reader.value, aircraftId, found?.pack);
    return taken.ok && found ? ok({ ...taken.value, guideKind: found.kind }) : taken;
  }

  /**
   * An iRacing class or car with the bindings it is about: "All cars" for a class, the car's
   * own set for a car. Read through the iRacing bindings feature, fresh every time.
   */
  private async iracingSnapshot(aircraftId: string): Promise<Result<Snapshot>> {
    const source = this.ctx.iracing;
    if (!source) return err('ai.noIracing', 'RigReady cannot read iRacing bindings here.');
    const listed = await this.iracingEntries();
    if (!listed.ok) return listed;
    const wanted = aircraftId.toLowerCase();
    const entry = listed.value.entries.find((e) => e.id.toLowerCase() === wanted);
    if (!entry) {
      return err(
        'ai.iracingEntry',
        listed.value.installed
          ? 'The binding guide has no such class, and iRacing has no car with controls of its own by that name.'
          : 'iRacing was not found on this PC.'
      );
    }
    const overview = listed.value.overview!;
    const view = await source.set(entry.set);
    if (!view.ok) return view;
    const found = await this.guideFor(entry.id);
    const parts = iracingParts(entry, view.value);
    return ok({
      game: 'iracing',
      aircraftId: entry.id,
      aircraftName: entry.name,
      ...parts,
      ...(found ? { pack: found.pack, guideKind: found.kind } : {}),
      iracing: {
        set: entry.set,
        setName: view.value.set.name,
        ...(view.value.set.profile ? { profile: view.value.set.profile } : {}),
        simRunning: overview.simRunning,
        notes: view.value.notes,
        axisActions: view.value.actions.filter((a) => a.accepts.includes('axis')).map((a) => a.id),
      },
    });
  }

  // -------------------------------------------------------------------------
  // The guide and the walkthrough (no key needed)
  // -------------------------------------------------------------------------

  private async progressOf(aircraftId: string): Promise<Result<Progress>> {
    const file = await this.progressStore.read();
    if (!file.ok) return file;
    return ok(file.value.aircraft[aircraftId] ?? ProgressSchema.parse({}));
  }

  private async saveProgress(
    aircraftId: string,
    change: (p: Progress) => Progress
  ): Promise<Result<Progress>> {
    let saved: Progress | undefined;
    const written = await this.progressStore.update((file) => {
      saved = change(file.aircraft[aircraftId] ?? ProgressSchema.parse({}));
      return { aircraft: { ...file.aircraft, [aircraftId]: saved } };
    });
    return written.ok ? ok(saved!) : written;
  }

  private stagedView(staged: Staged[], snapshot: Snapshot): StagedView[] {
    const views = staged.map((s) => ({
      ...s,
      replaces: [] as string[],
      clashesWith: [] as string[],
      already: false,
      selected: true,
    }));
    markConflicts(views, snapshot);
    return views.map(({ selected: _selected, ...view }) => view);
  }

  async guide(aircraftId: string): Promise<Result<GuideView>> {
    const snapshot = await this.snapshot(aircraftId);
    if (!snapshot.ok) return snapshot;
    const found = await this.guideFor(aircraftId);
    const kept = found?.kind === 'shipped' ? undefined : await this.stored(aircraftId);
    const progress = await this.progressOf(aircraftId);
    if (!progress.ok) return progress;
    const s = snapshot.value;
    const game = s.game;
    const items = found ? resolvePack(found.pack, s.actions, s.bindings) : [];
    const { staged, ...rest } = progress.value;
    return ok({
      game,
      aircraftId,
      aircraftName: s.aircraftName,
      guide: found
        ? {
            kind: found.kind,
            summary: found.pack.summary,
            sources: found.pack.sources,
            ...(found.pack.drafted ? { drafted: found.pack.drafted } : {}),
            ...(found.suggested ? { suggested: found.suggested } : {}),
            roles: GAME_ROLES[found.pack.game].flatMap((role) => {
              const plan = found.pack.roles[role];
              return plan
                ? [{ role, title: roleTitle(game, role), summary: plan.summary, items: plan.items }]
                : [];
            }),
          }
        : null,
      stored: kept ? (kept.problem ? { problem: kept.problem } : {}) : null,
      tiers: TIERS.map((tier) => ({
        tier,
        title: tierTitle(game, tier),
        items: items
          .filter((r) => r.item.tier === tier)
          .map((r) => ({
            id: r.item.id,
            title: r.item.title,
            tier: r.item.tier,
            place: r.item.place,
            placeTitle: placeTitle(game, r.item.place),
            role: r.item.role,
            roleTitle: roleTitle(game, r.item.role),
            need: r.item.need,
            what: r.item.what,
            when: r.item.when,
            ...(r.item.note ? { note: r.item.note } : {}),
            status: r.status,
            actions: r.actions.map((a) => ({
              actionId: a.actionId,
              label: a.label,
              dcsName: a.dcsName,
              kind: a.kind,
              editable: a.editable,
              bound: a.bound.map((b) => ({
                text: `${b.device} · ${[...b.modifiers, b.inputLabel].join(' + ')}`,
                keyboard: b.keyboard,
                ignored: b.ignored === true,
                source: b.source,
              })),
            })),
          })),
      })),
      progress: rest,
      staged: this.stagedView(staged, s),
      controllers: s.controllers.map((c) => ({
        name: c.givenName ?? c.name,
        role: c.role,
        guid: c.guid,
      })),
      ...(s.iracing
        ? {
            iracing: {
              set: s.iracing.set,
              setName: s.iracing.setName,
              ...(s.iracing.profile ? { profile: s.iracing.profile } : {}),
              simRunning: s.iracing.simRunning,
              notes: s.iracing.notes,
            },
          }
        : {}),
    });
  }

  async setProgress(
    aircraftId: string,
    itemId: string,
    state: 'done' | 'skipped' | 'open',
    current?: string
  ): Promise<Result<Progress>> {
    return this.saveProgress(aircraftId, (p) => {
      const done = p.done.filter((id) => id !== itemId);
      const skipped = p.skipped.filter((id) => id !== itemId);
      if (state === 'done') done.push(itemId);
      if (state === 'skipped') skipped.push(itemId);
      return { ...p, done, skipped, ...(current ? { current } : {}) };
    });
  }

  async setCurrent(aircraftId: string, itemId: string): Promise<Result<Progress>> {
    return this.saveProgress(aircraftId, (p) => ({ ...p, current: itemId }));
  }

  async resetProgress(aircraftId: string): Promise<Result<Progress>> {
    return this.saveProgress(aircraftId, (p) => ({ done: [], skipped: [], staged: p.staged }));
  }

  /** Stages "bind this action to the control just pressed". Nothing is written. */
  async stage(
    aircraftId: string,
    change: { actionId: string; deviceGuid: string; input: string }
  ): Promise<Result<GuideView>> {
    if (isIracingId(aircraftId)) {
      return err(
        'ai.iracingStage',
        'In iRacing the guide binds one action at a time: press the control, look at the change, then save it.'
      );
    }
    const snapshot = await this.snapshot(aircraftId);
    if (!snapshot.ok) return snapshot;
    const s = snapshot.value;
    const action = s.actions.find((a) => a.id === change.actionId);
    if (!action) return err('ai.action', `${s.aircraftName} has no such action.`);
    if (!action.editable) {
      return err(
        'ai.notWritable',
        `RigReady cannot write "${action.name}" yet. Bind it once in DCS's own controls screen.`
      );
    }
    const controller = s.controllers.find((c) => c.guid === change.deviceGuid.toUpperCase());
    if (!controller) {
      return err(
        'ai.device',
        'That controller is not one DCS uses for this aircraft (or it is marked "not used in DCS").'
      );
    }
    const info = describeInput(change.input);
    if (!info || !hasInput(controller.controls, change.input)) {
      return err('ai.input', `${controller.name} has no such control.`);
    }
    if (!fits(action.kind, change.input)) {
      return err(
        'ai.kind',
        action.kind === 'axis'
          ? `"${action.name}" needs an axis: move a lever, slider or stick instead.`
          : `"${action.name}" needs a button or hat, not an axis.`
      );
    }
    const found = await this.guideFor(aircraftId);
    const label = found
      ? found.pack.items
          .flatMap((item) => matchActions(item, s.actions))
          .find((m) => m.action.id === action.id)?.label
      : undefined;
    const staged: Staged = {
      id: this.next('g'),
      actionId: action.id,
      label: label ?? action.name,
      dcsName: action.name,
      deviceGuid: controller.guid,
      deviceName: controller.givenName ?? controller.name,
      input: change.input,
      inputLabel: info.label,
    };
    const saved = await this.saveProgress(aircraftId, (p) => ({
      ...p,
      staged: [...p.staged.filter((x) => x.actionId !== action.id), staged],
    }));
    if (!saved.ok) return saved;
    return this.guide(aircraftId);
  }

  async unstage(aircraftId: string, id?: string): Promise<Result<GuideView>> {
    const saved = await this.saveProgress(aircraftId, (p) => ({
      ...p,
      staged: id ? p.staged.filter((s) => s.id !== id) : [],
    }));
    if (!saved.ok) return saved;
    return this.guide(aircraftId);
  }

  private async proposalFromStaged(aircraftId: string): Promise<Result<BindingProposal>> {
    const progress = await this.progressOf(aircraftId);
    if (!progress.ok) return progress;
    const staged = progress.value.staged;
    if (staged.length === 0) return err('ai.nothing', 'Nothing is staged.');
    const snapshot = await this.snapshot(aircraftId);
    if (!snapshot.ok) return snapshot;
    const views = this.stagedView(staged, snapshot.value);
    const clash = views.find((v) => v.clashesWith.length > 0);
    if (clash) {
      return err(
        'ai.clash',
        `Two staged changes use ${clash.inputLabel} on ${clash.deviceName}. Remove one of them first.`
      );
    }
    return ok({
      aircraftId,
      summary: `Bind ${staged.length} ${staged.length === 1 ? 'action' : 'actions'} from the binding guide (${snapshot.value.aircraftName})`,
      changes: staged.map((s) => ({
        op: 'bind',
        deviceGuid: s.deviceGuid,
        input: s.input,
        actionId: s.actionId,
      })),
    });
  }

  private proposals(): Result<NonNullable<BindingReader['proposals']>> {
    const reader = this.reader();
    if (!reader.ok) return reader;
    const proposals = reader.value.proposals;
    return proposals
      ? ok(proposals)
      : err('ai.unsupported', 'The bindings feature cannot take proposed changes.');
  }

  /** Exactly what the staged changes would write; nothing is written. */
  async reviewStaged(aircraftId: string): Promise<Result<PlanView>> {
    const proposal = await this.proposalFromStaged(aircraftId);
    if (!proposal.ok) return proposal;
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    return proposals.value.plan(proposal.value);
  }

  /** Writes the staged changes through the bindings feature (backup first, one undoable change). */
  async applyStaged(aircraftId: string): Promise<Result<AppliedView>> {
    const proposal = await this.proposalFromStaged(aircraftId);
    if (!proposal.ok) return proposal;
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    const applied = await proposals.value.apply(proposal.value);
    if (!applied.ok) return applied;
    const cleared = await this.saveProgress(aircraftId, (p) => ({ ...p, staged: [] }));
    if (!cleared.ok) return cleared;
    return applied;
  }

  async undo(groupId: string): Promise<Result<{ undone: boolean }>> {
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    const undone = await proposals.value.undo(groupId);
    return undone.ok ? ok({ undone: true }) : undone;
  }

  // -------------------------------------------------------------------------
  // iRacing: one button or key at a time, through the iRacing bindings feature
  // -------------------------------------------------------------------------

  /**
   * The set and the guide's label for an action the guide offers to bind here. Only an action
   * of the guide shown, and only one RigReady may write: an axis or a hat is bound in iRacing.
   */
  private async iracingTarget(
    aircraftId: string,
    actionId: string
  ): Promise<Result<{ source: IracingBindings; set: string; label: string }>> {
    const source = this.ctx.iracing;
    if (!isIracingId(aircraftId) || !source) {
      return err('ai.iracingOnly', 'This binds iRacing actions only.');
    }
    const snapshot = await this.iracingSnapshot(aircraftId);
    if (!snapshot.ok) return snapshot;
    const s = snapshot.value;
    const action = s.pack
      ? resolvePack(s.pack, s.actions, s.bindings)
          .flatMap((i) => i.actions)
          .find((a) => a.actionId === actionId)
      : undefined;
    if (!action) return err('ai.iracingAction', 'That action is not in the guide shown here.');
    if (!action.editable) {
      return err(
        'ai.iracingInGame',
        `${action.label} belongs on an axis. Bind it in iRacing: Options, then Controls.`
      );
    }
    if (!s.iracing) return err('ai.iracingOnly', 'This binds iRacing actions only.');
    return ok({ source, set: s.iracing.set, label: action.label });
  }

  /** What binding one action of the guide to this button or key would change. Writes nothing. */
  async iracingPreview(
    aircraftId: string,
    actionId: string,
    binding: IracingWanted
  ): Promise<Result<IracingReviewView>> {
    const target = await this.iracingTarget(aircraftId, actionId);
    if (!target.ok) return target;
    const { source, set, label } = target.value;
    const review = await source.changePreview({ set, action: actionId, binding });
    if (!review.ok) return review;
    const labels = await this.iracingLabels(set);
    const r = review.value;
    return ok({
      actionId,
      label,
      forCars: forCars(r.set),
      before: r.before,
      after: r.after,
      same: r.same,
      conflicts: r.conflicts.map((c) => ({ ...c, name: labels[c.id] ?? c.name })),
      ...(r.blocked ? { blocked: r.blocked } : {}),
      preview: r.preview,
      seen: r.seen,
    });
  }

  /**
   * Writes it, through the iRacing bindings feature: a backup first and Undo on the Safety
   * page. `seen` is the file as the preview read it; a file that changed since is refused.
   */
  async iracingBind(
    aircraftId: string,
    actionId: string,
    binding: IracingWanted,
    seen: string
  ): Promise<Result<{ changed: boolean; message: string }>> {
    const target = await this.iracingTarget(aircraftId, actionId);
    if (!target.ok) return target;
    const { source, set } = target.value;
    const changed = await source.change({ set, action: actionId, binding, seen });
    if (!changed.ok) return changed;
    this.ctx.log.info(
      `ai-assist: iRacing ${actionId} ${changed.value.changed ? 'bound' : 'left as it was'} from the guide`
    );
    return ok({ changed: changed.value.changed, message: changed.value.message });
  }

  /**
   * Plain labels of iRacing's actions by its own id, for the pages that list them: a car's own
   * guide first, then the class guides. The shipped guides use one label per action, so the
   * class shown does not change a name.
   */
  async iracingLabels(setId: string): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};
    const add = (pack: Pack | undefined): void => {
      for (const [name, label] of Object.entries(plainLabels(pack))) labels[name] ??= label;
    };
    if (setId.startsWith('car:')) add((await this.guideFor(`${IRACING_PREFIX}${setId}`))?.pack);
    for (const pack of classGuides(shipped().values())) add(pack);
    return labels;
  }

  // -------------------------------------------------------------------------
  // The key and the model
  // -------------------------------------------------------------------------

  /** The provider the settings describe, or why it cannot be used yet. */
  private async provider(): Promise<Result<ChatProvider>> {
    const settings = await this.settings.read();
    if (!settings.ok) return settings;
    return providerFor(settings.value);
  }

  /**
   * The stored key for a provider, if any. The OpenAI-compatible key is used only with the
   * host it was stored for, so a changed address never receives it.
   */
  private async storedKey(id: ProviderId, host: string): Promise<Result<string | undefined>> {
    const stored = await this.ctx.ports.secrets.get(KEY_SECRETS[id]);
    if (!stored.ok) return stored;
    if (!stored.value) return ok(undefined);
    if (id !== 'compatible') return ok(stored.value);
    let parsed: z.infer<typeof CompatibleKeySchema> | undefined;
    try {
      const value = CompatibleKeySchema.safeParse(JSON.parse(stored.value));
      parsed = value.success ? value.data : undefined;
    } catch {
      // Not what this version stores: treated as no key.
      parsed = undefined;
    }
    return ok(parsed && host !== '' && parsed.origin === host ? parsed.key : undefined);
  }

  /** The key a request to this provider carries: required unless the server is on this PC. */
  private async keyFor(provider: ChatProvider): Promise<Result<string | undefined>> {
    const key = await this.storedKey(provider.id, provider.host);
    if (!key.ok) return key;
    if (!key.value && provider.keyNeeded) {
      return err(
        'ai.noKey',
        `No ${provider.id === 'compatible' ? provider.host : provider.label} API key is stored. Add one in Settings.`
      );
    }
    return key;
  }

  /**
   * Who answers the built-in assistant: the provider chosen in Settings, the key its requests
   * carry (never shown or logged), and where its API lives. The same provider and key the
   * binding guide uses; nothing about them is changed here.
   */
  async assistantTarget(): Promise<
    Result<{ provider: ChatProvider; key: string | undefined; root: string }>
  > {
    const settings = await this.settings.read();
    if (!settings.ok) return settings;
    const provider = providerFor(settings.value);
    if (!provider.ok) return provider;
    const key = await this.keyFor(provider.value);
    if (!key.ok) return key;
    const s = settings.value;
    const root =
      s.provider === 'anthropic'
        ? ok(API_ROOT)
        : s.provider === 'openai'
          ? ok(OPENAI_ROOT)
          : checkBaseUrl(s.compatible.baseUrl);
    if (!root.ok) return root;
    return ok({ provider: provider.value, key: key.value, root: root.value });
  }

  async status(): Promise<Result<AiStatus>> {
    const settings = await this.settings.read();
    if (!settings.ok) return settings;
    const s = settings.value;
    const provider = providerFor(s);
    const host = provider.ok ? provider.value.host : '';
    const key = await this.storedKey(s.provider, host);
    const present = key.ok && key.value !== undefined && key.value !== '';
    const keyNeeded = provider.ok ? provider.value.keyNeeded : s.provider !== 'compatible';
    const problem = !provider.ok
      ? provider.error.message
      : keyNeeded && !present
        ? 'No key yet: store one below to turn AI help on.'
        : undefined;
    return ok({
      provider: s.provider,
      providers: PROVIDER_IDS.map((id) => ({ id, name: PROVIDER_NAMES[id] })),
      presets: PRESETS,
      keyPresent: present,
      ...(present ? { keyHint: `…${key.value!.slice(-4)}` } : {}),
      keyNeeded,
      ready: problem === undefined,
      ...(problem ? { problem } : {}),
      model: modelOf(s),
      models: suggestedModels(s.provider),
      baseUrl: s.compatible.baseUrl,
      structured: s.provider === 'compatible' ? s.compatible.structured : 'schema',
      host,
      local: provider.ok && provider.value.local,
      whatIsSent: whatIsSent(provider.ok ? provider.value : undefined),
      questionCeiling: s.questionCeiling,
      // A limit in dollars needs prices: without them only the count of tool rounds stops a question.
      priceKnown: provider.ok && provider.value.prices !== null,
      prices: provider.ok ? provider.value.prices : null,
      builtInPrices: provider.ok ? provider.value.builtIn : null,
      pricesRecorded: PRICES_RECORDED,
      month: await this.spend.view(s.monthlyBudget),
      acknowledged: s.acknowledged,
    });
  }

  /** Dollars one question to the assistant may reach by the estimate before it stops and asks; 0 for no ceiling. */
  async questionCeiling(): Promise<number> {
    const settings = await this.settings.read();
    return settings.ok ? settings.value.questionCeiling : DEFAULT_QUESTION_CEILING;
  }

  /**
   * Sets a limit that is counted from estimates. Turning one on (an amount where there was
   * none, or the first amount the user sets at all) needs `acknowledged`: the user's own yes
   * to what the limit is, which is kept with its time. It is checked here, not only in the
   * page, so no caller can turn a limit on without it.
   */
  private async setLimit(
    limit: Limit,
    dollars: number,
    acknowledged: boolean
  ): Promise<Result<AiStatus>> {
    const { most, off } = LIMITS[limit];
    if (!Number.isFinite(dollars) || dollars < 0 || dollars > most) {
      return err('ai.amount', `Type an amount between 0 and ${most} dollars. ${off}`);
    }
    // Whole cents: what the page shows is what is kept.
    const amount = Math.round(dollars * 100) / 100;
    const current = await this.settings.read();
    if (!current.ok) return current;
    const turnsOn =
      amount > 0 && (current.value[limit] === 0 || current.value.acknowledged[limit] === undefined);
    if (turnsOn && !acknowledged) {
      return err(
        'ai.acknowledge',
        'Nothing was changed: this limit is counted from estimates, and turning it on needs your acknowledgement of that.'
      );
    }
    const at = this.ctx.ports.clock.now().toISOString();
    const saved = await this.settings.update((s) => ({
      ...s,
      [limit]: amount,
      acknowledged: turnsOn ? { ...s.acknowledged, [limit]: at } : s.acknowledged,
    }));
    if (!saved.ok) return saved;
    if (turnsOn) this.ctx.log.info(`ai-assist: ${limit} turned on, acknowledged as an estimate`);
    return this.status();
  }

  setQuestionCeiling(dollars: number, acknowledged = false): Promise<Result<AiStatus>> {
    return this.setLimit('questionCeiling', dollars, acknowledged);
  }

  setMonthlyBudget(dollars: number, acknowledged = false): Promise<Result<AiStatus>> {
    return this.setLimit('monthlyBudget', dollars, acknowledged);
  }

  /**
   * This month against the monthly budget, as it would stand with a request estimated at
   * `next` dollars counted in.
   */
  async monthBudget(next = 0): Promise<MonthBudget> {
    const settings = await this.settings.read();
    return this.spend.view(settings.ok ? settings.value.monthlyBudget : 0, next);
  }

  /**
   * Counts an answered request in the month's estimate, at the provider's prices as they
   * were when it was sent. A server on this PC that the user gave no prices is not counted:
   * it charges nothing.
   */
  async countRequest(provider: ChatProvider, usage: Usage): Promise<void> {
    if (provider.local && provider.prices === null) return;
    await this.spend.record(provider.cost(usage));
    this.ctx.onCounted?.(await this.monthBudget());
  }

  /**
   * The user's own prices for the model chosen now, in US dollars per million tokens. From
   * then on every estimate for that model uses them, and says so.
   */
  async setPrices(price: Price): Promise<Result<AiStatus>> {
    const values = [price.input, price.output, price.cacheRead, price.cacheWrite];
    if (values.some((v) => !Number.isFinite(v) || v < 0 || v > MAX_PRICE)) {
      return err(
        'ai.price',
        `Type each price as dollars per million tokens, between 0 and ${MAX_PRICE}.`
      );
    }
    const provider = await this.provider();
    if (!provider.ok) return provider;
    const key = provider.value.priceKey;
    // Millionths of a dollar: more than any price list gives, and no stray digits.
    const kept = (v: number): number => Math.round(v * 1_000_000) / 1_000_000;
    const own: Price = {
      input: kept(price.input),
      output: kept(price.output),
      cacheRead: kept(price.cacheRead),
      cacheWrite: kept(price.cacheWrite),
    };
    const saved = await this.settings.update((s) => ({
      ...s,
      prices: { ...s.prices, [key]: own },
    }));
    if (!saved.ok) return saved;
    this.ctx.log.info(`ai-assist: the user set their own prices for ${key}`);
    return this.status();
  }

  /** Forgets the user's own prices for the model chosen now: the built-in ones, or none, again. */
  async resetPrices(): Promise<Result<AiStatus>> {
    const provider = await this.provider();
    if (!provider.ok) return provider;
    const key = provider.value.priceKey;
    const saved = await this.settings.update((s) => {
      const { [key]: _gone, ...prices } = s.prices;
      return { ...s, prices };
    });
    if (!saved.ok) return saved;
    this.ctx.log.info(`ai-assist: the user's own prices for ${key} were removed`);
    return this.status();
  }

  async setProvider(provider: ProviderId): Promise<Result<AiStatus>> {
    const saved = await this.settings.update((s) => ({ ...s, provider }));
    if (!saved.ok) return saved;
    this.ctx.log.info(`ai-assist: provider set to ${provider}`);
    return this.status();
  }

  /** Any model id may be typed; the provider says when it is used whether it has it. */
  async setModel(model: string): Promise<Result<AiStatus>> {
    const id = model.trim();
    if (!MODEL_ID.test(id)) {
      return err(
        'ai.model',
        'That is not a model id. Model ids look like claude-opus-5-5, gpt-6.1-terra or qwen3:8b.'
      );
    }
    const saved = await this.settings.update((s) =>
      s.provider === 'anthropic'
        ? { ...s, model: id }
        : s.provider === 'openai'
          ? { ...s, openai: { model: id } }
          : { ...s, compatible: { ...s.compatible, model: id } }
    );
    if (!saved.ok) return saved;
    return this.status();
  }

  /**
   * The OpenAI-compatible provider: a preset (which fills the address, a model and the
   * answer format), or the address or the format alone. A key stored for one host is
   * removed when the address moves to another.
   */
  async setCompatible(change: {
    preset?: string | undefined;
    baseUrl?: string | undefined;
    structured?: Structured | undefined;
  }): Promise<Result<AiStatus>> {
    const settings = await this.settings.read();
    if (!settings.ok) return settings;
    const next = { ...settings.value.compatible };
    if (change.preset !== undefined) {
      const preset = PRESETS.find((p) => p.id === change.preset);
      if (!preset) return err('ai.preset', 'Unknown service.');
      next.baseUrl = preset.baseUrl;
      next.model = preset.model;
      next.structured = preset.structured;
    }
    if (change.baseUrl !== undefined) {
      const checked = checkBaseUrl(change.baseUrl);
      if (!checked.ok) return checked;
      next.baseUrl = checked.value;
    }
    if (change.structured !== undefined) next.structured = change.structured;
    const hostOf = (url: string): string => (url ? new URL(url).host : '');
    if (hostOf(settings.value.compatible.baseUrl) !== hostOf(next.baseUrl)) {
      const removed = await this.ctx.ports.secrets.remove(KEY_SECRETS.compatible);
      if (!removed.ok) return removed;
    }
    const saved = await this.settings.update((s) => ({
      ...s,
      provider: 'compatible' as const,
      compatible: next,
    }));
    if (!saved.ok) return saved;
    return this.status();
  }

  /** Stores the key for the chosen provider, encrypted. It is never sent back. */
  async setKey(key: string): Promise<Result<AiStatus>> {
    const value = key.trim();
    if (value.length < 8 || value.length > 400 || /\s/.test(value)) {
      return err('ai.keyFormat', 'That does not look like an API key. Paste the whole key.');
    }
    const settings = await this.settings.read();
    if (!settings.ok) return settings;
    const id = settings.value.provider;
    let stored = value;
    if (id === 'compatible') {
      const provider = providerFor(settings.value);
      if (!provider.ok) {
        return err(
          'ai.baseUrl',
          'Choose a service or type the address first: the key is kept for that address only.'
        );
      }
      stored = JSON.stringify({ origin: provider.value.host, key: value });
    }
    const written = await this.ctx.ports.secrets.set(KEY_SECRETS[id], stored);
    if (!written.ok) return written;
    // Read it back: "stored" is only said when the key really can be used.
    const check = await this.ctx.ports.secrets.get(KEY_SECRETS[id]);
    if (!check.ok) return check;
    if (check.value !== stored) return err('secret.write', 'The key could not be stored.');
    if (id === 'anthropic' && this.ctx.settings) {
      const flagged = await this.ctx.settings.update({ aiKeyPresent: true });
      if (!flagged.ok) return flagged;
    }
    this.ctx.log.info(`ai-assist: ${id} key stored`);
    return this.status();
  }

  async clearKey(): Promise<Result<AiStatus>> {
    const settings = await this.settings.read();
    if (!settings.ok) return settings;
    const id = settings.value.provider;
    const removed = await this.ctx.ports.secrets.remove(KEY_SECRETS[id]);
    if (!removed.ok) return removed;
    if (id === 'anthropic' && this.ctx.settings) {
      const flagged = await this.ctx.settings.update({ aiKeyPresent: false });
      if (!flagged.ok) return flagged;
    }
    this.ctx.log.info(`ai-assist: ${id} key removed`);
    return this.status();
  }

  async testKey(): Promise<Result<{ valid: boolean; message: string }>> {
    const provider = await this.provider();
    if (!provider.ok) return provider;
    const key = await this.keyFor(provider.value);
    if (!key.ok) return key;
    const checked = await provider.value.test(this.ctx.ports.http, key.value);
    if (!checked.ok) return checked;
    this.ctx.log.info(
      `ai-assist: ${provider.value.id} test ${checked.value.valid ? 'passed' : 'failed'}`
    );
    if (!checked.value.valid) return ok({ valid: false, message: checked.value.reason });
    const model = knownModel(checked.value.model)?.name ?? checked.value.model;
    return ok({
      valid: true,
      message:
        provider.value.id === 'compatible'
          ? `${provider.value.host} answered, using ${model}.`
          : `The key works with ${model}.`,
    });
  }

  // -------------------------------------------------------------------------
  // Requests: prepared (shown to the user exactly), then sent
  // -------------------------------------------------------------------------

  async prepare(input: {
    kind: RequestKind;
    aircraftId: string;
    question?: string;
    actionId?: string;
  }): Promise<Result<Prepared>> {
    const provider = await this.provider();
    if (!provider.ok) return provider;
    const key = await this.keyFor(provider.value);
    if (!key.ok) return key;
    const snapshot = await this.snapshot(input.aircraftId);
    if (!snapshot.ok) return snapshot;
    const s = snapshot.value;
    const model = provider.value.model;
    let task: string;
    let schema: Record<string, unknown> | undefined;
    let question = '';
    if (input.kind === 'suggest' && s.game === 'iracing') {
      return err(
        'ai.iracingSuggest',
        'Suggest a setup is for DCS aircraft. For iRacing, the walkthrough binds with you, one control at a time.'
      );
    }
    if (input.kind === 'suggest') {
      if (s.controllers.length === 0) {
        return err(
          'ai.noControllers',
          'No controller that DCS uses for this aircraft is connected.'
        );
      }
      task = suggestionTask(s);
      schema = suggestionSchema(s.controllers.map((c) => c.ref));
    } else if (input.kind === 'draft') {
      if (await this.ownGuideKept(input.aircraftId)) {
        return err(
          'ai.guideExists',
          s.game === 'iracing'
            ? 'This car has a guide file of your own, and a draft would replace it. Delete it on the Binding guide page first.'
            : 'This aircraft has a guide file of your own, and a draft would replace it. Delete it on the Binding guide page first.'
        );
      }
      if (s.game === 'iracing' && shippedPack(input.aircraftId)) {
        return err(
          'ai.guideShipped',
          'RigReady includes a guide for this class and uses that one.'
        );
      }
      task = draftTask(s);
      schema = draftSchema(s.game);
    } else if (input.kind === 'explain') {
      const action = s.actions.find((a) => a.id === input.actionId);
      if (!action) {
        return err(
          'ai.action',
          s.game === 'iracing'
            ? 'iRacing has no such action.'
            : `${s.aircraftName} has no such action.`
        );
      }
      question = `What does "${action.name}" do?`;
      task = questionTask(s, question, action.id);
    } else {
      question = (input.question ?? '').trim();
      if (question.length === 0) return err('ai.question', 'Type a question first.');
      if (question.length > MAX_QUESTION) {
        return err('ai.question', `Keep the question under ${MAX_QUESTION} characters.`);
      }
      task = questionTask(s, question);
    }
    const body = provider.value.body({
      model,
      system: systemPrompt(s),
      context: contextText(s),
      task,
      ...(schema ? { schema } : {}),
      maxTokens: MAX_TOKENS[input.kind],
      ...(STREAMED.has(input.kind) ? { stream: true } : {}),
    });
    const retriesOnce = schema !== undefined && provider.value.structured === 'prompt';
    const text = JSON.stringify(body);
    const tokens = approximateTokens(text);
    const approxCost = provider.value.inputCost(tokens);
    // The monthly budget holds a request back before it is shown as ready to send.
    const month = approxCost === null ? null : await this.monthBudget(approxCost);
    if (month?.state === 'stopped') return err('ai.budget', budgetStopMessage(month));
    const requestId = this.next('r');
    this.prepared.set(requestId, {
      kind: input.kind,
      aircraftId: input.aircraftId,
      provider: provider.value,
      retriesOnce,
      model,
      body,
      snapshot: s,
      question,
      approxCost,
    });
    return ok({
      requestId,
      kind: input.kind,
      model,
      body: JSON.stringify(body, null, 2),
      chars: text.length,
      approxTokens: tokens,
      approxCost,
      prices: approxCost === null ? null : (provider.value.prices?.source ?? null),
      month,
      provider: provider.value.label,
      host: provider.value.host,
      local: provider.value.local,
      retriesOnce,
      contents: [
        s.game === 'iracing'
          ? `${s.actions.length} iRacing actions, with what each is bound to now in the bindings for ${s.iracing?.setName ?? 'All cars'}`
          : `${s.actions.length} actions of the ${s.aircraftName}, with what each is bound to now`,
        `${s.controllers.length} ${s.controllers.length === 1 ? 'controller' : 'controllers'}: ${s.controllers.map((c) => c.name).join(', ') || 'none'}`,
        s.pack
          ? s.game === 'iracing'
            ? IRACING_GUIDE_IN_A_REQUEST[s.guideKind ?? 'shipped']
            : GUIDE_IN_A_REQUEST[s.guideKind ?? 'shipped']
          : s.game === 'iracing'
            ? 'No guide (there is none for this car)'
            : 'No guide (there is none for this aircraft)',
        question ? `Your question: "${question}"` : 'The task: what RigReady asks the model to do',
      ],
      streamed: STREAMED.has(input.kind),
    });
  }

  /**
   * Tokens of an answer and what they are estimated at, with those of an earlier try when
   * there was one. The estimate uses the prices of the provider the request was shown with.
   */
  private usage(provider: ChatProvider, answer: MessageAnswer, earlier?: MessageAnswer): UsageView {
    const u = answer.usage;
    const e = earlier?.usage ?? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    const used: Usage = {
      input: u.input + e.input,
      output: u.output + e.output,
      cacheWrite: u.cacheWrite + e.cacheWrite,
      cacheRead: u.cacheRead + e.cacheRead,
    };
    const cost = provider.cost(used);
    return {
      model: answer.model,
      ...used,
      cost,
      prices: cost === null ? null : (provider.prices?.source ?? null),
    };
  }

  async send(requestId: string): Promise<Result<Sent>> {
    const request = this.prepared.get(requestId);
    if (!request) return err('ai.expired', 'That request is no longer ready. Ask again.');
    // The month may have filled since the request was shown. It stays ready while it waits.
    if (request.approxCost !== null) {
      const month = await this.monthBudget(request.approxCost);
      if (month.state === 'stopped') return err('ai.budget', budgetStopMessage(month));
    }
    this.prepared.delete(requestId);
    // Registered before anything is awaited, so that Cancel works from the first moment.
    const controller = STREAMED.has(request.kind) ? new AbortController() : undefined;
    if (controller) this.inFlight.set(requestId, controller);
    try {
      return await this.answer(requestId, request, controller);
    } finally {
      this.inFlight.delete(requestId);
    }
  }

  /** Sends the prepared body once, streamed or whole, and logs a failure. */
  private async ask(
    requestId: string,
    request: PreparedRequest,
    key: string | undefined,
    controller: AbortController | undefined
  ): Promise<Result<MessageAnswer>> {
    const answer = controller
      ? await this.sendStreamed(requestId, request.provider, key, request.body, controller.signal)
      : await request.provider.send(this.ctx.ports.http, key, request.body);
    if (!answer.ok) {
      if (answer.error.code === 'ai.cancelled') {
        this.ctx.log.info(`ai-assist: ${request.kind} cancelled`);
      } else this.ctx.log.warn(`ai-assist: ${request.kind} failed: ${answer.error.code}`);
      return answer;
    }
    const { usage, model } = answer.value;
    this.ctx.log.info(
      `ai-assist: ${request.kind} answered by ${model}: ${usage.input} in, ${usage.cacheRead} cached, ${usage.cacheWrite} cache-written, ${usage.output} out`
    );
    // Every answered try is counted: the provider charges for each.
    await this.countRequest(request.provider, usage);
    return answer;
  }

  /**
   * Asks, and checks the answer. When the format was only asked for in the text (a server
   * that takes no JSON schema), an answer that does not check out is asked for once more
   * with the very same request, as the preview said; the usage shown covers both.
   */
  private async checked<T>(
    requestId: string,
    request: PreparedRequest,
    key: string | undefined,
    controller: AbortController | undefined,
    check: (text: string, model: string) => Parsed<T>
  ): Promise<Result<{ value: T; usage: UsageView }>> {
    const first = await this.ask(requestId, request, key, controller);
    if (!first.ok) return first;
    const textOf = (answer: MessageAnswer): string =>
      request.retriesOnce ? jsonText(answer.text) : answer.text;
    const once = check(textOf(first.value), first.value.model);
    if (once.ok) {
      return ok({ value: once.value, usage: this.usage(request.provider, first.value) });
    }
    if (!request.retriesOnce) return err('ai.invalid', once.why);
    this.ctx.log.info(`ai-assist: ${request.kind} answer did not check out; asking once more`);
    const second = await this.ask(requestId, request, key, controller);
    if (!second.ok) return second;
    const both = this.usage(request.provider, second.value, first.value);
    const twice = check(textOf(second.value), second.value.model);
    if (twice.ok) return ok({ value: twice.value, usage: both });
    return err(
      'ai.invalid',
      `${twice.why} It was asked for twice and the model did not keep to the format. A larger model, or a service that accepts a JSON schema, does better.`
    );
  }

  private async answer(
    requestId: string,
    request: PreparedRequest,
    controller: AbortController | undefined
  ): Promise<Result<Sent>> {
    const key = await this.keyFor(request.provider);
    if (!key.ok) return key;
    if (request.kind === 'suggest') {
      const plan = await this.checked(requestId, request, key.value, controller, (text) =>
        validatePlan(text, request.snapshot)
      );
      if (!plan.ok) return plan;
      const { value, usage } = plan.value;
      const roundId = this.next('round');
      this.rounds.set(roundId, { aircraftId: request.aircraftId, plan: value });
      this.ctx.log.info(
        `ai-assist: ${value.suggestions.length} suggestions kept, ${value.dropped.length} dropped`
      );
      return ok({
        kind: 'suggest',
        roundId,
        summary: value.summary,
        notes: value.notes,
        suggestions: value.suggestions.map(({ deviceGuid: _g, deviceRef: _r, ...view }) => view),
        dropped: value.dropped,
        usage,
      });
    }
    if (request.kind === 'draft') {
      // A guide file of the user's own may have been added since the request was shown.
      if (await this.ownGuideKept(request.aircraftId)) {
        return err(
          'ai.guideExists',
          'A guide file of your own was added for this aircraft meanwhile. Nothing was sent.'
        );
      }
      const at = new Date(this.ctx.ports.clock.now()).toISOString();
      // iRacing's ids get the plain labels the class guides give them, where they have one.
      const labels =
        request.snapshot.game === 'iracing'
          ? await this.iracingLabels(request.snapshot.iracing?.set ?? 'all')
          : {};
      const draft = await this.checked(requestId, request, key.value, controller, (text, model) =>
        validateDraft(text, request.snapshot, model, at, labels)
      );
      if (!draft.ok) return draft;
      const { value, usage } = draft.value;
      if (await this.ownGuideKept(request.aircraftId)) {
        return err(
          'ai.guideExists',
          'A guide file of your own was added for this aircraft meanwhile. The draft was not saved.'
        );
      }
      const written = await this.ctx.ports.files.write(
        this.draftPath(request.aircraftId),
        packText(
          value.pack,
          `# Drafted by ${usage.model} for RigReady. Format: see packs/README.md in RigReady's source.\n`
        ),
        { reason: 'Binding guide drafted by AI' }
      );
      if (!written.ok) return written;
      return ok({ kind: 'draft', items: value.pack.items.length, dropped: value.dropped, usage });
    }
    const answer = await this.ask(requestId, request, key.value, controller);
    if (!answer.ok) return answer;
    const text = cleanAnswer(answer.value.text);
    if (text.length === 0) return err('ai.empty', 'The model sent an empty answer. Try again.');
    return ok({
      kind: 'answer',
      question: request.question,
      text,
      usage: this.usage(request.provider, answer.value),
    });
  }

  /**
   * Sends a request whose answer is streamed, reporting how far it is: that the model
   * started, then the characters and the finished items received so far. The text itself
   * is not passed on: nothing of an answer is shown or used before it is complete and checked.
   */
  private async sendStreamed(
    requestId: string,
    provider: ChatProvider,
    key: string | undefined,
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Result<MessageAnswer>> {
    const counter = new JsonItemCounter();
    const now = (): number => this.ctx.ports.clock.now().getTime();
    let reported = { at: Number.NEGATIVE_INFINITY, items: 0 };
    return provider.stream(this.ctx.ports.http, key, body, {
      signal,
      ...(this.ctx.streamIdleMs === undefined ? {} : { idleTimeoutMs: this.ctx.streamIdleMs }),
      onUpdate: (update) => {
        if (update.kind === 'started') {
          this.ctx.onProgress?.({ requestId, phase: 'started', chars: 0, items: 0 });
          return;
        }
        const items = counter.push(update.delta);
        const at = now();
        if (items === reported.items && at - reported.at < PROGRESS_EVERY_MS) return;
        reported = { at, items };
        this.ctx.onProgress?.({ requestId, phase: 'receiving', chars: update.chars, items });
      },
    });
  }

  /** Stops a streamed request that is on its way; its `send` then fails with `ai.cancelled`. */
  async cancel(requestId: string): Promise<Result<{ cancelled: boolean }>> {
    const controller = this.inFlight.get(requestId);
    if (!controller) return ok({ cancelled: false });
    controller.abort();
    return ok({ cancelled: true });
  }

  private proposalFromRound(roundId: string, selected: string[]): Result<BindingProposal> {
    const round = this.rounds.get(roundId);
    if (!round) return err('ai.expired', 'Those suggestions are no longer available. Ask again.');
    const wanted = new Set(selected);
    const chosen = round.plan.suggestions.filter((s) => wanted.has(s.id));
    if (chosen.length === 0) return err('ai.nothing', 'Tick at least one suggestion.');
    const inputs = new Map<string, string>();
    for (const s of chosen) {
      const key = `${s.deviceGuid}|${s.input}`;
      const other = inputs.get(key);
      if (other) {
        return err(
          'ai.clash',
          `"${other}" and "${s.label}" both use ${s.inputLabel} on ${s.deviceName}. Untick one.`
        );
      }
      inputs.set(key, s.label);
    }
    return ok({
      aircraftId: round.aircraftId,
      summary: `Bind ${chosen.length} ${chosen.length === 1 ? 'action' : 'actions'} suggested by AI`,
      changes: chosen.map((s) => ({
        op: 'bind',
        deviceGuid: s.deviceGuid,
        input: s.input,
        actionId: s.actionId,
      })),
    });
  }

  async reviewSuggestions(roundId: string, selected: string[]): Promise<Result<PlanView>> {
    const proposal = this.proposalFromRound(roundId, selected);
    if (!proposal.ok) return proposal;
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    return proposals.value.plan(proposal.value);
  }

  async applySuggestions(roundId: string, selected: string[]): Promise<Result<AppliedView>> {
    const proposal = this.proposalFromRound(roundId, selected);
    if (!proposal.ok) return proposal;
    const proposals = this.proposals();
    if (!proposals.ok) return proposals;
    return proposals.value.apply(proposal.value);
  }

  /**
   * Deletes a guide an AI drafted. A guide of the user's own, or a file that cannot be read
   * as either, is refused: only the user deletes that, in the window (`deleteGuide`).
   */
  async deleteDraft(aircraftId: string): Promise<Result<{ deleted: boolean }>> {
    if (await this.ownGuideKept(aircraftId)) {
      return err(
        'ai.ownGuide',
        "The guide kept for this aircraft is the user's own, so it was not deleted. Only the user can delete it, in RigReady's window."
      );
    }
    return this.removeGuide(aircraftId, 'Delete a binding guide drafted by AI');
  }

  /** The window's Delete, after the user said yes: whichever guide is kept. */
  async deleteGuide(aircraftId: string): Promise<Result<{ deleted: boolean }>> {
    return this.removeGuide(aircraftId, 'Delete a binding guide');
  }

  /**
   * Removes the guide file kept for an aircraft. It is in the data folder, so the journal is
   * asked for by name: a copy is kept first, and the Safety page can put it back.
   */
  private async removeGuide(
    aircraftId: string,
    reason: string
  ): Promise<Result<{ deleted: boolean }>> {
    const file = this.draftPath(aircraftId);
    if (!(await this.ctx.ports.files.exists(file))) return ok({ deleted: false });
    const removed = await this.ctx.ports.files.remove(file, { reason, journal: true });
    if (!removed.ok) return removed;
    if (await this.ctx.ports.files.exists(file)) {
      return err('ai.guideFile', 'The guide file is still there. It could not be deleted.');
    }
    return ok({ deleted: true });
  }
}

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { z } from 'zod';
import {
  choiceFor,
  keptByDefault as isKeptByDefault,
  offered as isOffered,
  stepAction,
  stepChecks,
  stepDefault,
  stepsFor,
  variantsOf,
  type CaptureChoice,
} from '../../../core/captureDefaults';
import type { CaptureCandidateSchema } from '../../../core/checks/engine';
import { CHECK_GROUPS, type CheckGroup } from '../../../core/profile/schema';
import { errorText, useClient } from '../../../renderer/ipc';
import {
  profilesContract,
  type CaptureGame,
  type CaptureResult,
  type CaptureStep,
} from '../contract';
import MonitorDiagram from './MonitorDiagram.vue';
import RememberApp from './RememberApp.vue';
import { pickerItems, pickerNote, type PickerItem, type PickerNote } from './pickerForm';
import { newSetupLaunch, steamAppOf, steamAppProblem, type LaunchKind } from './steamLaunch';

/**
 * "Capture what is true right now": the rig as it is becomes a setup. The screen is the
 * machine read back in sections (game, devices, apps, monitors, audio, game files); what
 * stays ticked becomes the checklist, and the panel on the right says what that is.
 */
type Candidate = z.infer<typeof CaptureCandidateSchema>;
type Launch = NonNullable<CaptureGame['installs'][number]['launch']>;

const api = useClient(profilesContract);
const router = useRouter();

const loading = ref(true);
const saving = ref(false);
const error = ref<string>();
const captured = ref<CaptureResult>();

// ---- what the setup is for ----
/** '' = no particular game, 'other' = a game without a module, else a game module id. */
const game = ref('');
const variant = ref('');
const gameName = ref('');
const installDir = ref('');
const name = ref('');
/** Once the user types a name, choosing another game no longer replaces it. */
const nameEdited = ref(false);
/**
 * The editor's three choices. A game Steam starts shows as "Through Steam" with its number;
 * "Nothing" is a setup that only checks the rig.
 */
const launchKind = ref<LaunchKind>('program');
const steamApp = ref('');
const launchExe = ref('');
const launchArgs = ref('');
const launchCwd = ref('');

// ---- what is kept ----
const selected = reactive<Record<string, boolean>>({});
const required = reactive<Record<string, boolean>>({});
/** Ticks the user set by hand: defaults never override them when the game changes. */
const touched = reactive<Record<string, boolean>>({});
const answers = reactive<Record<string, string>>({});
const titles = reactive<Record<string, string>>({});
const renaming = ref<string>();
const expanded = reactive<Record<string, boolean>>({});
const appFilter = ref('');
const trackedOn = reactive<Record<string, boolean>>({});
const trackedTouched = reactive<Record<string, boolean>>({});
/** The steps before launch the game needs, by step type: kept or not, and what each uses. */
const stepOn = reactive<Record<string, boolean>>({});
const stepValue = reactive<Record<string, string>>({});
const stepTouched = reactive<Record<string, boolean>>({});
/** The checks that go with a kept step, by check type: left out only when the person says so. */
const stepCheckLeft = reactive<Record<string, boolean>>({});

const candidates = computed(() => captured.value?.candidates ?? []);
const games = computed(() => captured.value?.games ?? []);
/** The games found here; the ones the user added ("user-...") last, beside "Another game". */
const installed = computed(() => {
  const found = games.value.filter((g) => g.installs.length > 0);
  const own = (g: CaptureGame): boolean => g.id.startsWith('user-');
  return [...found.filter((g) => !own(g)), ...found.filter(own)];
});
const chosenGame = computed(() => games.value.find((g) => g.id === game.value));
const chosenInstall = computed(
  () =>
    chosenGame.value?.installs.find((i) => i.installDir === installDir.value) ??
    chosenGame.value?.installs[0]
);

/** The aircraft or cars of the chosen game that something on this PC is set up for. */
const variants = computed(() => variantsOf(candidates.value, game.value));
const chosenVariant = computed(() => variants.value.find((v) => v.id === variant.value));

/** The game, its family and what it is played with: what decides which rows come ticked. */
const choice = computed<CaptureChoice>(() =>
  choiceFor(captured.value ?? { games: [], suggested: {} }, game.value, variant.value)
);
const offered = (candidate: Candidate): boolean => isOffered(candidate, choice.value);
const keptByDefault = (candidate: Candidate): boolean => isKeptByDefault(candidate, choice.value);
function applyDefaults(): void {
  for (const candidate of candidates.value) {
    if (!offered(candidate)) selected[candidate.key] = false;
    else if (!touched[candidate.key]) selected[candidate.key] = keptByDefault(candidate);
    required[candidate.key] ??= candidate.check.required;
  }
  for (const item of captured.value?.tracked ?? []) {
    if (!trackedOffered(item)) trackedOn[item.key] = false;
    else if (!trackedTouched[item.key]) trackedOn[item.key] = item.selectedByDefault;
  }
  for (const step of captured.value?.steps ?? []) {
    if (!steps.value.includes(step)) {
      stepOn[step.type] = false;
      continue;
    }
    stepValue[step.type] ??= stepDefault(step) ?? '';
    if (!stepTouched[step.type]) stepOn[step.type] = stepValue[step.type] !== '';
  }
}
function toggle(candidate: Candidate, value: boolean | null): void {
  selected[candidate.key] = value === true;
  touched[candidate.key] = true;
}
/** "Always offer this app" answered: the row is what the capture proposes now, and kept. */
function replaced(old: Candidate, now: Candidate | undefined): void {
  const list = captured.value?.candidates ?? [];
  const at = list.findIndex((c) => c.key === old.key);
  if (at >= 0) list.splice(at, 1, ...(now ? [now] : []));
  if (now?.remember?.remembered) toggle(now, true);
}

const argsLine = (args: string[]): string =>
  args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
function setLaunch(launch: Launch | undefined): void {
  launchExe.value = launch?.exe ?? '';
  launchArgs.value = argsLine(launch?.args ?? []);
  launchCwd.value = launch?.cwd ?? '';
  steamApp.value = steamAppOf(launch) ?? '';
  launchKind.value = steamApp.value ? 'steam' : 'program';
}
/** The program as the three fields have it. */
function typedLaunch(): Launch | undefined {
  const exe = launchExe.value.trim();
  const cwd = launchCwd.value.trim();
  return exe ? { exe, args: splitArgs(launchArgs.value), ...(cwd ? { cwd } : {}) } : undefined;
}
/** Still what the game brought, and so not a program the person typed. */
function holds(launch: Launch | undefined): boolean {
  if (!launch) return false;
  return (
    launchExe.value === launch.exe &&
    launchArgs.value === argsLine(launch.args) &&
    launchCwd.value === (launch.cwd ?? '')
  );
}
/**
 * "A program" and "Through Steam" are two views of one launch: a number changed under one
 * shows under the other. "Nothing" keeps what was typed, in case the person comes back.
 */
function setLaunchKind(kind: LaunchKind): void {
  if (kind === launchKind.value) return;
  if (kind === 'program') {
    const made = newSetupLaunch('steam', typedLaunch(), steamApp.value).launch;
    if (made) launchArgs.value = argsLine(made.args);
  } else if (kind === 'steam') {
    steamApp.value = steamAppOf(typedLaunch()) ?? steamApp.value;
  }
  launchKind.value = kind;
}

function suggestName(): void {
  if (nameEdited.value) return;
  if (game.value === 'other') name.value = gameName.value.trim();
  else name.value = chosenVariant.value?.setupName ?? chosenGame.value?.name ?? '';
}

/** A known game brings its launch target, its aircraft or cars, its files and its checks. */
function chooseGame(id: string): void {
  // What the game chosen until now brought: "Another game" does not start that one.
  const brought = chosenInstall.value?.launch;
  game.value = id;
  const found = games.value.find((g) => g.id === id);
  installDir.value = found?.installs[0]?.installDir ?? '';
  variant.value = variants.value[0]?.id ?? '';
  if (found) setLaunch(found.installs[0]?.launch);
  else if (id === '' || holds(brought)) setLaunch(undefined);
  suggestName();
  applyDefaults();
}
function chooseVariant(id: string): void {
  variant.value = variant.value === id ? '' : id;
  suggestName();
  applyDefaults();
}
function chooseInstall(dir: string): void {
  installDir.value = dir;
  setLaunch(chosenInstall.value?.launch);
}

async function capture(): Promise<void> {
  loading.value = true;
  const result = await api.capture();
  loading.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  captured.value = result.value;
  // The rig may say what it is set up for (the game is running, or only one fits).
  const suggested = result.value.suggested.game;
  if (suggested && result.value.games.some((g) => g.id === suggested)) chooseGame(suggested);
  else applyDefaults();
}

// ---- sections ----
const SECTIONS: Record<
  CheckGroup,
  {
    title: string;
    icon: string;
    lead: string;
    moreLabel: string;
    lessLabel: string;
    /** In the summary: "1 device", "11 devices". */
    noun: [string, string];
  }
> = {
  devices: {
    title: 'Devices',
    noun: ['device', 'devices'],
    icon: 'mdi-controller',
    lead: 'Game controllers are kept. Each becomes a "connected" check.',
    moreLabel: 'other USB devices',
    lessLabel: 'Hide other USB devices',
  },
  apps: {
    title: 'Apps',
    noun: ['app', 'apps'],
    icon: 'mdi-application-cog-outline',
    lead: 'Sim helpers that are running now. Make ready starts the ones that are missing.',
    moreLabel: 'other running apps',
    lessLabel: 'Hide other running apps',
  },
  displays: {
    title: 'Monitors',
    noun: ['monitor layout', 'monitor checks'],
    icon: 'mdi-monitor-multiple',
    lead: 'The arrangement as it is right now. Make ready puts it back.',
    moreLabel: 'more',
    lessLabel: 'Show less',
  },
  audio: {
    title: 'Audio',
    noun: ['audio device', 'audio devices'],
    icon: 'mdi-volume-high',
    lead: 'The default devices as they are right now. Make ready sets them again.',
    moreLabel: 'more',
    lessLabel: 'Show less',
  },
  files: {
    title: 'Game files',
    noun: ['game file', 'game files'],
    icon: 'mdi-file-cog-outline',
    lead: 'Checked before every launch, so a missing or changed file shows before the game loads.',
    moreLabel: 'more',
    lessLabel: 'Show less',
  },
  other: {
    title: 'Game checks',
    noun: ['game check', 'game checks'],
    icon: 'mdi-clipboard-check-outline',
    lead: 'What only this game needs.',
    moreLabel: 'more',
    lessLabel: 'Show less',
  },
};

/** With a game chosen, the lead says that the ticks follow the game. */
function leadOf(group: CheckGroup): string {
  const gameName = chosenGame.value?.name;
  if (gameName && group === 'devices') {
    return (
      'What ' +
      gameName +
      ' is played with is kept. The rest is listed, not ticked. Each kept device becomes a "connected" check.'
    );
  }
  if (gameName && group === 'apps') {
    return (
      'Helpers for ' +
      gameName +
      ' that are running now are kept. Make ready starts the ones that are missing.'
    );
  }
  return SECTIONS[group].lead;
}

const sections = computed(() =>
  CHECK_GROUPS.map((group) => {
    const all = candidates.value.filter((c) => c.group === group && offered(c));
    const filter = group === 'apps' ? appFilter.value.trim().toLowerCase() : '';
    const matches = (c: Candidate): boolean =>
      !filter ||
      `${c.title} ${c.description ?? ''} ${c.program ?? ''}`.toLowerCase().includes(filter);
    // What is kept stays in view whatever its tier; a search looks through everything.
    // What a setup like this keeps comes first; the order does not jump while ticking.
    const shown = all.filter((c) => selected[c.key] || (c.tier !== 'more' && matches(c)));
    const main = [...shown.filter(keptByDefault), ...shown.filter((c) => !keptByDefault(c))];
    const more = all.filter((c) => c.tier === 'more' && !selected[c.key] && matches(c));
    return {
      group,
      ...SECTIONS[group],
      lead: leadOf(group),
      total: all.length,
      chosen: all.filter((c) => selected[c.key]).length,
      main,
      more,
      open: expanded[group] === true || filter !== '',
    };
  }).filter((s) => s.total > 0)
);

const diagram = computed(
  () => candidates.value.find((c) => c.group === 'displays' && c.monitors)?.monitors
);

// ---- steps before launch ----
/** What the steps are for, said once above them, with the game's own name. */
const STEP_LEADS: Record<CaptureStep['need'], (gameName: string) => string> = {
  gamepad: (gameName) =>
    `${gameName} reads a gamepad. A virtual controller lets it read your own gear as one. Make ready starts it before the game.`,
};
const steps = computed(() => stepsFor(captured.value?.steps ?? [], choice.value));
const stepLead = computed(() => {
  const first = steps.value[0];
  return first ? STEP_LEADS[first.need](chosenGame.value?.name ?? 'This game') : '';
});
const stepParams = (step: CaptureStep): Record<string, unknown> =>
  stepValue[step.type] ? { [step.picker.param]: stepValue[step.type] } : {};
const stepItems = (step: CaptureStep): PickerItem[] => pickerItems(step.picker, stepParams(step));
const stepNote = (step: CaptureStep): PickerNote | undefined =>
  pickerNote(step.picker, stepParams(step));
/** Choosing one keeps the step; clearing the choice leaves it out. */
function chooseStep(step: CaptureStep, value: unknown): void {
  stepValue[step.type] = typeof value === 'string' ? value : '';
  stepOn[step.type] = stepValue[step.type] !== '';
  stepTouched[step.type] = true;
}
function toggleStep(step: CaptureStep, value: boolean | null): void {
  stepOn[step.type] = value === true && stepValue[step.type] !== '';
  stepTouched[step.type] = true;
}
/** The steps that go into the setup: kept, and with a choice that is in the list. */
const keptSteps = computed(() =>
  steps.value.flatMap((step, index) => {
    if (!stepOn[step.type]) return [];
    const action = stepAction(step, stepValue[step.type], 'a' + (index + 1));
    const chosen = step.picker.choices.find((c) => c.value === stepValue[step.type]);
    return action && chosen ? [{ step, action, chosen }] : [];
  })
);

// ---- tracked files ----
const trackedOffered = (item: CaptureResult['tracked'][number]): boolean =>
  isOffered(item, choice.value);
const trackedAll = computed(() => (captured.value?.tracked ?? []).filter(trackedOffered));
/** The game's own files first; what helper tools keep is one click away. */
const trackedTools = computed(() => trackedAll.value.filter((t) => !t.game && !trackedOn[t.key]));
const tracked = computed(() =>
  expanded['tracked']
    ? trackedAll.value
    : trackedAll.value.filter((t) => t.game || trackedOn[t.key])
);
const trackedChosen = computed(() => trackedAll.value.filter((t) => trackedOn[t.key]));
function toggleTracked(key: string, value: boolean | null): void {
  trackedOn[key] = value === true;
  trackedTouched[key] = true;
}

// ---- identify a device by pressing a button ----
const identifying = ref(false);
const identified = ref<{ keys: string[]; text: string }>();
async function identify(): Promise<void> {
  identifying.value = true;
  identified.value = undefined;
  const pressed = await api.waitForPress({ timeoutSeconds: 15 });
  identifying.value = false;
  if (!pressed.ok) {
    identified.value = { keys: [], text: errorText(pressed.error) };
    return;
  }
  const device = pressed.value.device;
  if (!device) {
    identified.value = { keys: [], text: 'No button was pressed.' };
    return;
  }
  const rows = candidates.value.filter(
    (c) =>
      c.device && c.device.vendorId === device.vendorId && c.device.productId === device.productId
  );
  identified.value =
    rows.length === 0
      ? { keys: [], text: `That was ${device.name}, which is not in the list.` }
      : rows.length === 1
        ? { keys: [rows[0]!.key], text: `That was ${titleOf(rows[0]!)}.` }
        : {
            keys: rows.map((c) => c.key),
            text: `That was one of the ${rows.length} identical ${device.name} devices. They are told apart by serial number or USB port, not by which one was pressed.`,
          };
}

const titleOf = (candidate: Candidate): string =>
  (titles[candidate.key] ?? '').trim() || candidate.title;

function startRename(candidate: Candidate): void {
  titles[candidate.key] ??= candidate.title;
  renaming.value = candidate.key;
}

// ---- the summary ----
const kept = computed(() => candidates.value.filter((c) => selected[c.key] && offered(c)));
/** The checks the kept steps bring (the driver a virtual controller needs), unless left out. */
const keptStepChecks = computed(() =>
  stepChecks(
    keptSteps.value.map((k) => k.step),
    new Set(Object.keys(stepCheckLeft).filter((type) => stepCheckLeft[type])),
    kept.value.map((c) => c.check)
  )
);
const summary = computed(() =>
  sections.value
    .map((s) => {
      const items = kept.value.filter((c) => c.group === s.group);
      return { group: s.group, noun: s.noun[items.length === 1 ? 0 : 1], icon: s.icon, items };
    })
    .filter((s) => s.items.length > 0)
);
const closedAtStandDown = computed(() =>
  kept.value.filter((c) => c.standDownNote).map((c) => titleOf(c))
);
const steamProblem = computed(() =>
  launchKind.value === 'steam' ? steamAppProblem(steamApp.value) : undefined
);
const launchText = computed(() => {
  const what =
    game.value === 'other' ? gameName.value.trim() || 'the game' : (chosenGame.value?.name ?? '');
  if (launchKind.value === 'none') return undefined;
  if (launchKind.value === 'steam') {
    const app = steamApp.value.trim();
    if (!app || steamProblem.value) return undefined;
    return what ? `${what}, through Steam` : `Steam app ${app}`;
  }
  const exe = launchExe.value.trim();
  if (!exe) return undefined;
  const file = exe.replace(/^.*[\\/]/, '');
  const through = /^steam\.exe$/i.test(file) ? 'through Steam' : `with ${file}`;
  return what ? `${what}, ${through}` : file;
});

// Every part can be skipped: a setup with only a name is still a valid one to start from.
const canSave = computed(
  () => name.value.trim().length > 0 && !saving.value && !loading.value && !steamProblem.value
);

/** Splits an argument line on spaces, keeping "quoted parts" together. Arguments stay an array end to end. */
function splitArgs(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '');
}

async function browseProgram(): Promise<void> {
  const picked = await api.browse({ kind: 'program', title: 'Program to launch' });
  if (!picked.ok) error.value = errorText(picked.error);
  else if (picked.value.path) launchExe.value = picked.value.path;
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = undefined;
  const severalInstalls = (chosenGame.value?.installs.length ?? 0) > 1;
  const result = await api.create({
    name: name.value,
    ...(game.value ? { game: game.value } : {}),
    ...(game.value === 'other' && gameName.value.trim() ? { gameName: gameName.value.trim() } : {}),
    ...(severalInstalls && installDir.value ? { gameInstall: installDir.value } : {}),
    ...newSetupLaunch(launchKind.value, typedLaunch(), steamApp.value),
    checks: [
      ...kept.value.map((c) => {
        const answer = c.ask ? (answers[c.key] ?? '').trim() : '';
        return {
          ...c.check,
          title: titleOf(c),
          required: required[c.key] ?? true,
          ...(c.ask && answer ? { params: { ...c.check.params, [c.ask.param]: answer } } : {}),
        };
      }),
      ...keptStepChecks.value,
    ],
    ...(keptSteps.value.length > 0
      ? {
          actions: {
            preLaunch: keptSteps.value.map((kept) => kept.action),
            postLaunch: [],
            standDown: [],
          },
        }
      : {}),
    tracked: trackedChosen.value.map((t) => ({
      label: t.label,
      path: t.path,
      kind: t.kind,
      include: t.include,
      exclude: t.exclude,
      ...(t.game ? { game: t.game } : {}),
    })),
  });
  saving.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  await router.push('/');
}

const gameIcon = (kind: CaptureGame['kind']): string =>
  kind === 'flight' ? 'mdi-airplane' : kind === 'racing' ? 'mdi-steering' : 'mdi-gamepad-variant';
const sourceText = (source: string): string =>
  source === 'steam' ? 'Steam' : source === 'store' ? 'Microsoft Store' : 'Installed';

onMounted(capture);
</script>

<template>
  <div class="rr-page cap" data-testid="capture-page">
    <h1 class="rr-page-title">New setup from this rig</h1>
    <p class="rr-page-sub">
      Get the rig the way you fly or race, then keep what this setup needs. Everything that stays
      ticked becomes a check on the Play screen, with a fix where RigReady has one.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="capture-error">{{
      error
    }}</v-alert>
    <v-alert
      v-for="problem in captured?.problems ?? []"
      :key="problem"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ problem }}
    </v-alert>

    <div class="cap-layout">
      <div class="cap-main">
        <!-- 1. What it is for -->
        <section class="cap-section" data-testid="capture-section-game">
          <div class="cap-head">
            <v-icon icon="mdi-gamepad-variant-outline" size="18" />
            <h2 class="rr-section-title">Game</h2>
          </div>
          <div class="rr-panel cap-game">
            <div v-if="loading" class="rr-muted">Looking at the rig…</div>
            <template v-else>
              <div class="cap-tiles" role="radiogroup" aria-label="Game" data-testid="capture-game">
                <button
                  v-for="g in installed"
                  :key="g.id"
                  type="button"
                  class="cap-tile"
                  :class="{ on: game === g.id }"
                  role="radio"
                  :aria-checked="game === g.id"
                  :data-testid="`capture-game-${g.id}`"
                  :title="
                    g.installs.map((i) => `${sourceText(i.source)}: ${i.installDir}`).join('\n')
                  "
                  @click="chooseGame(g.id)"
                >
                  <v-icon :icon="gameIcon(g.kind)" size="20" />
                  <span class="cap-tile-name">{{ g.name }}</span>
                  <span class="cap-tile-sub">
                    <template v-if="g.running">running now</template>
                    <template v-else-if="g.id.startsWith('user-')">added by you</template>
                    <template v-else>{{
                      g.installs.length > 1
                        ? `${g.installs.length} installs`
                        : sourceText(g.installs[0]!.source)
                    }}</template>
                  </span>
                  <v-icon
                    v-if="game === g.id"
                    icon="mdi-check-circle"
                    size="16"
                    class="cap-tile-on"
                  />
                </button>
                <button
                  type="button"
                  class="cap-tile"
                  :class="{ on: game === 'other' }"
                  role="radio"
                  :aria-checked="game === 'other'"
                  data-testid="capture-game-other"
                  @click="chooseGame('other')"
                >
                  <v-icon icon="mdi-gamepad-variant" size="20" />
                  <span class="cap-tile-name">Another game</span>
                  <span class="cap-tile-sub">you say what to launch</span>
                  <v-icon
                    v-if="game === 'other'"
                    icon="mdi-check-circle"
                    size="16"
                    class="cap-tile-on"
                  />
                </button>
                <button
                  type="button"
                  class="cap-tile"
                  :class="{ on: game === '' }"
                  role="radio"
                  :aria-checked="game === ''"
                  data-testid="capture-game-none"
                  @click="chooseGame('')"
                >
                  <v-icon icon="mdi-checkbox-blank-circle-outline" size="20" />
                  <span class="cap-tile-name">No game</span>
                  <span class="cap-tile-sub">just check the rig</span>
                  <v-icon
                    v-if="game === ''"
                    icon="mdi-check-circle"
                    size="16"
                    class="cap-tile-on"
                  />
                </button>
              </div>
              <div
                v-if="captured?.suggested.reason && game === captured.suggested.game"
                class="cap-why"
                data-testid="capture-suggested"
              >
                <v-icon icon="mdi-auto-fix" size="14" />
                {{ captured.suggested.reason }}. Choose another if this setup is for something else.
              </div>
              <div
                v-else-if="installed.length === 0"
                class="cap-why"
                data-testid="capture-no-games"
              >
                <v-icon icon="mdi-information-outline" size="14" />
                No game RigReady knows was found on this PC. Choose “Another game” to launch one
                yourself; the checks below work for any game.
              </div>

              <div v-if="variants.length > 0" class="cap-variants" data-testid="capture-variants">
                <span class="rr-muted">{{
                  chosenGame?.kind === 'racing' ? 'Car' : 'Aircraft'
                }}</span>
                <v-chip
                  v-for="v in variants"
                  :key="v.id"
                  :variant="variant === v.id ? 'flat' : 'outlined'"
                  :color="variant === v.id ? 'primary' : undefined"
                  size="small"
                  :data-testid="`capture-variant-${v.id}`"
                  :aria-current="variant === v.id ? 'true' : undefined"
                  @click="chooseVariant(v.id)"
                  >{{ v.name }}</v-chip
                >
                <span class="rr-row-sub">from your bindings</span>
              </div>

              <div class="cap-fields">
                <v-text-field
                  v-model="name"
                  label="Name of the setup"
                  placeholder="e.g. GT3 or F/A-18C"
                  data-testid="capture-name"
                  @update:model-value="nameEdited = true"
                />
                <v-text-field
                  v-if="game === 'other'"
                  v-model="gameName"
                  label="Game name"
                  placeholder="e.g. Richard Burns Rally"
                  data-testid="capture-game-name"
                  @update:model-value="suggestName"
                />
                <v-select
                  v-if="(chosenGame?.installs.length ?? 0) > 1"
                  :model-value="installDir"
                  :items="
                    chosenGame!.installs.map((i) => ({
                      title: `${i.installDir} (${sourceText(i.source)})`,
                      value: i.installDir,
                    }))
                  "
                  label="Install this setup uses"
                  data-testid="capture-install"
                  @update:model-value="chooseInstall($event)"
                />
              </div>

              <div class="cap-launch" data-testid="capture-launch">
                <div class="cap-launch-head">
                  <span class="cap-launch-title">Launch</span>
                  <v-btn-toggle
                    :model-value="launchKind"
                    mandatory
                    density="compact"
                    variant="outlined"
                    divided
                    color="primary"
                    @update:model-value="setLaunchKind"
                  >
                    <v-btn value="program" size="small" data-testid="capture-launch-program"
                      >A program</v-btn
                    >
                    <v-btn value="steam" size="small" data-testid="capture-launch-steam"
                      >Through Steam</v-btn
                    >
                    <v-btn value="none" size="small" data-testid="capture-launch-none"
                      >Nothing</v-btn
                    >
                  </v-btn-toggle>
                  <span v-if="launchText" class="rr-row-sub" data-testid="capture-launch-text"
                    >The Launch button starts {{ launchText }}.</span
                  >
                  <span
                    v-else-if="launchKind === 'none'"
                    class="rr-row-sub"
                    data-testid="capture-launch-text"
                    >The Play screen offers no Launch button for this setup.</span
                  >
                  <span
                    v-else-if="launchKind === 'steam'"
                    class="rr-row-sub"
                    data-testid="capture-launch-text"
                    >No Steam app id yet: the Play screen will have no Launch button.</span
                  >
                  <span v-else class="rr-row-sub" data-testid="capture-launch-text"
                    >No program yet: the Play screen will have no Launch button.</span
                  >
                </div>
                <v-text-field
                  v-if="launchKind === 'steam'"
                  v-model="steamApp"
                  label="Steam app id"
                  hint="The number in the game's Steam store address."
                  persistent-hint
                  :error-messages="steamProblem ? [steamProblem] : []"
                  class="cap-launch-steam"
                  data-testid="capture-launch-steam-app"
                />
                <div v-else-if="launchKind === 'program'" class="cap-launch-fields">
                  <v-text-field
                    v-model="launchExe"
                    label="Program"
                    placeholder="C:\Games\My Game\game.exe"
                    class="rr-mono-input"
                    data-testid="capture-launch-exe"
                  >
                    <template #append-inner>
                      <v-btn
                        size="small"
                        variant="text"
                        data-testid="capture-launch-browse"
                        @click="browseProgram"
                        >Browse…</v-btn
                      >
                    </template>
                  </v-text-field>
                  <v-text-field
                    v-model="launchArgs"
                    label="Arguments"
                    class="rr-mono-input"
                    data-testid="capture-launch-args"
                  />
                  <v-text-field
                    v-model="launchCwd"
                    label="Working folder"
                    class="rr-mono-input"
                    data-testid="capture-launch-cwd"
                  />
                </div>
              </div>
            </template>
          </div>
        </section>

        <!-- What the game needs before it starts, that the rig does not have by itself -->
        <section v-if="steps.length > 0" class="cap-section" data-testid="capture-steps">
          <div class="cap-head">
            <v-icon icon="mdi-play-circle-outline" size="18" />
            <h2 class="rr-section-title">Before launch</h2>
            <span class="cap-count">{{ keptSteps.length }} of {{ steps.length }} kept</span>
          </div>
          <p class="cap-lead" data-testid="capture-steps-lead">{{ stepLead }}</p>
          <div class="rr-panel">
            <template v-for="step in steps" :key="step.type">
              <div
                class="rr-row cap-row"
                data-testid="capture-step"
                :data-type="step.type"
                :data-kept="stepOn[step.type] ? 'yes' : 'no'"
              >
                <v-checkbox
                  :model-value="stepOn[step.type]"
                  :disabled="!stepValue[step.type]"
                  :aria-label="`Keep ${step.label}`"
                  @update:model-value="toggleStep(step, $event)"
                />
                <v-icon
                  icon="mdi-controller"
                  size="18"
                  class="cap-row-icon"
                  :class="{ dim: !stepOn[step.type] }"
                />
                <div class="rr-row-main">
                  <div class="rr-row-title">{{ step.label }}</div>
                  <div
                    v-if="step.picker.problem"
                    class="rr-row-sub rr-bad"
                    data-testid="capture-step-problem"
                  >
                    {{ step.picker.problem }}
                  </div>
                  <div
                    v-else-if="step.picker.choices.length === 0"
                    class="rr-row-sub"
                    data-testid="capture-step-empty"
                  >
                    {{ step.picker.empty }}
                  </div>
                  <template v-else>
                    <v-select
                      :model-value="stepValue[step.type] || null"
                      :items="stepItems(step)"
                      item-props
                      :label="step.picker.label"
                      :hint="stepValue[step.type] ? undefined : 'Choose one to keep this step.'"
                      persistent-hint
                      clearable
                      density="compact"
                      class="cap-ask"
                      data-testid="capture-step-choice"
                      @update:model-value="chooseStep(step, $event)"
                    />
                    <div v-if="stepNote(step)" class="rr-row-sub" data-testid="capture-step-note">
                      {{ stepNote(step)?.text }}
                    </div>
                  </template>
                </div>
              </div>
              <!-- What the step cannot work without is checked too, while the step is kept -->
              <div
                v-for="check in stepOn[step.type] ? step.checks : []"
                :key="`${step.type}:${check.type}`"
                class="rr-row cap-row cap-step-check"
                data-testid="capture-step-check"
                :data-type="check.type"
                :data-kept="stepCheckLeft[check.type] ? 'no' : 'yes'"
              >
                <v-checkbox
                  :model-value="!stepCheckLeft[check.type]"
                  :aria-label="`Keep ${check.title}`"
                  @update:model-value="stepCheckLeft[check.type] = $event !== true"
                />
                <v-icon
                  icon="mdi-check-circle-outline"
                  size="18"
                  class="cap-row-icon"
                  :class="{ dim: stepCheckLeft[check.type] }"
                />
                <div class="rr-row-main">
                  <div class="rr-row-title">{{ check.title }}</div>
                  <div class="rr-row-sub">The step above needs it. Checked before launch.</div>
                </div>
              </div>
            </template>
          </div>
        </section>

        <!-- 2. What the rig is right now -->
        <section
          v-for="section in sections"
          :key="section.group"
          class="cap-section"
          :data-testid="`capture-group-${section.group}`"
        >
          <div class="cap-head">
            <v-icon :icon="section.icon" size="18" />
            <h2 class="rr-section-title">{{ section.title }}</h2>
            <span class="cap-count">{{ section.chosen }} of {{ section.total }} kept</span>
            <v-spacer />
            <v-btn
              v-if="section.group === 'devices'"
              size="small"
              variant="text"
              prepend-icon="mdi-gesture-tap-button"
              :loading="identifying"
              data-testid="capture-identify"
              @click="identify"
            >
              Which one is it? Press a button
            </v-btn>
          </div>
          <p class="cap-lead">{{ section.lead }}</p>
          <div
            v-if="section.group === 'devices' && (identifying || identified)"
            class="cap-identified"
            data-testid="capture-identified"
            aria-live="polite"
          >
            <v-icon icon="mdi-gesture-tap-button" size="14" />
            {{ identifying ? 'Press any button on a controller now…' : identified?.text }}
          </div>
          <v-text-field
            v-if="section.group === 'apps'"
            v-model="appFilter"
            label="Find an app"
            prepend-inner-icon="mdi-magnify"
            clearable
            density="compact"
            class="mb-2"
            data-testid="capture-app-filter"
          />

          <div class="rr-panel">
            <div v-if="section.group === 'displays' && diagram" class="cap-diagram">
              <MonitorDiagram :monitors="diagram" />
            </div>
            <div
              v-for="candidate in section.main"
              :key="candidate.key"
              class="rr-row cap-row"
              :class="{ flash: identified?.keys.includes(candidate.key) }"
              data-testid="capture-candidate"
              :data-title="candidate.title"
              :data-kept="selected[candidate.key] ? 'yes' : 'no'"
            >
              <v-checkbox
                :model-value="selected[candidate.key]"
                :aria-label="`Keep ${titleOf(candidate)}`"
                @update:model-value="toggle(candidate, $event)"
              />
              <v-icon
                :icon="candidate.icon ?? section.icon"
                size="18"
                class="cap-row-icon"
                :class="{ dim: !selected[candidate.key] }"
              />
              <div class="rr-row-main">
                <div v-if="renaming === candidate.key" class="cap-rename">
                  <v-text-field
                    v-model="titles[candidate.key]"
                    density="compact"
                    autofocus
                    :aria-label="`Name for ${candidate.title}`"
                    data-testid="candidate-title-input"
                    @keydown.enter="renaming = undefined"
                    @blur="renaming = undefined"
                  />
                </div>
                <div v-else class="rr-row-title cap-title">
                  <span>{{ titleOf(candidate) }}</span>
                  <v-chip
                    v-if="candidate.device?.twin && candidate.device.model"
                    size="x-small"
                    variant="tonal"
                    data-testid="candidate-twin"
                    >{{ candidate.device.twin.index }} of
                    {{ candidate.device.twin.of }} identical</v-chip
                  >
                  <v-btn
                    v-if="candidate.device && selected[candidate.key]"
                    icon="mdi-pencil-outline"
                    size="x-small"
                    variant="text"
                    :aria-label="`Rename ${titleOf(candidate)}`"
                    data-testid="candidate-rename"
                    @click="startRename(candidate)"
                  />
                </div>
                <div v-if="candidate.description || candidate.standDownNote" class="rr-row-sub">
                  <span v-if="candidate.device?.model">{{ candidate.device.model }} · </span>
                  <span :class="{ 'rr-mono': candidate.device }">{{ candidate.description }}</span>
                  <span v-if="candidate.standDownNote && selected[candidate.key]">
                    · {{ candidate.standDownNote }}</span
                  >
                </div>
                <v-text-field
                  v-if="candidate.ask && selected[candidate.key]"
                  v-model="answers[candidate.key]"
                  :label="candidate.ask.label"
                  :placeholder="candidate.ask.placeholder"
                  :hint="candidate.ask.hint"
                  persistent-hint
                  density="compact"
                  class="cap-ask"
                  data-testid="candidate-ask"
                />
                <RememberApp :candidate="candidate" @changed="replaced(candidate, $event)" />
              </div>
              <v-btn-toggle
                v-if="selected[candidate.key]"
                v-model="required[candidate.key]"
                mandatory
                density="compact"
                variant="outlined"
                divided
              >
                <v-btn :value="true" size="small" data-testid="candidate-required">Required</v-btn>
                <v-btn :value="false" size="small" data-testid="candidate-optional">Optional</v-btn>
              </v-btn-toggle>
            </div>
            <div
              v-if="section.main.length === 0 && section.more.length === 0"
              class="rr-row rr-muted"
            >
              Nothing matches.
            </div>

            <template v-if="section.more.length > 0">
              <button
                type="button"
                class="rr-row cap-more"
                :aria-expanded="section.open"
                :data-testid="`capture-more-${section.group}`"
                @click="expanded[section.group] = !section.open"
              >
                <v-icon :icon="section.open ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="18" />
                {{
                  section.open
                    ? section.lessLabel
                    : `Show ${section.more.length} ${section.moreLabel}`
                }}
              </button>
              <template v-if="section.open">
                <div
                  v-for="candidate in section.more"
                  :key="candidate.key"
                  class="rr-row cap-row"
                  data-testid="capture-candidate"
                  :data-title="candidate.title"
                  data-kept="no"
                >
                  <v-checkbox
                    :model-value="false"
                    :aria-label="`Keep ${candidate.title}`"
                    @update:model-value="toggle(candidate, $event)"
                  />
                  <v-icon
                    :icon="candidate.icon ?? section.icon"
                    size="18"
                    class="cap-row-icon dim"
                  />
                  <div class="rr-row-main">
                    <div class="rr-row-title cap-title">
                      <span>{{ candidate.title }}</span>
                      <v-chip
                        v-if="candidate.device?.twin && candidate.device.model"
                        size="x-small"
                        variant="tonal"
                        >{{ candidate.device.twin.index }} of
                        {{ candidate.device.twin.of }} identical</v-chip
                      >
                    </div>
                    <div v-if="candidate.description" class="rr-row-sub">
                      <span :class="{ 'rr-mono': candidate.device }">{{
                        candidate.description
                      }}</span>
                    </div>
                    <RememberApp :candidate="candidate" @changed="replaced(candidate, $event)" />
                  </div>
                </div>
              </template>
            </template>
          </div>
        </section>

        <!-- 3. What it backs up -->
        <section v-if="trackedAll.length > 0" class="cap-section" data-testid="capture-tracked">
          <div class="cap-head">
            <v-icon icon="mdi-backup-restore" size="18" />
            <h2 class="rr-section-title">Back up with this setup</h2>
            <span class="cap-count"
              >{{ trackedChosen.length }} of {{ trackedAll.length }} kept</span
            >
          </div>
          <p class="cap-lead">
            Files and folders the Backups page keeps copies of for this setup. Nothing is copied
            now.
          </p>
          <div class="rr-panel">
            <div
              v-for="item in tracked"
              :key="item.key"
              class="rr-row cap-row"
              data-testid="capture-tracked-item"
              :data-path="item.path"
              :data-kept="trackedOn[item.key] ? 'yes' : 'no'"
            >
              <v-checkbox
                :model-value="trackedOn[item.key]"
                :aria-label="`Back up ${item.label}`"
                @update:model-value="toggleTracked(item.key, $event)"
              />
              <v-icon
                :icon="item.kind === 'folder' ? 'mdi-folder-outline' : 'mdi-file-outline'"
                size="18"
                class="cap-row-icon"
                :class="{ dim: !trackedOn[item.key] }"
              />
              <div class="rr-row-main">
                <div class="rr-row-title">{{ item.label }}</div>
                <div class="rr-row-sub">
                  <span class="rr-mono">{{ item.path }}</span>
                  <span v-if="item.description"> · {{ item.description }}</span>
                </div>
              </div>
              <span class="rr-row-sub cap-source">{{ item.source }}</span>
            </div>
            <button
              v-if="trackedTools.length > 0 || expanded['tracked']"
              type="button"
              class="rr-row cap-more"
              :aria-expanded="expanded['tracked'] === true"
              data-testid="capture-more-tracked"
              @click="expanded['tracked'] = !expanded['tracked']"
            >
              <v-icon
                :icon="expanded['tracked'] ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                size="18"
              />
              {{
                expanded['tracked']
                  ? 'Hide what helper tools keep'
                  : `Show ${trackedTools.length} more from helper tools`
              }}
            </button>
          </div>
        </section>
      </div>

      <!-- The setup so far -->
      <aside class="cap-summary rr-panel" data-testid="capture-summary" aria-live="polite">
        <div class="cap-summary-body">
          <div class="rr-section-title">This setup</div>
          <div class="cap-summary-name" data-testid="capture-summary-name">
            {{ name.trim() || 'Not named yet' }}
          </div>
          <div class="cap-summary-line">
            <v-icon icon="mdi-rocket-launch-outline" size="15" />
            <span v-if="launchText">Launches {{ launchText }}</span>
            <span v-else class="rr-muted">No Launch button</span>
          </div>
          <div class="rr-section-title cap-summary-gap">Checks before launch</div>
          <div
            v-if="summary.length === 0 && keptStepChecks.length === 0"
            class="rr-muted cap-summary-line"
          >
            Nothing kept: a setup with only a name.
          </div>
          <div
            v-for="part in summary"
            :key="part.group"
            class="cap-summary-part"
            :data-testid="`capture-summary-${part.group}`"
          >
            <div class="cap-summary-line">
              <v-icon :icon="part.icon" size="15" />
              <span
                ><b>{{ part.items.length }}</b> {{ part.noun }}</span
              >
            </div>
            <div class="cap-summary-items">
              {{
                part.items
                  .slice(0, 4)
                  .map((c) => titleOf(c))
                  .join(' · ')
              }}<span v-if="part.items.length > 4"> · +{{ part.items.length - 4 }} more</span>
            </div>
          </div>
          <div
            v-for="check in keptStepChecks"
            :key="check.type"
            class="cap-summary-line"
            data-testid="capture-summary-step-check"
          >
            <v-icon icon="mdi-check-circle-outline" size="15" />
            <span>{{ check.title }}</span>
          </div>
          <template v-if="keptSteps.length > 0">
            <div class="rr-section-title cap-summary-gap">Before launch</div>
            <div
              v-for="keptStep in keptSteps"
              :key="keptStep.step.type"
              class="cap-summary-line"
              data-testid="capture-summary-step"
            >
              <v-icon icon="mdi-play-circle-outline" size="15" />
              <span>{{ keptStep.step.label }}: {{ keptStep.chosen.label }}</span>
            </div>
          </template>
          <template v-if="closedAtStandDown.length > 0">
            <div class="rr-section-title cap-summary-gap">Stand down</div>
            <div class="cap-summary-line" data-testid="capture-summary-standdown">
              <v-icon icon="mdi-power-standby" size="15" />
              <span>Closes {{ closedAtStandDown.join(', ') }}</span>
            </div>
          </template>
          <template v-if="trackedChosen.length > 0">
            <div class="rr-section-title cap-summary-gap">Backups</div>
            <div class="cap-summary-line" data-testid="capture-summary-tracked">
              <v-icon icon="mdi-backup-restore" size="15" />
              <span>{{ trackedChosen.map((t) => t.label).join(', ') }}</span>
            </div>
          </template>
        </div>
        <div class="cap-summary-actions">
          <span class="cap-summary-count" data-testid="capture-count"
            >{{ kept.length }} {{ kept.length === 1 ? 'check' : 'checks' }}</span
          >
          <v-spacer />
          <v-btn variant="text" to="/configure/profiles">Cancel</v-btn>
          <v-btn
            color="primary"
            :disabled="!canSave"
            :loading="saving"
            :title="!name.trim() ? 'Give the setup a name to create it.' : undefined"
            :aria-describedby="!name.trim() ? 'capture-save-hint' : undefined"
            data-testid="capture-save"
            @click="save"
          >
            Create setup
          </v-btn>
        </div>
        <div v-if="!name.trim() && !loading" id="capture-save-hint" class="cap-summary-hint">
          Give the setup a name to create it.
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.cap {
  max-width: 1200px;
}
.cap-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: start;
}
.cap-section {
  margin-bottom: 26px;
}
.cap-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  color: var(--rr-muted);
}
.cap-head .rr-section-title {
  margin: 0;
}
.cap-count {
  font-size: 12.5px;
  color: var(--rr-muted);
  margin-left: 6px;
}
.cap-lead {
  margin: 2px 0 10px;
  font-size: 13px;
  color: var(--rr-muted);
}
.cap-game {
  padding: 16px;
  display: grid;
  gap: 14px;
}
.cap-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
}
.cap-tile {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 10px;
  align-items: center;
  padding: 8px 28px 8px 12px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  background: var(--rr-surface-2);
  color: var(--rr-text);
  text-align: left;
  cursor: pointer;
}
.cap-tile > .v-icon:first-child {
  grid-row: 1 / span 2;
}
.cap-tile:hover {
  border-color: #3a4553;
}
.cap-tile:focus-visible {
  outline: 2px solid var(--rr-accent);
  outline-offset: 2px;
}
.cap-tile.on {
  border-color: var(--rr-accent);
  background: #1f3145;
}
.cap-tile-name {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.25;
}
.cap-tile-sub {
  font-size: 12px;
  color: #a3adba;
}
.cap-tile-on {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--rr-accent);
}
.cap-why {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--rr-muted);
}
.cap-variants {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.cap-fields {
  display: grid;
  gap: 12px;
}
.cap-launch {
  border-top: 1px solid var(--rr-border);
  padding-top: 12px;
  display: grid;
  gap: 10px;
}
.cap-launch-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.cap-launch-title {
  font-size: 13.5px;
  font-weight: 600;
}
.cap-launch-fields {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 10px;
}
.cap-launch-steam {
  max-width: 320px;
}
.cap-diagram {
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--rr-border);
}
.cap-row {
  padding-top: 4px;
  padding-bottom: 4px;
  min-height: 52px;
}
.cap-row-icon {
  color: var(--rr-accent);
}
.cap-row-icon.dim {
  color: var(--rr-muted);
}
.cap-step-check {
  padding-left: 44px;
}
.cap-row.flash {
  background: rgba(90, 169, 230, 0.14);
  box-shadow: inset 3px 0 0 var(--rr-accent);
}
.cap-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cap-rename {
  max-width: 420px;
}
.cap-ask {
  max-width: 460px;
  margin-top: 8px;
  margin-bottom: 6px;
}
.cap-source {
  white-space: nowrap;
}
.cap-more {
  width: 100%;
  background: none;
  border-left: none;
  border-right: none;
  border-bottom: none;
  color: var(--rr-accent);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  gap: 6px;
}
.cap-more:hover {
  background: var(--rr-surface-2);
}
.cap-more:focus-visible {
  outline: 2px solid var(--rr-accent);
  outline-offset: -2px;
}
.cap-identified {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: 0 0 10px;
  color: var(--rr-text);
}

.cap-summary {
  position: sticky;
  top: 16px;
  padding: 16px;
  max-height: calc(100vh - 100px);
  display: flex;
  flex-direction: column;
}
.cap-summary-body {
  overflow-y: auto;
  min-height: 0;
}
.cap-summary-name {
  font-size: 17px;
  font-weight: 600;
  margin-bottom: 6px;
  overflow-wrap: anywhere;
}
.cap-summary-gap {
  margin-top: 16px;
}
.cap-summary-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.35;
}
.cap-summary-line .v-icon {
  margin-top: 2px;
  color: var(--rr-muted);
  flex: none;
}
.cap-summary-part {
  margin-bottom: 8px;
}
.cap-summary-items {
  margin-left: 23px;
  font-size: 12px;
  color: var(--rr-muted);
  overflow-wrap: anywhere;
}
.cap-summary-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--rr-border);
}
.cap-summary-count {
  font-size: 12.5px;
  color: var(--rr-muted);
  white-space: nowrap;
}
.cap-summary-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--rr-muted);
  text-align: right;
}

/* A narrow window: the summary becomes a bar along the bottom with the count and the button. */
@media (max-width: 1180px) {
  .cap-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .cap-summary {
    position: sticky;
    top: auto;
    bottom: 0;
    z-index: 2;
    padding: 10px 16px;
    border-radius: var(--rr-radius) var(--rr-radius) 0 0;
  }
  .cap-summary-body,
  .cap-summary-hint {
    display: none;
  }
  .cap-summary-actions {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
  .cap-launch-fields {
    grid-template-columns: 1fr;
  }
}
</style>

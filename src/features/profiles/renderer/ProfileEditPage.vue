<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  CHECK_GROUPS,
  GROUP_TITLES,
  profileActions,
  type CheckItem,
  type LaunchAction,
  type Profile,
  type ProfileActions,
} from '../../../core/profile/schema';
import { errorText, useClient } from '../../../renderer/ipc';
import {
  profilesContract,
  type CheckTypeInfo,
  type DetectedGame,
  type Pickers,
  type RemediationTypeInfo,
} from '../contract';
import { isDuplicate, nextId } from '../core/duplicates';
import ActionEditor from './ActionEditor.vue';
import ItemEditor from './ItemEditor.vue';
import ParamsForm from './ParamsForm.vue';
import { defaultsOf, plain } from './schemaForm';

const props = defineProps<{ id: string }>();
const api = useClient(profilesContract);
const router = useRouter();

const draft = ref<Profile>();
const actions = ref<ProfileActions>({ preLaunch: [], postLaunch: [], standDown: [] });
const original = ref('');
const hasComments = ref(false);
const file = ref('');
const loadError = ref<string>();
const error = ref<string>();
const problems = ref<string[]>([]);
const saving = ref(false);
const checks = ref<CheckTypeInfo[]>([]);
const remediations = ref<RemediationTypeInfo[]>([]);
const pickers = ref<Pickers>();
const games = ref<DetectedGame[]>([]);
const open = ref<Record<string, boolean>>({});
const launchKind = ref<'program' | 'steam' | 'none'>('none');
const commentsWarning = ref(false);
const leaving = ref(false);
const fileMessage = ref<string>();

const PHASES = [
  { key: 'preLaunch', title: 'Before launch', sub: 'Run in order before the game starts.' },
  {
    key: 'postLaunch',
    title: 'After launch',
    sub: 'Run once the game is running, each at its delay.',
  },
  { key: 'standDown', title: 'At Stand down', sub: 'Run after the apps are closed.' },
] as const;

const snapshot = (): string =>
  JSON.stringify({ draft: draft.value, actions: actions.value, launchKind: launchKind.value });
const dirty = computed(() => draft.value !== undefined && snapshot() !== original.value);

onMounted(async () => {
  const [loaded, types, found, detected] = await Promise.all([
    api.edit({ id: props.id }),
    api.types(),
    api.pickers(),
    api.games(),
  ]);
  if (!loaded.ok) {
    loadError.value = errorText(loaded.error);
    return;
  }
  if (types.ok) {
    checks.value = types.value.checks;
    remediations.value = types.value.remediations;
  }
  if (found.ok) pickers.value = found.value;
  if (detected.ok) games.value = detected.value;
  draft.value = plain(loaded.value.profile);
  actions.value = profileActions(loaded.value.profile);
  hasComments.value = loaded.value.hasComments;
  file.value = loaded.value.file;
  launchKind.value = draft.value.steamAppId ? 'steam' : draft.value.launch ? 'program' : 'none';
  original.value = snapshot();
});

// ---- basics ----

const gameItems = computed(() => [
  { title: 'No particular game', value: '' },
  ...games.value.map((g) => ({
    title: g.installs.length > 0 ? g.name : `${g.name} (not found on this PC)`,
    value: g.id,
  })),
  { title: 'Other game…', value: 'other' },
]);
const detectedLaunch = computed(() => {
  const game = games.value.find((g) => g.id === draft.value?.game);
  return game?.installs.find((i) => i.launch)?.launch;
});

function setGame(value: string): void {
  if (!draft.value) return;
  const next = { ...draft.value };
  if (value) next.game = value;
  else delete next.game;
  if (value !== 'other') delete next.gameName;
  draft.value = next;
  // A known game fills in what Launch starts, unless the user already chose.
  if (launchKind.value === 'none' && detectedLaunch.value) useDetected();
}

function useDetected(): void {
  if (!draft.value || !detectedLaunch.value) return;
  draft.value = { ...draft.value, launch: plain(detectedLaunch.value) };
  launchKind.value = 'program';
}

const launchParams = computed(() => ({
  exe: draft.value?.launch?.exe ?? '',
  args: draft.value?.launch?.args ?? [],
  ...(draft.value?.launch?.cwd ? { cwd: draft.value.launch.cwd } : {}),
}));
const LAUNCH_SCHEMA = {
  type: 'object',
  properties: {
    exe: { type: 'string' },
    args: { type: 'array', items: { type: 'string' } },
    cwd: { type: 'string' },
  },
  required: ['exe'],
};
function setLaunch(value: Record<string, unknown>): void {
  if (!draft.value) return;
  draft.value = {
    ...draft.value,
    launch: {
      exe: typeof value['exe'] === 'string' ? value['exe'] : '',
      args: Array.isArray(value['args']) ? value['args'].map(String) : [],
      ...(typeof value['cwd'] === 'string' && value['cwd'] ? { cwd: value['cwd'] } : {}),
    },
  };
}

// ---- checklist ----

const addMenu = computed(() =>
  CHECK_GROUPS.map((group) => ({
    group,
    title: GROUP_TITLES[group],
    types: checks.value.filter((c) => c.group === group),
  })).filter((g) => g.types.length > 0)
);

function addCheck(type: CheckTypeInfo): void {
  if (!draft.value) return;
  const id = nextId(
    'c',
    draft.value.checks.map((c) => c.id)
  );
  const fix = type.fixes?.[0]
    ? remediations.value.find((r) => r.type === type.fixes![0])
    : undefined;
  const item: CheckItem = {
    id,
    type: type.type,
    title: 'New check',
    required: !type.advisory,
    params: defaultsOf(type.schema),
    ...(fix && fix.kind === 'action' && type.type === 'process.running'
      ? { remediation: { type: fix.type, params: defaultsOf(fix.schema) } }
      : {}),
  };
  draft.value = { ...draft.value, checks: [...draft.value.checks, item] };
  open.value = { ...open.value, [id]: true };
}

function updateCheck(index: number, item: CheckItem): void {
  if (!draft.value) return;
  const list = [...draft.value.checks];
  list[index] = item;
  draft.value = { ...draft.value, checks: list };
}

function move<T>(list: T[], index: number, by: number): T[] {
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(index + by, 0, moved!);
  return next;
}

function removeCheck(index: number): void {
  if (!draft.value) return;
  draft.value = { ...draft.value, checks: draft.value.checks.filter((_, i) => i !== index) };
}

const problemsOf = (id: string): string[] => problems.value.filter((p) => p.startsWith(`${id} `));

// ---- actions ----

function addAction(phase: keyof ProfileActions): void {
  const all = [...actions.value.preLaunch, ...actions.value.postLaunch, ...actions.value.standDown];
  const type =
    remediations.value.find((r) => r.type === 'process.launch') ??
    remediations.value.find((r) => r.kind === 'action');
  if (!type) return;
  const action: LaunchAction = {
    id: nextId(
      'a',
      all.map((a) => a.id)
    ),
    title: `New ${type.label.toLowerCase()}`,
    type: type.type,
    params: defaultsOf(type.schema),
    continueOnError: true,
    delaySeconds: 0,
  };
  actions.value = { ...actions.value, [phase]: [...actions.value[phase], action] };
}

function updateAction(phase: keyof ProfileActions, index: number, action: LaunchAction): void {
  const list = [...actions.value[phase]];
  list[index] = action;
  actions.value = { ...actions.value, [phase]: list };
}

// ---- copy from another setup ----

const copyOpen = ref(false);
const copySource = ref<Profile>();
const copyChoices = ref<string[]>([]);
const copyAnyway = ref(false);
const others = ref<{ title: string; value: string }[]>([]);
const copyMessage = ref<string>();

async function openCopy(): Promise<void> {
  copyOpen.value = true;
  copySource.value = undefined;
  copyChoices.value = [];
  const listed = await api.list();
  others.value = listed.ok
    ? listed.value.filter((p) => p.id !== props.id).map((p) => ({ title: p.name, value: p.id }))
    : [];
}

async function chooseSource(id: string): Promise<void> {
  const loaded = await api.get({ id });
  copySource.value = loaded.ok ? loaded.value : undefined;
  copyChoices.value = [];
}

const copyRows = computed(() => {
  const source = copySource.value;
  if (!source || !draft.value) return [];
  const mine = draft.value.checks;
  const myActions = [
    ...actions.value.preLaunch,
    ...actions.value.postLaunch,
    ...actions.value.standDown,
  ];
  const sourceActions = profileActions(source);
  return [
    ...source.checks.map((c) => ({
      key: `check:${c.id}`,
      title: c.title,
      kind: checks.value.find((t) => t.type === c.type)?.label ?? c.type,
      duplicate: isDuplicate(c, mine),
    })),
    ...PHASES.flatMap((phase) =>
      sourceActions[phase.key].map((a) => ({
        key: `${phase.key}:${a.id}`,
        title: a.title,
        kind: phase.title,
        duplicate: isDuplicate(a, myActions),
      }))
    ),
  ];
});

function copySelected(): void {
  const source = copySource.value;
  if (!source || !draft.value) return;
  const chosen = new Set(copyChoices.value);
  let added = 0;
  let skipped = 0;
  const checkList = [...draft.value.checks];
  for (const item of source.checks) {
    if (!chosen.has(`check:${item.id}`)) continue;
    if (isDuplicate(item, checkList) && !copyAnyway.value) {
      skipped++;
      continue;
    }
    checkList.push({
      ...plain(item),
      id: nextId(
        'c',
        checkList.map((c) => c.id)
      ),
    });
    added++;
  }
  const sourceActions = profileActions(source);
  const next = plain(actions.value);
  for (const phase of PHASES) {
    for (const action of sourceActions[phase.key]) {
      if (!chosen.has(`${phase.key}:${action.id}`)) continue;
      const all = [...next.preLaunch, ...next.postLaunch, ...next.standDown];
      if (isDuplicate(action, all) && !copyAnyway.value) {
        skipped++;
        continue;
      }
      next[phase.key].push({
        ...plain(action),
        id: nextId(
          'a',
          all.map((a) => a.id)
        ),
      });
      added++;
    }
  }
  draft.value = { ...draft.value, checks: checkList };
  actions.value = next;
  copyOpen.value = false;
  copyMessage.value = `Copied ${added} ${added === 1 ? 'item' : 'items'} from "${source.name}"${
    skipped > 0 ? `; skipped ${skipped} already here` : ''
  }. Save to keep them.`;
}

// ---- save ----

function build(): Profile | undefined {
  if (!draft.value) return undefined;
  const { launch, steamAppId: _steam, actions: _actions, ...rest } = draft.value;
  const any =
    actions.value.preLaunch.length +
    actions.value.postLaunch.length +
    actions.value.standDown.length;
  return {
    ...rest,
    ...(launchKind.value === 'program' && launch?.exe ? { launch } : {}),
    ...(launchKind.value === 'steam' && draft.value.steamAppId
      ? { steamAppId: draft.value.steamAppId }
      : {}),
    ...(any > 0 ? { actions: actions.value } : {}),
  };
}

function onSave(): void {
  if (hasComments.value) commentsWarning.value = true;
  else void save();
}

async function save(): Promise<void> {
  commentsWarning.value = false;
  const next = build();
  if (!next) return;
  saving.value = true;
  error.value = undefined;
  problems.value = [];
  const result = await api.save(next);
  saving.value = false;
  if (!result.ok) {
    error.value = result.error.message;
    problems.value = (result.error.detail ?? '').split('\n').filter(Boolean);
    // Open the items that need fixing.
    for (const line of problems.value) {
      const id = line.split(' ')[0]!;
      open.value = { ...open.value, [id]: true };
    }
    return;
  }
  original.value = snapshot();
  await router.push('/configure/profiles');
}

function cancel(): void {
  if (dirty.value) leaving.value = true;
  else void router.push('/configure/profiles');
}

async function openFile(mode: 'openFile' | 'showFile'): Promise<void> {
  const result = await api[mode]({ id: props.id });
  fileMessage.value = result.ok
    ? mode === 'openFile'
      ? 'Opened in your editor. RigReady picks up the changes when you save the file.'
      : 'Opened in Explorer.'
    : errorText(result.error);
}
</script>

<template>
  <div class="rr-page edit" data-testid="profile-edit-page">
    <div class="d-flex align-start">
      <div>
        <h1 class="rr-page-title">Edit setup</h1>
        <p class="rr-page-sub">
          Rename it, choose what Launch starts, and decide what is checked, what is required and how
          it gets fixed.
        </p>
      </div>
      <v-spacer />
      <v-menu v-if="draft">
        <template #activator="{ props: menu }">
          <v-btn
            v-bind="menu"
            variant="text"
            prepend-icon="mdi-file-code-outline"
            data-testid="edit-file-menu"
          >
            YAML file
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item
            title="Open in your editor"
            data-testid="edit-open-file"
            @click="openFile('openFile')"
          />
          <v-list-item
            title="Show in Explorer"
            data-testid="edit-show-file"
            @click="openFile('showFile')"
          />
        </v-list>
      </v-menu>
    </div>

    <v-alert
      v-if="loadError"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="edit-load-error"
    >
      {{ loadError }}
      <div class="mt-2"><v-btn variant="text" to="/configure/profiles">Back to setups</v-btn></div>
    </v-alert>
    <v-alert v-if="fileMessage" type="info" variant="tonal" class="mb-4" closable>{{
      fileMessage
    }}</v-alert>
    <v-alert
      v-if="copyMessage"
      type="success"
      variant="tonal"
      class="mb-4"
      closable
      data-testid="edit-copied"
    >
      {{ copyMessage }}
    </v-alert>

    <template v-if="draft">
      <h2 class="rr-section-title">Setup</h2>
      <div class="rr-panel edit-basics">
        <div class="edit-two">
          <v-text-field v-model="draft.name" label="Name *" counter="80" data-testid="edit-name" />
          <v-select
            :model-value="draft.game ?? ''"
            :items="gameItems"
            label="Game"
            data-testid="edit-game"
            @update:model-value="setGame($event)"
          />
        </div>
        <v-text-field
          v-if="draft.game === 'other'"
          :model-value="draft.gameName ?? ''"
          label="Game name"
          placeholder="e.g. Richard Burns Rally"
          data-testid="edit-game-name"
          @update:model-value="draft = { ...draft!, gameName: $event || undefined }"
        />
        <v-textarea
          :model-value="draft.description ?? ''"
          label="Notes (optional)"
          rows="2"
          auto-grow
          data-testid="edit-description"
          @update:model-value="draft = { ...draft!, description: $event || undefined }"
        />
      </div>

      <h2 class="rr-section-title">Launch</h2>
      <div class="rr-panel edit-basics">
        <v-btn-toggle
          v-model="launchKind"
          mandatory
          density="compact"
          variant="outlined"
          divided
          color="primary"
        >
          <v-btn value="program" data-testid="edit-launch-program">A program</v-btn>
          <v-btn value="steam" data-testid="edit-launch-steam">Through Steam</v-btn>
          <v-btn value="none" data-testid="edit-launch-none">Nothing</v-btn>
        </v-btn-toggle>
        <template v-if="launchKind === 'program'">
          <div v-if="detectedLaunch" class="edit-detected">
            <span class="rr-row-sub"
              >Found on this PC: <span class="rr-mono">{{ detectedLaunch.exe }}</span></span
            >
            <v-btn size="small" variant="tonal" data-testid="edit-use-detected" @click="useDetected"
              >Use it</v-btn
            >
          </div>
          <ParamsForm
            :schema="LAUNCH_SCHEMA"
            :model-value="launchParams"
            testid="edit-launch"
            @update:model-value="setLaunch"
          />
        </template>
        <v-text-field
          v-else-if="launchKind === 'steam'"
          :model-value="draft.steamAppId ?? ''"
          label="Steam app id"
          hint="The number in the game's Steam store address, e.g. 223750 for DCS World"
          persistent-hint
          data-testid="edit-steam-app"
          @update:model-value="draft = { ...draft!, steamAppId: $event || undefined }"
        />
        <div v-else class="rr-row-sub">The Fly screen offers no Launch button for this setup.</div>
      </div>

      <div class="edit-section-head">
        <h2 class="rr-section-title">Checklist</h2>
        <v-spacer />
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-content-copy"
          data-testid="edit-copy-from"
          @click="openCopy"
        >
          Copy from another setup…
        </v-btn>
        <v-menu max-height="460">
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              size="small"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-plus"
              data-testid="edit-add-check"
            >
              Add check
            </v-btn>
          </template>
          <v-list density="compact">
            <template v-for="group in addMenu" :key="group.group">
              <v-list-subheader>{{ group.title }}</v-list-subheader>
              <v-list-item
                v-for="type in group.types"
                :key="type.type"
                :title="type.label"
                :data-testid="`add-${type.type}`"
                @click="addCheck(type)"
              />
            </template>
          </v-list>
        </v-menu>
      </div>
      <div class="rr-panel mb-6">
        <ItemEditor
          v-for="(item, index) in draft.checks"
          :key="item.id"
          :item="item"
          :checks="checks"
          :remediations="remediations"
          :pickers="pickers"
          :index="index"
          :count="draft.checks.length"
          :problems="problemsOf(item.id)"
          :open="open[item.id] === true"
          @update:item="updateCheck(index, $event)"
          @move="draft = { ...draft!, checks: move(draft!.checks, index, $event) }"
          @remove="removeCheck(index)"
          @toggle="open = { ...open, [item.id]: !open[item.id] }"
        />
        <div v-if="draft.checks.length === 0" class="rr-row rr-muted">
          No checks yet. Add one, or copy them from another setup.
        </div>
      </div>

      <template v-for="phase in PHASES" :key="phase.key">
        <div class="edit-section-head">
          <div>
            <h2 class="rr-section-title">{{ phase.title }}</h2>
            <div class="rr-row-sub edit-phase-sub">{{ phase.sub }}</div>
          </div>
          <v-spacer />
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-plus"
            :data-testid="`edit-add-${phase.key}`"
            @click="addAction(phase.key)"
          >
            Add step
          </v-btn>
        </div>
        <div class="rr-panel mb-6" :data-testid="`edit-actions-${phase.key}`">
          <ActionEditor
            v-for="(action, index) in actions[phase.key]"
            :key="action.id"
            :action="action"
            :phase="phase.key"
            :remediations="remediations"
            :index="index"
            :count="actions[phase.key].length"
            :problems="problemsOf(action.id)"
            @update:action="updateAction(phase.key, index, $event)"
            @move="actions = { ...actions, [phase.key]: move(actions[phase.key], index, $event) }"
            @remove="
              actions = {
                ...actions,
                [phase.key]: actions[phase.key].filter((_, i) => i !== index),
              }
            "
          />
          <div v-if="actions[phase.key].length === 0" class="rr-row rr-muted">None.</div>
        </div>
      </template>

      <div class="edit-footer">
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="edit-error"
          data-testid="edit-error"
        >
          {{ error }} The fields are marked above.
        </v-alert>
        <span v-else-if="dirty" class="rr-row-sub">Unsaved changes</span>
        <v-spacer />
        <v-btn variant="text" data-testid="edit-cancel" @click="cancel">Cancel</v-btn>
        <v-btn
          color="primary"
          :disabled="draft.name.trim().length === 0 || !dirty"
          :loading="saving"
          data-testid="edit-save"
          @click="onSave"
        >
          Save
        </v-btn>
      </div>
    </template>

    <v-dialog v-model="copyOpen" max-width="620">
      <v-card data-testid="copy-dialog">
        <v-card-title>Copy from another setup</v-card-title>
        <v-card-text>
          <v-select
            :items="others"
            label="Setup"
            no-data-text="There is no other setup"
            data-testid="copy-source"
            @update:model-value="chooseSource($event)"
          />
          <div v-if="copySource" class="copy-list">
            <label
              v-for="row in copyRows"
              :key="row.key"
              class="rr-row copy-row"
              data-testid="copy-row"
              :data-title="row.title"
            >
              <v-checkbox
                v-model="copyChoices"
                :value="row.key"
                hide-details
                density="compact"
                :aria-label="`Copy ${row.title}`"
              />
              <div class="rr-row-main">
                <div class="rr-row-title">{{ row.title }}</div>
                <div class="rr-row-sub">
                  {{ row.kind
                  }}<span v-if="row.duplicate" class="rr-warn" data-testid="copy-duplicate">
                    · already in this setup</span
                  >
                </div>
              </div>
            </label>
            <div v-if="copyRows.length === 0" class="rr-row rr-muted">That setup is empty.</div>
          </div>
          <v-checkbox
            v-if="copySource"
            v-model="copyAnyway"
            label="Add items that are already here anyway"
            hide-details
            density="compact"
            data-testid="copy-anyway"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="copyOpen = false">Cancel</v-btn>
          <v-btn
            color="primary"
            :disabled="copyChoices.length === 0"
            data-testid="copy-confirm"
            @click="copySelected"
          >
            Copy {{ copyChoices.length || '' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="commentsWarning" max-width="480">
      <v-card data-testid="comments-warning">
        <v-card-title>Your comments will be lost</v-card-title>
        <v-card-text>
          This setup's file has comments written by hand. When RigReady saves it, they are removed.
          Everything else is kept.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="commentsWarning = false">Cancel</v-btn>
          <v-btn color="primary" data-testid="comments-save" @click="save">Save anyway</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="leaving" max-width="420">
      <v-card data-testid="discard-warning">
        <v-card-title>Discard your changes?</v-card-title>
        <v-card-text>The setup file stays exactly as it was.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="leaving = false">Keep editing</v-btn>
          <v-btn
            color="error"
            data-testid="discard-confirm"
            @click="router.push('/configure/profiles')"
            >Discard</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.edit-basics {
  padding: 16px;
  display: grid;
  gap: 10px;
  margin-bottom: 24px;
}
.edit-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.edit-detected {
  display: flex;
  align-items: center;
  gap: 10px;
}
.edit-section-head {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 8px;
}
.edit-section-head .rr-section-title {
  margin: 0;
}
.edit-phase-sub {
  margin-top: 2px;
}
.edit-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  background: var(--rr-bg);
  border-top: 1px solid var(--rr-border);
  z-index: 2;
}
.edit-error {
  flex: 1;
}
.copy-list {
  max-height: 340px;
  overflow-y: auto;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
}
.copy-row {
  cursor: pointer;
  padding-top: 2px;
  padding-bottom: 2px;
}
</style>

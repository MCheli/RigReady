<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { z } from 'zod';
import type { CaptureCandidateSchema } from '../../../core/checks/engine';
import { CHECK_GROUPS, GROUP_TITLES } from '../../../core/profile/schema';
import { errorText, useClient } from '../../../renderer/ipc';
import { profilesContract, type DetectedGame } from '../contract';

type Candidate = z.infer<typeof CaptureCandidateSchema>;

const api = useClient(profilesContract);
const router = useRouter();

const name = ref('');
const game = ref('');
const gameName = ref('');
const games = ref<DetectedGame[]>([]);
const launchExe = ref('');
const launchArgs = ref('');
const launchCwd = ref('');

const gameItems = computed(() => [
  { title: 'No particular game', value: '' },
  ...games.value.filter((g) => g.installs.length > 0).map((g) => ({ title: g.name, value: g.id })),
  { title: 'Other game…', value: 'other' },
]);

/** A known game fills in what Launch starts and ticks its own files and version check. */
function chooseGame(id: string): void {
  game.value = id ?? '';
  const launch = games.value.find((g) => g.id === id)?.installs.find((i) => i.launch)?.launch;
  if (launch) {
    launchExe.value = launch.exe;
    launchArgs.value = launch.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
    launchCwd.value = launch.cwd ?? '';
  }
  for (const candidate of candidates.value) {
    if (candidate.key.startsWith('file:') || candidate.key.startsWith('game:')) {
      const own = candidate.key.startsWith(`file:${id}:`) || candidate.key === `game:${id}`;
      selected[candidate.key] = own;
    } else if (candidate.game) {
      // Checks that belong to one game are kept only in a setup for that game.
      selected[candidate.key] = candidate.game === id && candidate.selectedByDefault;
    }
  }
}
const candidates = ref<Candidate[]>([]);
const problems = ref<string[]>([]);
const loading = ref(true);
const saving = ref(false);
const error = ref<string>();
const appFilter = ref('');
/** key -> included / required */
const selected = reactive<Record<string, boolean>>({});
const required = reactive<Record<string, boolean>>({});

async function capture(): Promise<void> {
  loading.value = true;
  const detected = await api.games();
  if (detected.ok) games.value = detected.value;
  const result = await api.capture();
  loading.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  candidates.value = result.value.candidates;
  problems.value = result.value.problems;
  for (const candidate of candidates.value) {
    selected[candidate.key] ??=
      candidate.selectedByDefault && (!candidate.game || candidate.game === game.value);
    required[candidate.key] ??= candidate.check.required;
  }
}

const groups = computed(() =>
  CHECK_GROUPS.map((group) => {
    // What a rig usually needs comes first; the long tail of running apps after it.
    const inGroup = candidates.value.filter((c) => c.group === group);
    const all = [
      ...inGroup.filter((c) => c.selectedByDefault),
      ...inGroup.filter((c) => !c.selectedByDefault),
    ];
    const filter = group === 'apps' ? appFilter.value.trim().toLowerCase() : '';
    return {
      group,
      title: GROUP_TITLES[group],
      total: all.length,
      chosen: all.filter((c) => selected[c.key]).length,
      // Chosen apps stay visible whatever the filter says.
      visible: filter
        ? all.filter(
            (c) =>
              selected[c.key] || `${c.title} ${c.description ?? ''}`.toLowerCase().includes(filter)
          )
        : all,
    };
  }).filter((g) => g.total > 0)
);

const chosenCount = computed(() => candidates.value.filter((c) => selected[c.key]).length);
// Every part can be skipped: a setup with only a name is still a valid one to start from.
const canSave = computed(() => name.value.trim().length > 0 && !saving.value);

/** Splits an argument line on spaces, keeping "quoted parts" together. Arguments stay an array end to end. */
function splitArgs(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '');
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = undefined;
  const exe = launchExe.value.trim();
  const cwd = launchCwd.value.trim();
  const result = await api.create({
    name: name.value,
    ...(game.value ? { game: game.value } : {}),
    ...(game.value === 'other' && gameName.value.trim() ? { gameName: gameName.value.trim() } : {}),
    ...(exe ? { launch: { exe, args: splitArgs(launchArgs.value), ...(cwd ? { cwd } : {}) } } : {}),
    checks: candidates.value
      .filter((c) => selected[c.key])
      .map((c) => ({ ...c.check, required: required[c.key] ?? true })),
  });
  saving.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  await router.push('/');
}

onMounted(capture);
</script>

<template>
  <div class="rr-page" data-testid="capture-page">
    <h1 class="rr-page-title">New setup from this rig</h1>
    <p class="rr-page-sub">
      RigReady looked at what is connected, running and arranged right now. Keep what this setup
      needs; everything you keep becomes a check.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="capture-error">{{
      error
    }}</v-alert>
    <v-alert v-for="problem in problems" :key="problem" type="warning" variant="tonal" class="mb-4">
      {{ problem }}
    </v-alert>

    <div class="rr-panel capture-basics">
      <div class="capture-launch">
        <v-text-field
          v-model="name"
          label="Name"
          placeholder="DCS F/A-18C"
          data-testid="capture-name"
        />
        <v-select
          :model-value="game"
          :items="gameItems"
          label="Game"
          data-testid="capture-game"
          @update:model-value="chooseGame($event)"
        />
      </div>
      <v-text-field
        v-if="game === 'other'"
        v-model="gameName"
        label="Game name"
        placeholder="e.g. Richard Burns Rally"
        data-testid="capture-game-name"
      />
      <div class="capture-launch">
        <v-text-field
          v-model="launchExe"
          label="Program to launch (optional)"
          placeholder="C:\Games\DCS World\bin\DCS.exe"
          data-testid="capture-launch-exe"
        />
        <v-text-field
          v-model="launchArgs"
          label="Arguments (optional)"
          data-testid="capture-launch-args"
        />
      </div>
      <v-text-field
        v-if="launchCwd"
        v-model="launchCwd"
        label="Working folder"
        data-testid="capture-launch-cwd"
      />
    </div>

    <div v-if="loading" class="rr-empty">Looking at the rig…</div>

    <section
      v-for="group in groups"
      :key="group.group"
      class="capture-group"
      :data-testid="`capture-group-${group.group}`"
    >
      <div class="capture-group-head">
        <h2 class="rr-section-title">{{ group.title }}</h2>
        <span class="rr-row-sub">{{ group.chosen }} of {{ group.total }} kept</span>
      </div>
      <v-text-field
        v-if="group.group === 'apps'"
        v-model="appFilter"
        label="Find an app"
        prepend-inner-icon="mdi-magnify"
        clearable
        class="mb-2"
        data-testid="capture-app-filter"
      />
      <div class="rr-panel capture-list">
        <label
          v-for="candidate in group.visible"
          :key="candidate.key"
          class="rr-row capture-row"
          data-testid="capture-candidate"
          :data-title="candidate.title"
        >
          <v-checkbox v-model="selected[candidate.key]" :aria-label="`Keep ${candidate.title}`" />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ candidate.title }}</div>
            <div v-if="candidate.description" class="rr-row-sub">{{ candidate.description }}</div>
          </div>
          <v-btn-toggle
            v-if="selected[candidate.key]"
            v-model="required[candidate.key]"
            mandatory
            density="compact"
            variant="outlined"
            divided
            @click.prevent
          >
            <v-btn :value="true" size="small" data-testid="candidate-required">Required</v-btn>
            <v-btn :value="false" size="small" data-testid="candidate-optional">Optional</v-btn>
          </v-btn-toggle>
        </label>
        <div v-if="group.visible.length === 0" class="rr-row rr-muted">Nothing matches.</div>
      </div>
    </section>

    <div class="capture-footer">
      <span class="rr-row-sub">{{ chosenCount }} checks</span>
      <v-spacer />
      <v-btn variant="text" to="/configure/profiles">Cancel</v-btn>
      <v-btn
        color="primary"
        :disabled="!canSave"
        :loading="saving"
        data-testid="capture-save"
        @click="save"
      >
        Create setup
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.capture-basics {
  padding: 16px;
  display: grid;
  gap: 12px;
  margin-bottom: 24px;
}
.capture-launch {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
}
.capture-group {
  margin-bottom: 22px;
}
.capture-group-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.capture-list {
  max-height: 420px;
  overflow-y: auto;
}
.capture-row {
  cursor: pointer;
  padding-top: 4px;
  padding-bottom: 4px;
}
.capture-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  background: var(--rr-bg);
  border-top: 1px solid var(--rr-border);
}
</style>
